"""
Cosmo AI - Learning and dataset capture routes.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel

from .auth import verify_admin_token
from services import hf_dataset_sync
from utils.app_paths import DATA_ROOT, ensure_app_dirs


router = APIRouter()

ensure_app_dirs()
TRAINING_DATA_PATH = DATA_ROOT / "training_pairs.jsonl"
EXTERNAL_SOURCES_PATH = DATA_ROOT / "external_sources.jsonl"
RESEARCH_INGEST_STATE_PATH = DATA_ROOT / "learning" / "research_ingest_state.json"
TRAINING_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
EXTERNAL_SOURCES_PATH.parent.mkdir(parents=True, exist_ok=True)
RESEARCH_INGEST_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)

SYNC_THRESHOLD = int(os.getenv("LEARNING_SYNC_THRESHOLD", "100"))
AUTO_TRAIN_THRESHOLD = int(os.getenv("COSMO_SELF_LEARNER_AUTO_TRAIN_MIN_NEW_PAIRS", "8"))
AUTO_TRAIN_STEPS = int(os.getenv("COSMO_SELF_LEARNER_AUTO_TRAIN_STEPS", "64"))
_LAST_AUTO_TRAIN_COUNT = 0


def get_hf_dataset_repo() -> str:
    return hf_dataset_sync.get_repo_id() or "shubhjn/cosmo-data"


def get_hf_token() -> str | None:
    return hf_dataset_sync.get_hf_token()


class UniversalTrainingPair(BaseModel):
    input: str
    output: str
    source: str = "unknown"
    metadata: Optional[dict] = None
    quality_score: Optional[float] = None


class BatchTrainingRequest(BaseModel):
    pairs: List[UniversalTrainingPair]
    contributor: Optional[str] = None


class ExternalModelResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    prompt: str
    response: str
    model_name: str
    provider: Optional[str] = None
    metadata: Optional[dict] = None


class LegacyTrainingRequest(BaseModel):
    input: str
    output: str
    model: str = "user-feedback"
    userId: Optional[str] = None


def _append_jsonl(path: Path, record: dict):
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _count_jsonl_rows(path: Path) -> int:
    if not path.exists():
        return 0
    with open(path, "r", encoding="utf-8") as handle:
        return sum(1 for _ in handle)


def get_learning_corpus_counts() -> dict[str, int]:
    curated_text_pairs = 0
    try:
        from services.curated_training_import import count_curated_text_records

        curated_text_pairs = count_curated_text_records()
    except Exception as exc:
        logger.warning(f"Failed to count curated text records: {exc}")

    training_pairs = _count_jsonl_rows(TRAINING_DATA_PATH)
    external_sources = _count_jsonl_rows(EXTERNAL_SOURCES_PATH)
    return {
        "training_pairs": training_pairs,
        "external_sources": external_sources,
        "curated_text_pairs": curated_text_pairs,
        "total_sequences": training_pairs + external_sources + curated_text_pairs,
    }


def should_sync() -> bool:
    if not get_hf_token():
        return False
    current_count = get_learning_corpus_counts()["total_sequences"]
    return current_count - hf_dataset_sync.get_last_sync_count() >= SYNC_THRESHOLD


def sync_to_huggingface():
    if not get_hf_token():
        logger.warning("HF_TOKEN not configured; skipping dataset sync")
        return {
            "status": "skipped",
            "reason": "HF_TOKEN not configured",
        }

    try:
        extra_paths = []
        try:
            from services.curated_training_import import list_local_curated_files

            extra_paths = [item["path"] for item in list_local_curated_files()]
        except Exception as exc:
            logger.warning(f"Failed to enumerate curated datasets for sync: {exc}")

        uploaded = hf_dataset_sync.sync_paths((TRAINING_DATA_PATH, EXTERNAL_SOURCES_PATH, *extra_paths))
        synced_count = get_learning_corpus_counts()["total_sequences"]
        hf_dataset_sync.set_last_sync_count(synced_count)
        logger.info(f"Synced learning datasets to {get_hf_dataset_repo()}")
        return {
            "status": "synced",
            "repo": get_hf_dataset_repo(),
            "uploaded": uploaded,
            "last_sync_count": synced_count,
        }
    except Exception as exc:
        logger.error(f"Hugging Face dataset sync failed: {exc}")
        return {
            "status": "failed",
            "repo": get_hf_dataset_repo(),
            "error": str(exc),
        }


def _maybe_start_self_learner_training(current_count: int):
    global _LAST_AUTO_TRAIN_COUNT

    if os.getenv("COSMO_SELF_LEARNER_AUTO_TRAINING", "true").lower() != "true":
        return
    if current_count < AUTO_TRAIN_THRESHOLD or current_count - _LAST_AUTO_TRAIN_COUNT < AUTO_TRAIN_THRESHOLD:
        return

    try:
        from api.route import get_app_state
        from services.system_jobs import start_training_job

        result = start_training_job(get_app_state(), AUTO_TRAIN_STEPS)
        if result.get("success"):
            _LAST_AUTO_TRAIN_COUNT = current_count
            logger.info(
                "Auto-started self-learner training at {} captured pairs for {} steps",
                current_count,
                AUTO_TRAIN_STEPS,
            )
    except Exception as exc:
        logger.warning(f"Could not auto-start self-learner training: {exc}")


def _load_research_ingest_state() -> dict[str, list[str]]:
    if not RESEARCH_INGEST_STATE_PATH.exists():
        return {"fingerprints": []}
    try:
        payload = json.loads(RESEARCH_INGEST_STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"fingerprints": []}
    fingerprints = payload.get("fingerprints") or []
    return {"fingerprints": [str(item) for item in fingerprints if item]}


def _save_research_ingest_state(payload: dict[str, list[str]]) -> None:
    RESEARCH_INGEST_STATE_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _normalize_learning_text(value: str) -> str:
    return " ".join(str(value or "").split()).strip()


def _split_learning_sentences(text: str) -> list[str]:
    normalized = _normalize_learning_text(text)
    if not normalized:
        return []
    parts = re.split(r"(?<=[.!?])\s+", normalized)
    return [part.strip() for part in parts if len(part.strip()) >= 24]


def _learning_keywords(document: dict) -> set[str]:
    seed = " ".join(
        str(value or "")
        for value in (
            document.get("title"),
            document.get("topic"),
            document.get("domain"),
            document.get("provider"),
        )
    )
    return {
        token.lower()
        for token in re.findall(r"[A-Za-z0-9][A-Za-z0-9_./+-]{2,}", seed)
        if len(token) >= 3
    }


def _sentence_score(sentence: str, *, keywords: set[str]) -> int:
    score = 0
    lowered = sentence.lower()
    words = set(re.findall(r"[A-Za-z0-9][A-Za-z0-9_./+-]{2,}", lowered))
    score += len(words & keywords) * 5
    sentence_len = len(sentence)
    if 40 <= sentence_len <= 220:
        score += 4
    elif 25 <= sentence_len <= 280:
        score += 2
    if any(char.isdigit() for char in sentence):
        score += 2
    if ":" in sentence or "`" in sentence:
        score += 1
    return score


def _extract_summary_sentences(document: dict, chunk: str, *, max_sentences: int = 3) -> list[str]:
    sentences = _split_learning_sentences(chunk)
    if not sentences:
        return []

    keywords = _learning_keywords(document)
    ranked = sorted(
        (
            (_sentence_score(sentence, keywords=keywords), index, sentence)
            for index, sentence in enumerate(sentences)
        ),
        key=lambda item: (item[0], -item[1]),
        reverse=True,
    )
    selected = sorted(ranked[: max(1, max_sentences)], key=lambda item: item[1])
    unique: list[str] = []
    seen: set[str] = set()
    for _, _, sentence in selected:
        key = sentence.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(sentence)
    return unique[: max(1, max_sentences)]


def _research_heading(document: dict) -> str:
    return _normalize_learning_text(
        document.get("title") or document.get("topic") or document.get("domain") or "Untitled source"
    )


def _build_research_learning_records(document: dict, chunk: str, chunk_index: int, chunk_count: int) -> list[dict]:
    heading = _research_heading(document)
    domain = _normalize_learning_text(document.get("domain") or "web")
    provider = _normalize_learning_text(document.get("provider") or "research")
    summary_sentences = _extract_summary_sentences(document, chunk, max_sentences=3)
    summary_text = " ".join(summary_sentences).strip()
    bullet_summary = "\n".join(f"- {sentence}" for sentence in summary_sentences).strip()

    records: list[dict] = [
        {
            "record_type": "source_chunk",
            "prompt": (
                f"Source note from {domain}"
                f" | {heading}"
                f" | chunk {chunk_index + 1}/{chunk_count}"
            ),
            "response": chunk,
            "metadata": {
                "summary_sentence_count": len(summary_sentences),
                "provider_label": provider,
            },
        }
    ]

    if summary_text:
        records.append(
            {
                "record_type": "source_summary",
                "prompt": (
                    f"Summarize the key takeaways from {heading}"
                    f" using notes gathered from {domain}."
                ),
                "response": summary_text,
                "metadata": {
                    "summary_sentence_count": len(summary_sentences),
                    "provider_label": provider,
                },
            }
        )
        records.append(
            {
                "record_type": "source_qa",
                "prompt": (
                    f"What should a coding assistant remember about {heading}"
                    f" from this {domain} research source?"
                ),
                "response": bullet_summary or summary_text,
                "metadata": {
                    "summary_sentence_count": len(summary_sentences),
                    "provider_label": provider,
                },
            }
        )

    return records


def _chunk_learning_text(text: str, *, max_chars: int, max_chunks: int) -> list[str]:
    normalized = _normalize_learning_text(text)
    if not normalized:
        return []

    if len(normalized) <= max_chars:
        return [normalized]

    chunks: list[str] = []
    cursor = 0
    text_length = len(normalized)
    while cursor < text_length and len(chunks) < max_chunks:
        end = min(text_length, cursor + max_chars)
        if end < text_length:
            split_at = normalized.rfind(". ", cursor, end)
            if split_at <= cursor + (max_chars // 2):
                split_at = normalized.rfind(" ", cursor, end)
            if split_at > cursor:
                end = split_at + 1
        chunk = normalized[cursor:end].strip()
        if chunk:
            chunks.append(chunk)
        cursor = max(end, cursor + 1)
    return chunks


def _research_chunk_fingerprint(document: dict, chunk: str, chunk_index: int, record_type: str) -> str:
    digest = hashlib.sha256()
    digest.update(str(document.get("provider") or "research").encode("utf-8"))
    digest.update(str(document.get("url") or document.get("source_url") or "").encode("utf-8"))
    digest.update(str(document.get("title") or document.get("topic") or "").encode("utf-8"))
    digest.update(str(chunk_index).encode("utf-8"))
    digest.update(str(record_type or "source_chunk").encode("utf-8"))
    digest.update(chunk.encode("utf-8", errors="ignore"))
    return digest.hexdigest()


def save_external_source_record(
    record: dict,
    background_tasks: Optional[BackgroundTasks] = None,
) -> dict[str, int]:
    _append_jsonl(EXTERNAL_SOURCES_PATH, record)
    counts = get_learning_corpus_counts()
    _maybe_start_self_learner_training(counts["total_sequences"])

    if background_tasks is not None and should_sync():
        background_tasks.add_task(sync_to_huggingface)

    return counts


def ingest_research_documents(
    documents: List[dict],
    *,
    chunk_chars: int = 1200,
    max_chunks_per_document: int = 2,
    background_tasks: Optional[BackgroundTasks] = None,
) -> dict[str, int]:
    state = _load_research_ingest_state()
    seen = set(state.get("fingerprints") or [])
    new_fingerprints: list[str] = []
    added = 0
    skipped = 0
    added_by_type: dict[str, int] = {}

    for document in documents:
        text = str(document.get("text") or "").strip()
        if len(text) < 80:
            skipped += 1
            continue

        chunks = _chunk_learning_text(
            text,
            max_chars=max(200, int(chunk_chars)),
            max_chunks=max(1, int(max_chunks_per_document)),
        )
        if not chunks:
            skipped += 1
            continue

        for chunk_index, chunk in enumerate(chunks):
            learning_records = _build_research_learning_records(document, chunk, chunk_index, len(chunks))
            if not learning_records:
                skipped += 1
                continue

            for learning_record in learning_records:
                record_type = str(learning_record.get("record_type") or "source_chunk")
                fingerprint = _research_chunk_fingerprint(document, chunk, chunk_index, record_type)
                if fingerprint in seen:
                    skipped += 1
                    continue

                record = {
                    "prompt": learning_record["prompt"],
                    "response": learning_record["response"],
                    "source": f"research:{document.get('provider') or 'unknown'}",
                    "provider": document.get("provider"),
                    "topic": document.get("topic"),
                    "title": document.get("title"),
                    "domain": document.get("domain"),
                    "url": document.get("url") or document.get("source_url"),
                    "timestamp": document.get("timestamp") or time.time(),
                    "metadata": {
                        "source_url": document.get("source_url"),
                        "policy": document.get("policy") or {},
                        "provenance": document.get("provenance") or {},
                        "chunk_index": chunk_index,
                        "chunk_count": len(chunks),
                        "record_type": record_type,
                        "fingerprint": fingerprint,
                        **(learning_record.get("metadata") or {}),
                    },
                }
                _append_jsonl(EXTERNAL_SOURCES_PATH, record)
                new_fingerprints.append(fingerprint)
                seen.add(fingerprint)
                added += 1
                added_by_type[record_type] = added_by_type.get(record_type, 0) + 1

    if new_fingerprints:
        combined = (state.get("fingerprints") or []) + new_fingerprints
        _save_research_ingest_state({"fingerprints": combined[-5000:]})

    counts = get_learning_corpus_counts()
    if added:
        _maybe_start_self_learner_training(counts["total_sequences"])

    if background_tasks is not None and should_sync():
        background_tasks.add_task(sync_to_huggingface)

    return {
        "added": added,
        "skipped": skipped,
        "record_types": added_by_type,
        "training_pairs": counts["training_pairs"],
        "external_sources": counts["external_sources"],
        "total_sequences": counts["total_sequences"],
    }


def save_training_pair(
    input_text: str,
    output_text: str,
    source: str = "unknown",
    metadata: Optional[dict] = None,
    background_tasks: Optional[BackgroundTasks] = None,
):
    record = {
        "input": input_text,
        "output": output_text,
        "source": source,
        "metadata": metadata or {},
        "timestamp": time.time(),
    }
    _append_jsonl(TRAINING_DATA_PATH, record)
    current_count = get_learning_corpus_counts()["total_sequences"]

    _maybe_start_self_learner_training(current_count)

    if background_tasks is not None and should_sync():
        background_tasks.add_task(sync_to_huggingface)


@router.post("/learn/single")
async def submit_single_pair(pair: UniversalTrainingPair, background_tasks: BackgroundTasks):
    save_training_pair(
        pair.input,
        pair.output,
        pair.source,
        {**(pair.metadata or {}), "quality_score": pair.quality_score},
        background_tasks,
    )
    return {
        "status": "learned",
        "source": pair.source,
        "message": "Training pair stored",
        "synced_to_hf": bool(get_hf_token()),
    }


@router.post("/learn/add")
async def submit_single_pair_compat(pair: LegacyTrainingRequest, background_tasks: BackgroundTasks):
    """Compatibility alias used by the mobile app."""
    save_training_pair(
        pair.input,
        pair.output,
        pair.model or "user-feedback",
        {"user_id": pair.userId} if pair.userId else None,
        background_tasks,
    )
    return {
        "status": "learned",
        "source": pair.model or "user-feedback",
        "message": "Training data submitted",
        "synced_to_hf": bool(get_hf_token()),
    }


@router.post("/learn/batch")
async def submit_batch_pairs(batch: BatchTrainingRequest, background_tasks: BackgroundTasks):
    count = 0
    for pair in batch.pairs:
        save_training_pair(
            pair.input,
            pair.output,
            pair.source,
            {**(pair.metadata or {}), "quality_score": pair.quality_score},
            background_tasks if count == len(batch.pairs) - 1 else None,
        )
        count += 1

    return {
        "status": "learned",
        "count": count,
        "contributor": batch.contributor,
        "synced_to_hf": bool(get_hf_token()),
    }


@router.post("/learn/external-model")
async def learn_from_external_model(response: ExternalModelResponse, background_tasks: BackgroundTasks):
    source = f"{response.provider}:{response.model_name}" if response.provider else response.model_name
    save_training_pair(
        response.prompt,
        response.response,
        source,
        response.metadata,
        background_tasks,
    )
    _append_jsonl(
        EXTERNAL_SOURCES_PATH,
        {
            "prompt": response.prompt,
            "response": response.response,
            "model": response.model_name,
            "provider": response.provider,
            "metadata": response.metadata or {},
            "timestamp": time.time(),
        },
    )
    _maybe_start_self_learner_training(get_learning_corpus_counts()["total_sequences"])

    return {
        "status": "learned",
        "model": response.model_name,
        "source": source,
        "synced_to_hf": bool(get_hf_token()),
    }


@router.get("/learn/stats")
async def get_learning_stats():
    counts = get_learning_corpus_counts()
    total_pairs = counts["training_pairs"]
    external_pairs = counts["external_sources"]
    sync_state = hf_dataset_sync.status()
    return {
        "total_training_pairs": total_pairs,
        "external_model_pairs": external_pairs,
        "curated_text_pairs": counts["curated_text_pairs"],
        "total_knowledge": counts["total_sequences"],
        "total_sequences": counts["total_sequences"],
        "learning_enabled": True,
        "restrictions": "none",
        "content_filter": "disabled",
        "huggingface_repo": get_hf_dataset_repo(),
        "hf_sync_enabled": bool(get_hf_token()),
        "last_sync_count": hf_dataset_sync.get_last_sync_count(),
        "pending_sync": max(counts["total_sequences"] - hf_dataset_sync.get_last_sync_count(), 0),
        "hf_sync": {
            "configured": sync_state.get("configured"),
            "available": sync_state.get("available"),
            "last_action": sync_state.get("last_action"),
            "last_sync_at": sync_state.get("last_sync_at"),
            "last_error": sync_state.get("last_error"),
            "remote_file_count": sync_state.get("remote_file_count"),
        },
        "files": {
            "training": str(TRAINING_DATA_PATH),
            "external": str(EXTERNAL_SOURCES_PATH),
            "curated_root": str((DATA_ROOT / "datasets" / "curated")),
        },
    }


@router.get("/learn/hf-status")
async def get_hf_sync_status(payload: dict = Depends(verify_admin_token)):
    return {
        **hf_dataset_sync.status(),
        "repo": get_hf_dataset_repo(),
    }


@router.post("/learn/validate-remote")
async def validate_hf_remote(payload: dict = Depends(verify_admin_token)):
    return hf_dataset_sync.validate_remote()


@router.post("/learn/sync-now")
async def manual_sync(
    background_tasks: BackgroundTasks,
    wait: bool = False,
    payload: dict = Depends(verify_admin_token),
):
    if not get_hf_token():
        raise HTTPException(status_code=400, detail="HF_TOKEN not configured")
    if wait:
        result = sync_to_huggingface()
        if result.get("status") == "failed":
            raise HTTPException(status_code=500, detail=result.get("error"))
        return result
    background_tasks.add_task(sync_to_huggingface)
    return {
        "status": "queued",
        "repo": get_hf_dataset_repo(),
    }


@router.post("/learn/import-dataset")
async def import_dataset(
    file_path: str,
    source_name: str = "imported",
    background_tasks: BackgroundTasks = None,
    payload: dict = Depends(verify_admin_token),
):
    import_path = Path(file_path)
    if not import_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    count = 0

    if import_path.suffix.lower() == ".csv":
        with open(import_path, "r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                if row.get("input") and row.get("output"):
                    save_training_pair(
                        row["input"],
                        row["output"],
                        source=f"import:{source_name}",
                        metadata={k: v for k, v in row.items() if k not in {"input", "output"}},
                    )
                    count += 1
    else:
        with open(import_path, "r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if record.get("input") and record.get("output"):
                    save_training_pair(
                        record["input"],
                        record["output"],
                        source=f"import:{source_name}",
                        metadata=record.get("metadata"),
                    )
                    count += 1

    if background_tasks is not None and get_hf_token():
        background_tasks.add_task(sync_to_huggingface)

    return {
        "status": "imported",
        "count": count,
        "source": source_name,
    }


@router.get("/learn/download-from-hf")
async def download_from_huggingface(payload: dict = Depends(verify_admin_token)):
    if not get_hf_token():
        raise HTTPException(status_code=400, detail="HF_TOKEN not configured")

    try:
        downloaded = {}
        for target_path in (TRAINING_DATA_PATH, EXTERNAL_SOURCES_PATH):
            try:
                result = hf_dataset_sync.download_to_path(target_path)
                downloaded[Path(result["local_path"]).name] = result
            except FileNotFoundError:
                continue
    except Exception as exc:
        logger.error(f"Download from Hugging Face failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "status": "downloaded",
        "repo": get_hf_dataset_repo(),
        "files": downloaded,
    }
