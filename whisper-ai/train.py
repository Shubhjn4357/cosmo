"""
Whisper AI - Optimized Training Script
Auto-learns from web, uses less power, trains efficiently.
"""

import argparse
import asyncio
import gc
import json
import random
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
from model.tokenizer import WhisperTokenizer, create_pretrained_tokenizer
from training.memmap_dataset import MemmapDataset, MemmapConfig
from training.trainer import Trainer, TrainingConfig
from utils.app_paths import DATA_ROOT, ensure_app_dirs


# Web sources for auto-learning
WEB_SOURCES = [
    "https://en.wikipedia.org/wiki/Artificial_intelligence",
    "https://en.wikipedia.org/wiki/Machine_learning",
    "https://en.wikipedia.org/wiki/Natural_language_processing",
    "https://en.wikipedia.org/wiki/Deep_learning",
    "https://en.wikipedia.org/wiki/Neural_network",
    "https://en.wikipedia.org/wiki/Transformer_(machine_learning_model)",
    "https://en.wikipedia.org/wiki/Python_(programming_language)",
    "https://en.wikipedia.org/wiki/Computer_science",
]

ensure_app_dirs()
DEFAULT_PROCESSED_DIR = DATA_ROOT / "processed"
DEFAULT_CHECKPOINT_DIR = DATA_ROOT / "checkpoints"
DEFAULT_TOKENIZER_PATH = DEFAULT_CHECKPOINT_DIR / "tokenizer.json"
DEFAULT_LATEST_CHECKPOINT = DEFAULT_CHECKPOINT_DIR / "latest.pt"
DEFAULT_LATEST_QUANTIZED_CHECKPOINT = DEFAULT_CHECKPOINT_DIR / "latest-int8.pt"
DEFAULT_SELF_LEARNER_STATE_PATH = DEFAULT_CHECKPOINT_DIR / "state.json"
DEFAULT_TRAINING_PAIRS_PATH = DATA_ROOT / "training_pairs.jsonl"
DEFAULT_EXTERNAL_SOURCES_PATH = DATA_ROOT / "external_sources.jsonl"


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
        text = main.get_text(separator=' ', strip=True)
        # Clean up whitespace
        text = ' '.join(text.split())
        return text[:5000]  # Limit length
    return ""


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

                prompt = (record.get("input") or record.get("prompt") or "").strip()
                response = (record.get("output") or record.get("response") or "").strip()
                if prompt and response:
                    texts.append(f"User: {prompt}\nAssistant: {response}")
                elif response:
                    texts.append(response)

    _read_jsonl(DEFAULT_TRAINING_PAIRS_PATH)
    _read_jsonl(DEFAULT_EXTERNAL_SOURCES_PATH)
    return texts


def prepare_dataset(tokenizer, config: dict, auto_learn: bool = True) -> MemmapDataset:
    """Prepare training dataset with optional web learning."""
    mem_config = config.get("memory", {})
    model_config = config.get("model", {})
    
    dataset = MemmapDataset(
        MemmapConfig(
            memmap_dir=mem_config.get("memmap_dir", str(DEFAULT_PROCESSED_DIR)),
            max_seq_len=model_config.get("max_seq_len", 512)
        ),
        tokenizer
    )
    
    # Add initial seed data if empty
    if len(dataset) == 0:
        logger.info("Adding seed training data...")
        seed_texts = [
            "Whisper AI is a self-learning artificial intelligence that improves through experience.",
            "Machine learning algorithms learn patterns from data to make predictions.",
            "Natural language processing enables computers to understand human language.",
            "Transformers use self-attention to process sequences in parallel efficiently.",
            "Neural networks are inspired by the structure of biological brains.",
            "Deep learning uses multiple layers to learn hierarchical representations.",
        ]
        for text in seed_texts:
            dataset.add_text(text)

        # Ensure at least one full sequence exists for tiny cold starts.
        while dataset.metadata["total_tokens"] <= dataset.config.max_seq_len:
            for text in seed_texts:
                dataset.add_text(text)
                if dataset.metadata["total_tokens"] > dataset.config.max_seq_len:
                    break

    local_corpus = load_local_learning_corpus(
        limit=int(_config_value(config, "training", "max_local_learning_pairs", 500))
    )
    if local_corpus:
        logger.info(f"Adding {len(local_corpus)} locally learned text pairs...")
        for text in local_corpus:
            dataset.add_text(text)

    # Auto-learn from web
    if auto_learn:
        logger.info("Fetching knowledge from web...")
        try:
            urls = random.sample(WEB_SOURCES, min(4, len(WEB_SOURCES)))
            texts = asyncio.run(fetch_training_data(urls))
            
            for text in texts:
                dataset.add_text(text)
            
            logger.info(f"Added {len(texts)} web documents")
        except Exception as e:
            logger.warning(f"Web learning failed: {e}")
    
    return dataset


def main():
    """Main training function with optimizations."""
    parser = argparse.ArgumentParser(description="Train Whisper AI (Optimized)")
    parser.add_argument("--config", default="config/config.yaml", help="Config file")
    parser.add_argument("--resume", type=str, help="Resume from checkpoint")
    parser.add_argument("--steps", type=int, default=1000, help="Training steps")
    parser.add_argument("--no-web", action="store_true", help="Disable web learning")
    parser.add_argument("--low-power", action="store_true", help="Low power mode")
    
    args = parser.parse_args()
    
    # Load config
    config = load_config(args.config)
    
    logger.info("=== Whisper AI Training (Optimized) ===")
    
    # Power optimization
    if args.low_power:
        optimize_for_low_power()
    
    # Tokenizer
    tokenizer_path = Path(_config_value(config, "training", "tokenizer_path", str(DEFAULT_TOKENIZER_PATH)))
    if tokenizer_path.exists():
        tokenizer = WhisperTokenizer.load(str(tokenizer_path))
        logger.info("Loaded tokenizer")
    else:
        tokenizer = create_pretrained_tokenizer()
        tokenizer_path.parent.mkdir(parents=True, exist_ok=True)
        tokenizer.save(str(tokenizer_path))
        logger.info("Created tokenizer")
    
    # Model
    model_config = config.get("model", {})
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
    if args.resume:
        model = MicroTransformer.load(args.resume)
        logger.info(f"Resumed from {args.resume}")
    elif checkpoint_path.exists():
        model = MicroTransformer.load(str(checkpoint_path))
        logger.info("Loaded existing model")
    else:
        model = MicroTransformer(transformer_config)
        logger.info(f"New model: {model.count_parameters():,} params")
    
    # Dataset with auto web learning
    dataset = prepare_dataset(tokenizer, config, auto_learn=not args.no_web)
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
