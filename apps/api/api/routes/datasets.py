"""
Dataset management endpoints.

Provides upload, listing, download, and Hugging Face dataset sync helpers.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

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


class CuratedImportRequest(BaseModel):
    spec_ids: Optional[List[str]] = None
    max_rows: Optional[int] = None
    auto_sync: bool = False


class HuggingFaceDatasetImportRequest(BaseModel):
    dataset_id: str
    config_name: Optional[str] = None
    split: Optional[str] = "train"
    kind: Literal["auto", "text", "image_prompt", "vision", "all", "both"] = "auto"
    max_rows: Optional[int] = None
    auto_sync: bool = False


def _resolve_dataset(dataset_name: str) -> Path | None:
    safe_name = Path(dataset_name).name

    for path in MANAGED_DATASETS:
        if path.exists() and path.name == safe_name:
            return path

    candidate = DATASETS_DIR / safe_name
    if candidate.exists():
        return candidate

    try:
        from services.curated_training_import import list_local_curated_files

        for item in list_local_curated_files():
            path = Path(item["path"])
            if path.exists() and path.name == safe_name:
                return path
    except Exception:
        return None

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


def list_dataset_entries() -> list[dict]:
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

    try:
        from services.curated_training_import import list_local_curated_files

        for item in list_local_curated_files():
            path = Path(item["path"])
            if not path.exists() or path.name in seen:
                continue
            info = _dataset_info(path)
            info["kind"] = item.get("kind") or "curated"
            datasets.append(info)
            seen.add(path.name)
    except Exception:
        pass

    return datasets


@router.get("")
async def list_datasets(payload: dict = Depends(verify_admin_token)):
    datasets = list_dataset_entries()

    return {
        "datasets": datasets,
        "count": len(datasets),
        "dataset_dir": str(DATASETS_DIR),
    }


@router.get("/curated/catalog")
async def curated_catalog(payload: dict = Depends(verify_admin_token)):
    from services.curated_training_import import list_curated_specs, list_local_curated_files
    from services.image_prompt_library import image_prompt_library

    return {
        "datasets": list_curated_specs(),
        "local_files": list_local_curated_files(),
        "image_prompt_prior": image_prompt_library.status(),
    }


@router.post("/curated/import")
async def import_curated(request: CuratedImportRequest, payload: dict = Depends(verify_admin_token)):
    from services.curated_training_import import import_curated_datasets

    max_rows = request.max_rows
    if max_rows is not None and max_rows < 1:
        raise HTTPException(status_code=400, detail="max_rows must be positive")

    try:
        results = import_curated_datasets(
            request.spec_ids,
            max_rows=max_rows,
            auto_sync=request.auto_sync,
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"Unknown curated dataset id: {exc.args[0]}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Curated import failed: {exc}") from exc

    total_rows = sum(int(item.get("rows_imported") or 0) for item in results)
    return {
        "status": "imported",
        "results": results,
        "count": len(results),
        "rows_imported": total_rows,
    }


@router.post("/hf/import")
async def import_huggingface_dataset(
    request: HuggingFaceDatasetImportRequest,
    payload: dict = Depends(verify_admin_token),
):
    from services.curated_training_import import import_hf_dataset

    max_rows = request.max_rows
    if max_rows is not None and max_rows < 1:
        raise HTTPException(status_code=400, detail="max_rows must be positive")

    dataset_id = str(request.dataset_id or "").strip()
    if not dataset_id or "/" not in dataset_id:
        raise HTTPException(status_code=400, detail="dataset_id must look like 'owner/name'")

    try:
        result = import_hf_dataset(
            dataset_id,
            config_name=request.config_name,
            split=request.split,
            kind=request.kind,
            max_rows=max_rows,
            auto_sync=request.auto_sync,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Hugging Face dataset import failed: {exc}") from exc

    return {
        "status": "imported",
        "result": result,
        "rows_imported": int(result.get("rows_imported") or 0),
        "rows_imported_by_kind": result.get("rows_imported_by_kind") or {},
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
