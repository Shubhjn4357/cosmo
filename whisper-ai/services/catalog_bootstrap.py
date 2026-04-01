"""
Background bootstrap for approved downloadable text and image models.

The API should start first. This service then downloads approved artifacts
sequentially in the background so low-memory deployments are still responsive
while models are prepared.
"""

from __future__ import annotations

import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from huggingface_hub import hf_hub_download
from loguru import logger

from services.approved_model_catalog import (
    ImageModelSpec,
    TextModelSpec,
    bootstrap_image_models,
    bootstrap_text_models,
)
from utils.app_paths import DATA_ROOT, MODELS_DIR, ensure_app_dirs

ensure_app_dirs()

CATALOG_DIR = MODELS_DIR / "catalog"
CATALOG_STATUS_DIR = DATA_ROOT / "runtime" / "catalog_bootstrap"
CATALOG_STATUS_DIR.mkdir(parents=True, exist_ok=True)

_LOCK = threading.Lock()
_THREAD: threading.Thread | None = None
_STATE: dict[str, Any] = {
    "started_at": None,
    "updated_at": None,
    "running": False,
    "status": "idle",
    "items": {},
}


def _env_enabled(name: str, default: bool) -> bool:
    configured = os.getenv(name)
    if configured is None:
        return default
    return configured.strip().lower() == "true"


def _test_mode_enabled() -> bool:
    return os.getenv("WHISPER_TEST_MODE", "false").lower() == "true"


def _bootstrap_enabled() -> bool:
    return _env_enabled("WHISPER_BOOTSTRAP_APPROVED_MODELS", True) and not _test_mode_enabled()


def _hf_token() -> str | None:
    return os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_API_KEY")


def _target_path(kind: str, model_id: str, filename: str) -> Path:
    return CATALOG_DIR / kind / model_id / filename


def _artifact_exists(kind: str, model_id: str, filename: str) -> bool:
    path = _target_path(kind, model_id, filename)
    return path.exists() and path.is_file() and path.stat().st_size > 0


def _update_item(model_id: str, **updates):
    _STATE["items"].setdefault(model_id, {})
    _STATE["items"][model_id].update(updates)
    _STATE["updated_at"] = time.time()


def _serializable_items() -> list[dict[str, Any]]:
    items = []
    for model_id, item in _STATE["items"].items():
        items.append({"id": model_id, **item})
    return sorted(items, key=lambda item: (item.get("kind", ""), item["id"]))


def _download(kind: str, spec: TextModelSpec | ImageModelSpec):
    if not spec.filename:
        _update_item(
            spec.id,
            name=spec.name,
            kind=kind,
            status="remote_only",
            repo_id=spec.repo_id,
            filename="",
            artifact_path="",
            adult=getattr(spec, "adult", False),
        )
        return

    target = _target_path(kind, spec.id, spec.filename)
    target.parent.mkdir(parents=True, exist_ok=True)

    if target.exists() and target.stat().st_size > 0:
        _update_item(
            spec.id,
            name=spec.name,
            kind=kind,
            status="ready",
            repo_id=spec.repo_id,
            filename=spec.filename,
            artifact_path=str(target),
            adult=getattr(spec, "adult", False),
            size_bytes=target.stat().st_size,
        )
        return

    _update_item(
        spec.id,
        name=spec.name,
        kind=kind,
        status="downloading",
        repo_id=spec.repo_id,
        filename=spec.filename,
        artifact_path=str(target),
        adult=getattr(spec, "adult", False),
    )

    cached_path = hf_hub_download(
        repo_id=spec.repo_id,
        filename=spec.filename,
        token=_hf_token(),
    )
    temp_target = target.with_suffix(f"{target.suffix}.part")
    if temp_target.exists():
        temp_target.unlink()
    shutil.copy2(cached_path, temp_target)
    temp_target.replace(target)

    _update_item(
        spec.id,
        name=spec.name,
        kind=kind,
        status="ready",
        repo_id=spec.repo_id,
        filename=spec.filename,
        artifact_path=str(target),
        adult=getattr(spec, "adult", False),
        size_bytes=target.stat().st_size,
        downloaded_at=time.time(),
    )


def _bootstrap_worker():
    _STATE["running"] = True
    _STATE["status"] = "running"
    _STATE["updated_at"] = time.time()

    try:
        for spec in bootstrap_text_models():
            try:
                _download("text", spec)
            except Exception as exc:
                logger.warning(f"Approved text bootstrap failed for {spec.id}: {exc}")
                _update_item(
                    spec.id,
                    name=spec.name,
                    kind="text",
                    status="failed",
                    repo_id=spec.repo_id,
                    filename=spec.filename,
                    artifact_path=str(_target_path("text", spec.id, spec.filename)),
                    adult=spec.adult,
                    error=str(exc),
                )

        for spec in bootstrap_image_models():
            try:
                _download("image", spec)
            except Exception as exc:
                logger.warning(f"Approved image bootstrap failed for {spec.id}: {exc}")
                _update_item(
                    spec.id,
                    name=spec.name,
                    kind="image",
                    status="failed",
                    repo_id=spec.repo_id,
                    filename=spec.filename,
                    artifact_path=str(_target_path("image", spec.id, spec.filename)),
                    adult=spec.adult,
                    error=str(exc),
                )

        _STATE["status"] = "completed"
    finally:
        _STATE["running"] = False
        _STATE["updated_at"] = time.time()


def get_catalog_bootstrap_status() -> dict[str, Any]:
    if not _bootstrap_enabled():
        return {
            "enabled": False,
            "status": "disabled",
            "running": False,
            "started_at": _STATE["started_at"],
            "updated_at": _STATE["updated_at"],
            "items": _serializable_items(),
        }
    return {
        "enabled": True,
        "status": _STATE["status"],
        "running": _STATE["running"],
        "started_at": _STATE["started_at"],
        "updated_at": _STATE["updated_at"],
        "items": _serializable_items(),
    }


def start_catalog_bootstrap() -> dict[str, Any]:
    global _THREAD

    with _LOCK:
        if not _bootstrap_enabled():
            return get_catalog_bootstrap_status()
        if _THREAD is not None and _THREAD.is_alive():
            return get_catalog_bootstrap_status()

        _STATE["started_at"] = _STATE["started_at"] or time.time()
        _THREAD = threading.Thread(target=_bootstrap_worker, name="catalog-bootstrap", daemon=True)
        _THREAD.start()
        logger.info("Started background approved model bootstrap")
        return get_catalog_bootstrap_status()


def resolve_bootstrap_artifact(kind: str, model_id: str, filename: str) -> dict[str, Any]:
    path = _target_path(kind, model_id, filename)
    exists = path.exists() and path.is_file() and path.stat().st_size > 0
    item = dict(_STATE["items"].get(model_id, {}))
    item.update(
        {
            "artifact_path": str(path),
            "downloaded": exists,
            "size_bytes": path.stat().st_size if exists else item.get("size_bytes", 0),
        }
    )
    return item


def ensure_bootstrap_artifact(
    kind: str,
    *,
    model_id: str,
    name: str,
    repo_id: str,
    filename: str,
    adult: bool = False,
) -> dict[str, Any]:
    if not filename:
        _update_item(
            model_id,
            name=name,
            kind=kind,
            status="remote_only",
            repo_id=repo_id,
            filename="",
            artifact_path="",
            adult=adult,
        )
        return resolve_bootstrap_artifact(kind, model_id, filename)

    with _LOCK:
        current = resolve_bootstrap_artifact(kind, model_id, filename)
        if current.get("downloaded"):
            return current

        if kind == "text":
            spec = TextModelSpec(
                id=model_id,
                name=name,
                description="",
                repo_id=repo_id,
                filename=filename,
                size_mb=0,
                ram_required_gb=0.0,
                speed="unknown",
                quantization="",
                adult=adult,
            )
        else:
            spec = ImageModelSpec(
                id=model_id,
                name=name,
                description="",
                provider="downloadable",
                repo_id=repo_id,
                generation_mode="image",
                filename=filename,
                adult=adult,
            )

        _download(kind, spec)
        return resolve_bootstrap_artifact(kind, model_id, filename)
