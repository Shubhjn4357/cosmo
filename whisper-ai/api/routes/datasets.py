"""
Dataset management endpoints.

Provides upload, listing, download, and Hugging Face dataset sync helpers.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .auth import verify_admin_token
from services import hf_dataset_sync
from utils.app_paths import DATA_ROOT, DATASETS_DIR, ensure_app_dirs


router = APIRouter(prefix="/datasets", tags=["datasets"])

ensure_app_dirs()

MANAGED_DATASETS = [
    DATA_ROOT / "training_pairs.jsonl",
    DATA_ROOT / "feedback.jsonl",
    DATA_ROOT / "external_sources.jsonl",
    DATA_ROOT / "crawled_documents.jsonl",
]


def _resolve_dataset(dataset_name: str) -> Path | None:
    safe_name = Path(dataset_name).name

    for path in MANAGED_DATASETS:
        if path.exists() and path.name == safe_name:
            return path

    candidate = DATASETS_DIR / safe_name
    if candidate.exists():
        return candidate

    return None


def _dataset_info(path: Path) -> dict:
    info = {
        "name": path.name,
        "path": str(path),
        "size_bytes": path.stat().st_size,
        "modified_at": path.stat().st_mtime,
    }
    if path.suffix == ".jsonl":
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as handle:
                info["rows"] = sum(1 for _ in handle)
        except Exception:
            info["rows"] = None
    return info


@router.get("")
async def list_datasets(payload: dict = Depends(verify_admin_token)):
    datasets: List[dict] = []
    seen: set[str] = set()

    for path in MANAGED_DATASETS:
        if path.exists() and path.name not in seen:
            datasets.append(_dataset_info(path))
            seen.add(path.name)

    for path in sorted(DATASETS_DIR.glob("*")):
        if path.is_file() and path.name not in seen:
            datasets.append(_dataset_info(path))
            seen.add(path.name)

    return {
        "datasets": datasets,
        "count": len(datasets),
        "dataset_dir": str(DATASETS_DIR),
    }


@router.post("/upload")
async def upload_dataset(file: UploadFile = File(...), payload: dict = Depends(verify_admin_token)):
    filename = Path(file.filename or "").name
    if not filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    target = DATASETS_DIR / filename
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    with open(target, "wb") as handle:
        handle.write(content)

    return {
        "status": "uploaded",
        "dataset": _dataset_info(target),
    }


@router.get("/download/{dataset_name}")
async def download_dataset(dataset_name: str, payload: dict = Depends(verify_admin_token)):
    path = _resolve_dataset(dataset_name)
    if path is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return FileResponse(path=path, filename=path.name, media_type="application/octet-stream")


@router.post("/sync/{dataset_name}")
async def sync_dataset_to_hf(dataset_name: str, payload: dict = Depends(verify_admin_token)):
    path = _resolve_dataset(dataset_name)
    if path is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    repo_id = hf_dataset_sync.get_repo_id()
    hf_token = hf_dataset_sync.get_hf_token()
    if not repo_id or not hf_token:
        raise HTTPException(status_code=400, detail="HF_DATASET_REPO and HF_TOKEN are required")

    try:
        result = hf_dataset_sync.sync_path(path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Hugging Face sync failed: {exc}") from exc

    return {
        "status": "synced",
        "repo_id": repo_id,
        "dataset": path.name,
        "remote_path": result["remote_path"],
    }
