"""
Whisper AI - Learning and dataset capture routes.
"""

from __future__ import annotations

import csv
import json
import os
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
TRAINING_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
EXTERNAL_SOURCES_PATH.parent.mkdir(parents=True, exist_ok=True)

SYNC_THRESHOLD = int(os.getenv("LEARNING_SYNC_THRESHOLD", "100"))


def get_hf_dataset_repo() -> str:
    return hf_dataset_sync.get_repo_id() or "shubhjn/whisper-trained-data"


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


def _append_jsonl(path: Path, record: dict):
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _count_jsonl_rows(path: Path) -> int:
    if not path.exists():
        return 0
    with open(path, "r", encoding="utf-8") as handle:
        return sum(1 for _ in handle)


def should_sync() -> bool:
    if not get_hf_token():
        return False
    current_count = _count_jsonl_rows(TRAINING_DATA_PATH)
    return current_count - hf_dataset_sync.get_last_sync_count() >= SYNC_THRESHOLD


def sync_to_huggingface():
    if not get_hf_token():
        logger.warning("HF_TOKEN not configured; skipping dataset sync")
        return {
            "status": "skipped",
            "reason": "HF_TOKEN not configured",
        }

    try:
        uploaded = hf_dataset_sync.sync_paths((TRAINING_DATA_PATH, EXTERNAL_SOURCES_PATH))
        synced_count = _count_jsonl_rows(TRAINING_DATA_PATH)
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

    return {
        "status": "learned",
        "model": response.model_name,
        "source": source,
        "synced_to_hf": bool(get_hf_token()),
    }


@router.get("/learn/stats")
async def get_learning_stats():
    total_pairs = _count_jsonl_rows(TRAINING_DATA_PATH)
    external_pairs = _count_jsonl_rows(EXTERNAL_SOURCES_PATH)
    sync_state = hf_dataset_sync.status()
    return {
        "total_training_pairs": total_pairs,
        "external_model_pairs": external_pairs,
        "total_knowledge": total_pairs + external_pairs,
        "huggingface_repo": get_hf_dataset_repo(),
        "hf_sync_enabled": bool(get_hf_token()),
        "last_sync_count": hf_dataset_sync.get_last_sync_count(),
        "pending_sync": max(total_pairs - hf_dataset_sync.get_last_sync_count(), 0),
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
