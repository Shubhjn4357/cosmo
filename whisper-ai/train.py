"""
Whisper AI - Optimized Training Script
Auto-learns from web, uses less power, trains efficiently.
"""

import argparse
import asyncio
import gc
import json
import os
import re
import shutil
import time
from pathlib import Path
from typing import List, Optional

import aiohttp
import torch
import yaml
from bs4 import BeautifulSoup
from loguru import logger

from model.quantization import export_quantized_checkpoint
from model.transformer import MicroTransformer, TransformerConfig
from model.tokenizer import TOKENIZER_BACKEND_BYTELEVEL, TokenizerConfig, WhisperTokenizer
from training.memmap_dataset import MemmapDataset, MemmapConfig
from training.trainer import Trainer, TrainingConfig
from utils.app_paths import DATA_ROOT, ensure_app_dirs
from services.curated_training_import import iter_curated_text_records
from services.research_documents import filtered_documents


ensure_app_dirs()
DEFAULT_PROCESSED_DIR = DATA_ROOT / "processed"
DEFAULT_CHECKPOINT_DIR = DATA_ROOT / "checkpoints"
DEFAULT_TOKENIZER_PATH = DEFAULT_CHECKPOINT_DIR / "tokenizer.json"
DEFAULT_LATEST_CHECKPOINT = DEFAULT_CHECKPOINT_DIR / "latest.pt"
DEFAULT_LATEST_QUANTIZED_CHECKPOINT = DEFAULT_CHECKPOINT_DIR / "latest-int8.pt"
DEFAULT_SELF_LEARNER_STATE_PATH = DEFAULT_CHECKPOINT_DIR / "state.json"
DEFAULT_TRAINING_PAIRS_PATH = DATA_ROOT / "training_pairs.jsonl"
DEFAULT_EXTERNAL_SOURCES_PATH = DATA_ROOT / "external_sources.jsonl"
DEFAULT_RANDOM_WIKIPEDIA_PAGES = max(0, int(os.getenv("WHISPER_DYNAMIC_RANDOM_WIKIPEDIA_PAGES", "4")))
DEFAULT_RECENT_RESEARCH_DOCS = max(0, int(os.getenv("WHISPER_DYNAMIC_RESEARCH_DOCS", "10")))
DEFAULT_GUTENBERG_DISCOVERIES = max(0, int(os.getenv("WHISPER_DYNAMIC_GUTENBERG_DISCOVERIES", "4")))
DEFAULT_ARXIV_DISCOVERIES = max(0, int(os.getenv("WHISPER_DYNAMIC_ARXIV_DISCOVERIES", "4")))
DEFAULT_DYNAMIC_WEB_FETCH_LIMIT = max(1, int(os.getenv("WHISPER_DYNAMIC_WEB_FETCH_LIMIT", "12")))


def load_config(config_path: str = "config/config.yaml") -> dict:
    """Load configuration file."""
    path = Path(config_path)
    if path.exists():
        with open(path, 'r') as f:
            return yaml.safe_load(f)
    return {}


def _config_value(config: dict, section: str, key: str, default):
    return config.get(section, {}).get(key, default)


async def fetch_page(session: aiohttp.ClientSession, url: str) -> Optional[str]:
    """Fetch a web page asynchronously."""
    try:
        headers = {
            'User-Agent': 'WhisperAI/1.0 (Educational AI; +https://github.com/whisper-ai)'
        }
        async with session.get(url, headers=headers, timeout=15) as response:
            if response.status == 200:
                return await response.text()
    except Exception as e:
        logger.debug(f"Failed to fetch {url}: {e}")
    return None


def extract_text(html: str) -> str:
    """Extract clean text from HTML."""
    soup = BeautifulSoup(html, 'html.parser')
    
    # Remove scripts, styles, navigation
    for tag in soup(['script', 'style', 'nav', 'header', 'footer', 'aside']):
        tag.decompose()
    
    # Get main content
    main = soup.find('main') or soup.find('article') or soup.find('body')
    if main:
        text = main.get_text(separator='\n', strip=True)
        text = normalize_training_text(text)
        return text[:5000]  # Limit length
    return ""


def _dedupe_preserve_order(values: List[str]) -> List[str]:
    deduped: List[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


async def _discover_random_wikipedia_urls(session: aiohttp.ClientSession, count: int) -> List[str]:
    if count <= 0:
        return []

    endpoint = (
        "https://en.wikipedia.org/w/api.php"
        f"?action=query&list=random&rnnamespace=0&rnlimit={min(count, 20)}&format=json"
    )
    try:
        async with session.get(endpoint, timeout=20) as response:
            if response.status != 200:
                return []
            payload = await response.json()
    except Exception as exc:
        logger.debug(f"Dynamic Wikipedia discovery failed: {exc}")
        return []

    return [
        f"https://en.wikipedia.org/wiki/{str(item.get('title') or '').strip().replace(' ', '_')}"
        for item in payload.get("query", {}).get("random", [])
        if str(item.get("title") or "").strip()
    ]


async def _discover_feed_links(
    session: aiohttp.ClientSession,
    feed_url: str,
    *,
    limit: int,
    parser: str = "xml",
) -> List[str]:
    if limit <= 0:
        return []

    xml = await fetch_page(session, feed_url)
    if not xml:
        return []

    try:
        soup = BeautifulSoup(xml, parser)
    except Exception as exc:
        logger.debug(f"Feed parse failed for {feed_url}: {exc}")
        return []

    links: List[str] = []
    for link in soup.find_all("link"):
        href = ""
        if link.has_attr("href"):
            href = str(link.get("href") or "").strip()
        elif link.string:
            href = str(link.string).strip()
        if href.startswith("http"):
            links.append(href)
        if len(links) >= limit:
            break
    return _dedupe_preserve_order(links)[:limit]


def load_recent_research_corpus(limit: int = DEFAULT_RECENT_RESEARCH_DOCS) -> List[str]:
    texts: List[str] = []
    try:
        for document in filtered_documents()[: max(0, limit)]:
            text = normalize_training_text(document.get("text") or "")
            if len(text) >= 120:
                texts.append(text[:8000])
    except Exception as exc:
        logger.warning(f"Failed to load research learning corpus: {exc}")
    return texts


def load_recent_research_urls(limit: int = DEFAULT_RECENT_RESEARCH_DOCS) -> List[str]:
    urls: List[str] = []
    try:
        for document in filtered_documents()[: max(0, limit)]:
            for key in ("source_url", "url"):
                candidate = str(document.get(key) or "").strip()
                if candidate.startswith("http"):
                    urls.append(candidate)
    except Exception as exc:
        logger.warning(f"Failed to load research source URLs: {exc}")
    return _dedupe_preserve_order(urls)[:limit]


async def discover_dynamic_training_urls(config: dict) -> List[str]:
    training_cfg = config.get("training", {})
    wikipedia_count = int(training_cfg.get("dynamic_random_wikipedia_pages", DEFAULT_RANDOM_WIKIPEDIA_PAGES))
    research_limit = int(training_cfg.get("dynamic_recent_research_docs", DEFAULT_RECENT_RESEARCH_DOCS))
    gutenberg_limit = int(training_cfg.get("dynamic_gutenberg_discoveries", DEFAULT_GUTENBERG_DISCOVERIES))
    arxiv_limit = int(training_cfg.get("dynamic_arxiv_discoveries", DEFAULT_ARXIV_DISCOVERIES))
    fetch_limit = int(training_cfg.get("dynamic_web_fetch_limit", DEFAULT_DYNAMIC_WEB_FETCH_LIMIT))

    async with aiohttp.ClientSession() as session:
        discovered: List[str] = []
        discovered.extend(load_recent_research_urls(research_limit))
        discovered.extend(await _discover_random_wikipedia_urls(session, wikipedia_count))
        discovered.extend(
            await _discover_feed_links(
                session,
                "https://www.gutenberg.org/cache/epub/feeds/today.rss",
                limit=gutenberg_limit,
            )
        )
        discovered.extend(
            await _discover_feed_links(
                session,
                (
                    "https://export.arxiv.org/api/query"
                    f"?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&start=0&max_results={max(1, arxiv_limit)}"
                    "&sortBy=submittedDate&sortOrder=descending"
                ),
                limit=arxiv_limit,
                parser="xml",
            )
        )

    urls = _dedupe_preserve_order(discovered)
    if fetch_limit > 0:
        urls = urls[:fetch_limit]
    logger.info(f"Discovered {len(urls)} dynamic web sources for training")
    return urls


async def fetch_training_data(urls: List[str]) -> List[str]:
    """Fetch training data from multiple URLs concurrently."""
    texts = []
    
    async with aiohttp.ClientSession() as session:
        tasks = [fetch_page(session, url) for url in urls]
        pages = await asyncio.gather(*tasks)
        
        for page in pages:
            if page:
                text = extract_text(page)
                if len(text) > 100:
                    texts.append(text)
                    logger.info(f"Fetched {len(text)} chars")
    
    return texts


def optimize_for_low_power():
    """Configure PyTorch for low power consumption."""
    # Limit CPU threads for power efficiency
    torch.set_num_threads(2)
    
    # Disable profiling
    torch.autograd.set_detect_anomaly(False)
    torch.autograd.profiler.profile(enabled=False)
    
    # Enable memory efficient operations
    if hasattr(torch.backends, 'cudnn'):
        torch.backends.cudnn.benchmark = False
    
    logger.info("Optimized for low power (2 CPU threads)")


def normalize_training_text(text: str) -> str:
    text = str(text or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\t", "    ")
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ ]{2,}", " ", text)
    return text.strip()


def build_dialogue_example(prompt: str, response: str) -> str:
    cleaned_prompt = normalize_training_text(prompt)
    cleaned_response = normalize_training_text(response)
    return f"User:\n{cleaned_prompt}\n\nAssistant:\n{cleaned_response}\n"


def reset_processed_dataset(memmap_dir: Path):
    if memmap_dir.exists():
        shutil.rmtree(memmap_dir, ignore_errors=True)
    memmap_dir.mkdir(parents=True, exist_ok=True)


def load_local_learning_corpus(limit: int = 500) -> List[str]:
    texts: List[str] = []

    def _read_jsonl(path: Path):
        if not path.exists():
            return
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if len(texts) >= limit:
                    return
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                prompt = normalize_training_text(record.get("input") or record.get("prompt") or "")
                response = normalize_training_text(record.get("output") or record.get("response") or "")
                if prompt and response:
                    texts.append(build_dialogue_example(prompt, response))
                elif response:
                    texts.append(response)

    _read_jsonl(DEFAULT_TRAINING_PAIRS_PATH)
    _read_jsonl(DEFAULT_EXTERNAL_SOURCES_PATH)

    try:
        for record in iter_curated_text_records(limit=max(0, limit - len(texts))):
            if len(texts) >= limit:
                break
            prompt = normalize_training_text(record.get("prompt") or record.get("input") or "")
            response = normalize_training_text(record.get("response") or record.get("output") or "")
            if prompt and response:
                texts.append(build_dialogue_example(prompt, response))
            elif response:
                texts.append(response)
    except Exception as exc:
        logger.warning(f"Failed to load curated learning corpus: {exc}")

    return texts


def collect_training_texts(config: dict, *, auto_learn: bool = True) -> List[str]:
    texts: List[str] = []

    local_corpus = load_local_learning_corpus(
        limit=int(_config_value(config, "training", "max_local_learning_pairs", 500))
    )
    if local_corpus:
        logger.info(f"Adding {len(local_corpus)} locally learned text pairs...")
        texts.extend(normalize_training_text(text) for text in local_corpus if normalize_training_text(text))

    research_corpus = load_recent_research_corpus(
        limit=int(_config_value(config, "training", "dynamic_recent_research_docs", DEFAULT_RECENT_RESEARCH_DOCS))
    )
    if research_corpus:
        logger.info(f"Adding {len(research_corpus)} research documents from the live web knowledge store...")
        texts.extend(research_corpus)

    if auto_learn:
        logger.info("Fetching dynamic knowledge from web...")
        try:
            urls = asyncio.run(discover_dynamic_training_urls(config))
            fetched = asyncio.run(fetch_training_data(urls))
            texts.extend(normalize_training_text(text) for text in fetched if normalize_training_text(text))
            logger.info(f"Added {len(fetched)} web documents")
        except Exception as e:
            logger.warning(f"Web learning failed: {e}")

    unique_texts: List[str] = []
    seen: set[str] = set()
    for text in texts:
        if not text or text in seen:
            continue
        seen.add(text)
        unique_texts.append(text)
    return unique_texts


def prepare_dataset(tokenizer, config: dict, texts: List[str]) -> MemmapDataset:
    """Prepare a fresh training dataset for the current tokenizer."""
    mem_config = config.get("memory", {})
    model_config = config.get("model", {})

    memmap_dir = Path(mem_config.get("memmap_dir", str(DEFAULT_PROCESSED_DIR)))
    reset_processed_dataset(memmap_dir)
    dataset = MemmapDataset(
        MemmapConfig(
            memmap_dir=str(memmap_dir),
            max_seq_len=model_config.get("max_seq_len", 512)
        ),
        tokenizer
    )

    if not texts:
        raise ValueError(
            "No dynamic training corpus available. Add learned pairs, ingest research documents, "
            "or enable live web fetching before training."
        )

    for text in texts:
        dataset.add_text(text)

    while dataset.metadata["total_tokens"] <= dataset.config.max_seq_len:
        for text in texts:
            dataset.add_text(text)
            if dataset.metadata["total_tokens"] > dataset.config.max_seq_len:
                break

    return dataset


def main():
    """Main training function with optimizations."""
    parser = argparse.ArgumentParser(description="Train Whisper AI (Optimized)")
    parser.add_argument("--config", default="config/config.yaml", help="Config file")
    parser.add_argument("--resume", type=str, help="Resume from checkpoint")
    parser.add_argument("--steps", type=int, default=1000, help="Training steps")
    parser.add_argument("--no-web", action="store_true", help="Disable web learning")
    parser.add_argument("--low-power", action="store_true", help="Low power mode")
    parser.add_argument("--rebuild-tokenizer", action="store_true", help="Retrain tokenizer from the current corpus")
    
    args = parser.parse_args()
    
    # Load config
    config = load_config(args.config)
    
    logger.info("=== Whisper AI Training (Optimized) ===")
    
    # Power optimization
    if args.low_power:
        optimize_for_low_power()
    
    training_texts = collect_training_texts(config, auto_learn=not args.no_web)
    logger.info(f"Collected {len(training_texts)} normalized training documents")

    # Tokenizer
    tokenizer_path = Path(_config_value(config, "training", "tokenizer_path", str(DEFAULT_TOKENIZER_PATH)))
    tokenizer_changed = False
    if tokenizer_path.exists():
        tokenizer = WhisperTokenizer.load(str(tokenizer_path))
        if args.rebuild_tokenizer or not tokenizer.is_modern_backend():
            tokenizer = WhisperTokenizer(TokenizerConfig(
                vocab_size=int(_config_value(config, "model", "vocab_size", 16384)),
                min_frequency=int(_config_value(config, "training", "tokenizer_min_frequency", 2)),
                backend=TOKENIZER_BACKEND_BYTELEVEL,
            ))
            tokenizer.train(training_texts, verbose=False)
            tokenizer_path.parent.mkdir(parents=True, exist_ok=True)
            tokenizer.save(str(tokenizer_path))
            tokenizer_changed = True
            logger.info("Rebuilt tokenizer with ByteLevel BPE backend")
        else:
            logger.info("Loaded tokenizer")
    else:
        tokenizer = WhisperTokenizer(TokenizerConfig(
            vocab_size=int(_config_value(config, "model", "vocab_size", 16384)),
            min_frequency=int(_config_value(config, "training", "tokenizer_min_frequency", 2)),
            backend=TOKENIZER_BACKEND_BYTELEVEL,
        ))
        if not training_texts:
            raise RuntimeError(
                "Tokenizer creation requires dynamic training text, but no corpus was available."
            )
        tokenizer.train(training_texts, verbose=False)
        tokenizer_path.parent.mkdir(parents=True, exist_ok=True)
        tokenizer.save(str(tokenizer_path))
        tokenizer_changed = True
        logger.info("Created tokenizer")
    
    # Model
    model_config = config.get("model", {})
    model_config["vocab_size"] = tokenizer.vocab_size()
    transformer_config = TransformerConfig.from_dict(model_config)
    
    checkpoint_path = Path(_config_value(config, "training", "latest_checkpoint_path", str(DEFAULT_LATEST_CHECKPOINT)))
    quantized_checkpoint_path = Path(
        _config_value(
            config,
            "training",
            "latest_quantized_checkpoint_path",
            str(DEFAULT_LATEST_QUANTIZED_CHECKPOINT),
        )
    )
    self_learner_state_path = Path(
        _config_value(
            config,
            "training",
            "self_learner_state_path",
            str(DEFAULT_SELF_LEARNER_STATE_PATH),
        )
    )
    if tokenizer_changed:
        model = MicroTransformer(transformer_config)
        logger.info("Tokenizer changed; starting a fresh model with aligned vocabulary")
    elif args.resume:
        model = MicroTransformer.load(args.resume)
        logger.info(f"Resumed from {args.resume}")
    elif checkpoint_path.exists():
        model = MicroTransformer.load(str(checkpoint_path))
        logger.info("Loaded existing model")
    else:
        model = MicroTransformer(transformer_config)
        logger.info(f"New model: {model.count_parameters():,} params")
    
    # Dataset with fresh tokenization for the current corpus
    dataset = prepare_dataset(tokenizer, config, training_texts)
    logger.info(f"Dataset: {len(dataset)} sequences")
    
    if len(dataset) == 0:
        logger.error("No training data!")
        return
    
    # Training config - optimized for efficiency
    train_config = config.get("training", {})
    training_config = TrainingConfig.from_dict(train_config)
    training_config.max_steps = args.steps
    training_config.checkpoint_dir = train_config.get("checkpoint_dir", str(DEFAULT_CHECKPOINT_DIR))
    training_config.checkpoint_interval = min(500, max(1, args.steps // 2))
    
    # Use efficient settings
    training_config.gradient_accumulation = 4  # Accumulate for stability
    if not torch.cuda.is_available():
        training_config.fp16 = False  # Disable AMP on CPU for stability
    
    trainer = Trainer(
        model=model,
        config=training_config,
        train_dataset=dataset,
        device="cuda" if torch.cuda.is_available() else "cpu"
    )
    
    # Train with checkpointing
    logger.info(f"Training for {args.steps} steps...")
    try:
        trainer.train(resume_from=args.resume)
    except KeyboardInterrupt:
        logger.info("Training interrupted")
    finally:
        # Always save
        checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        model.save(str(checkpoint_path))
        logger.info(f"Model saved to {checkpoint_path}")
        try:
            export_quantized_checkpoint(model, quantized_checkpoint_path)
            logger.info(f"Turbo quant checkpoint saved to {quantized_checkpoint_path}")
        except Exception as exc:
            logger.warning(f"Turbo quant export skipped: {exc}")

        self_learner_state_path.parent.mkdir(parents=True, exist_ok=True)
        self_learner_state_path.write_text(
            json.dumps(
                {
                    "updated_at": time.time(),
                    "steps": trainer.global_step,
                    "dataset_sequences": len(dataset),
                    "dataset_tokens": dataset.metadata.get("total_tokens", 0),
                    "checkpoint_path": str(checkpoint_path),
                    "quantized_checkpoint_path": str(quantized_checkpoint_path),
                    "tokenizer_path": str(tokenizer_path),
                    "tokenizer_backend": tokenizer.config.backend,
                    "tokenizer_modern_backend": tokenizer.is_modern_backend(),
                    "vocab_size": tokenizer.vocab_size(),
                    "best_loss": None if trainer.best_loss == float("inf") else trainer.best_loss,
                    "recent_loss": trainer.loss_history[-10:],
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        try:
            from services import hf_dataset_sync

            if hf_dataset_sync.is_configured():
                synced = hf_dataset_sync.sync_paths(
                    [
                        checkpoint_path,
                        quantized_checkpoint_path,
                        tokenizer_path,
                        self_learner_state_path,
                    ]
                )
                logger.info(f"Synced {len(synced)} self-learner artifacts to {hf_dataset_sync.get_repo_id()}")
        except Exception as exc:
            logger.warning(f"HF sync for self-learner artifacts failed: {exc}")
        
        # Cleanup memory
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
