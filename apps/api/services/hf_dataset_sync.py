"""
Central Hugging Face dataset sync helpers.

This consolidates the repo's runtime persistence, learning sync, and dataset
upload/download flows onto one consistent remote layout and one persisted sync
status file under the managed app data root.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Iterable

from loguru import logger

from utils.app_paths import DATA_ROOT, ensure_app_dirs

try:
    from huggingface_hub import HfApi, hf_hub_download

    HF_HUB_AVAILABLE = True
except ImportError:
    HfApi = None  # type: ignore
    hf_hub_download = None  # type: ignore
    HF_HUB_AVAILABLE = False


# ensure_app_dirs() - Moved to app.py

SYNC_STATE_PATH = DATA_ROOT / "runtime" / "hf_dataset_sync.json"
MANAGED_ROOT_FILENAMES = {
    "training_pairs.jsonl",
    "feedback.jsonl",
    "external_sources.jsonl",
    "crawled_documents.jsonl",
}


def _relative_managed_path(path: Path) -> str | None:
    try:
        relative = path.resolve().relative_to(DATA_ROOT.resolve())
        return relative.as_posix()
    except Exception:
        return None


def _default_state() -> dict:
    return {
        "configured": False,
        "available": HF_HUB_AVAILABLE,
        "repo_id": None,
        "last_action": None,
        "last_error": None,
        "last_validated_at": None,
        "last_sync_at": None,
        "last_download_at": None,
        "last_sync_count": 0,
        "uploaded_files": [],
        "downloaded_files": [],
        "remote_file_count": 0,
        "remote_files_sample": [],
        "last_success": None,
    }


def _load_state() -> dict:
    state = _default_state()
    if SYNC_STATE_PATH.exists():
        try:
            state.update(json.loads(SYNC_STATE_PATH.read_text(encoding="utf-8")))
        except Exception as exc:
            logger.warning(f"Failed to parse HF sync state: {exc}")

    state["configured"] = is_configured()
    state["read_configured"] = can_read()
    state["write_configured"] = can_write()
    state["available"] = HF_HUB_AVAILABLE
    state["repo_id"] = get_repo_id()
    return state


def _save_state(state: dict):
    SYNC_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    SYNC_STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _update_state(**changes) -> dict:
    state = _load_state()
    state.update(changes)
    _save_state(state)
    return state


def get_repo_id() -> str | None:
    value = os.getenv("HF_DATASET_REPO", "").strip()
    if value:
        return value
    fallback = os.getenv("COSMO_DEFAULT_HF_DATASET_REPO", "").strip()
    return fallback or None


def get_hf_token() -> str | None:
    for env_name in (
        "HF_TOKEN",
        "HUGGINGFACE_API_KEY",
        "HUGGING_FACE_HUB_TOKEN",
        "HUGGINGFACEHUB_API_TOKEN",
    ):
        value = os.getenv(env_name, "").strip()
        if value:
            return value
        secret_path = Path(f"/run/secrets/{env_name}")
        if secret_path.exists():
            return secret_path.read_text(encoding="utf-8").strip()
    return None


def is_configured() -> bool:
    return can_write()


def can_read() -> bool:
    return bool(HF_HUB_AVAILABLE and get_repo_id())


def can_write() -> bool:
    return bool(can_read() and get_hf_token())


def status() -> dict:
    return _load_state()


def get_last_sync_count() -> int:
    return int(_load_state().get("last_sync_count") or 0)


def set_last_sync_count(count: int) -> dict:
    return _update_state(last_sync_count=max(0, int(count)))


def remote_path_for_local_path(local_path: Path | str) -> str:
    path = Path(local_path)
    managed_relative = _relative_managed_path(path)
    if managed_relative:
        return managed_relative
    safe_name = path.name
    if safe_name in MANAGED_ROOT_FILENAMES:
        return safe_name
    return f"datasets/{safe_name}"


def remote_candidates_for_local_path(local_path: Path | str) -> list[str]:
    path = Path(local_path)
    safe_name = path.name
    candidates = [remote_path_for_local_path(path)]
    managed_relative = _relative_managed_path(path)
    if managed_relative and managed_relative not in candidates:
        candidates.append(managed_relative)
    if safe_name not in candidates:
        candidates.append(safe_name)
    dataset_candidate = f"datasets/{safe_name}"
    if dataset_candidate not in candidates:
        candidates.append(dataset_candidate)
    return candidates


def _client(*, require_token: bool = True) -> HfApi:
    if not HF_HUB_AVAILABLE:
        raise RuntimeError("huggingface_hub is not installed")
    repo_id = get_repo_id()
    token = get_hf_token()
    if not repo_id:
        raise RuntimeError("HF_DATASET_REPO is required")
    if require_token and not token:
        raise RuntimeError("HF_TOKEN is required for dataset uploads")
    return HfApi(token=token)


def list_remote_files(prefix: str | None = None) -> list[str]:
    if not can_read():
        raise RuntimeError("HF_DATASET_REPO is required")
    files = _client(require_token=False).list_repo_files(
        repo_id=get_repo_id(),  # type: ignore
        repo_type="dataset",
        token=get_hf_token() or None,
    )
    _remember_file_list(files=files)
    if not prefix:
        return files
    normalized = prefix.strip("/")
    if not normalized:
        return files
    return [item for item in files if item == normalized or item.startswith(f"{normalized}/")]


def _remember_file_list(*, uploaded: str | None = None, downloaded: str | None = None, files: list[str] | None = None):
    state = _load_state()
    if uploaded:
        items = [uploaded] + [item for item in state.get("uploaded_files", []) if item != uploaded]
        state["uploaded_files"] = items[:20]
    if downloaded:
        items = [downloaded] + [item for item in state.get("downloaded_files", []) if item != downloaded]
        state["downloaded_files"] = items[:20]
    if files is not None:
        state["remote_file_count"] = len(files)
        state["remote_files_sample"] = files[:20]
    _save_state(state)


def validate_remote() -> dict:
    base = _load_state()
    if not can_read():
        return {
            **base,
            "reachable": False,
            "message": "HF dataset sync is not configured",
        }

    try:
        api = _client(require_token=False)
        files = api.list_repo_files(repo_id=get_repo_id(), repo_type="dataset", token=get_hf_token() or None)  # type: ignore
        _remember_file_list(files=files)
        state = _update_state(
            last_action="validate",
            last_validated_at=time.time(),
            last_error=None,
            last_success="validate",
        )
        return {
            **state,
            "reachable": True,
            "message": "Remote dataset repo is reachable",
        }
    except Exception as exc:
        state = _update_state(
            last_action="validate",
            last_validated_at=time.time(),
            last_error=str(exc),
        )
        return {
            **state,
            "reachable": False,
            "message": str(exc),
        }


def _ensure_repo(api: HfApi):
    api.create_repo(
        repo_id=get_repo_id(),
        repo_type="dataset",
        private=os.getenv("HF_DATASET_PRIVATE", "false").lower() == "true",
        exist_ok=True,
        token=get_hf_token(),
    )


def sync_path(local_path: Path | str, remote_path: str | None = None) -> dict:
    path = Path(local_path)
    if not path.exists():
        raise FileNotFoundError(str(path))
    if not can_write():
        raise RuntimeError("HF_DATASET_REPO and HF_TOKEN are required for uploads")

    remote_name = remote_path or remote_path_for_local_path(path)
    api = _client(require_token=True)
    _ensure_repo(api)
    api.upload_file(
        path_or_fileobj=str(path),
        path_in_repo=remote_name,
        repo_id=get_repo_id(),  # type: ignore
        repo_type="dataset",
        token=get_hf_token(),
    )
    _remember_file_list(uploaded=remote_name)
    state = _update_state(
        last_action="upload",
        last_sync_at=time.time(),
        last_error=None,
        last_success="upload",
    )
    return {
        "local_path": str(path),
        "remote_path": remote_name,
        "size_bytes": path.stat().st_size,
        "repo_id": get_repo_id(),
        "state": state,
    }


def sync_paths(paths: Iterable[Path | str]) -> list[dict]:
    results = []
    for item in paths:
        path = Path(item)
        if not path.exists():
            continue
        results.append(sync_path(path))
    return results


def sync_directory(
    local_dir: Path | str,
    remote_prefix: str | None = None,
    *,
    skip_suffixes: tuple[str, ...] = (".part", ".tmp", ".lock"),
) -> dict:
    root = Path(local_dir)
    if not root.exists():
        raise FileNotFoundError(str(root))
    if root.is_file():
        result = sync_path(root, remote_path=remote_prefix)
        return {
            "local_path": str(root),
            "remote_prefix": result["remote_path"],
            "file_count": 1,
            "results": [result],
        }

    prefix = (remote_prefix or _relative_managed_path(root) or root.name).strip("/")
    results: list[dict] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if any(path.name.endswith(suffix) for suffix in skip_suffixes):
            continue
        relative = path.relative_to(root).as_posix()
        remote_path = f"{prefix}/{relative}" if prefix else relative
        results.append(sync_path(path, remote_path=remote_path))

    _update_state(
        last_action="upload-directory",
        last_sync_at=time.time(),
        last_error=None,
        last_success="upload-directory",
        last_sync_count=len(results),
    )
    return {
        "local_path": str(root),
        "remote_prefix": prefix,
        "file_count": len(results),
        "results": results,
    }


def _download_remote_path(target: Path, remote_path: str) -> dict:
    if hf_hub_download is None:
        raise RuntimeError("huggingface_hub is not installed")

    downloaded_path = hf_hub_download(
        repo_id=get_repo_id(),  # type: ignore
        filename=remote_path,
        repo_type="dataset",
        token=get_hf_token() or None,
    )
    downloaded = Path(downloaded_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    if downloaded.resolve() != target.resolve():
        target.write_bytes(downloaded.read_bytes())

    _remember_file_list(downloaded=remote_path)
    return {
        "local_path": str(target),
        "remote_path": remote_path,
        "size_bytes": target.stat().st_size if target.exists() else 0,
        "repo_id": get_repo_id(),
    }


def download_to_path(local_path: Path | str, remote_candidates: list[str] | None = None) -> dict:
    target = Path(local_path)
    if not can_read():
        raise RuntimeError("HF_DATASET_REPO is required")
    files = list_remote_files()

    candidates = remote_candidates or remote_candidates_for_local_path(target)
    matched = next((candidate for candidate in candidates if candidate in files), None)
    if matched is None:
        raise FileNotFoundError(f"No remote file found for {target.name}")

    result = _download_remote_path(target, matched)
    state = _update_state(
        last_action="download",
        last_download_at=time.time(),
        last_error=None,
        last_success="download",
    )
    result["state"] = state
    return result


def download_directory(local_dir: Path | str, remote_prefix: str | None = None) -> dict:
    target_root = Path(local_dir)
    prefix = (remote_prefix or _relative_managed_path(target_root) or target_root.name).strip("/")
    remote_files = list_remote_files(prefix)
    normalized_prefix = f"{prefix}/" if prefix else ""

    results: list[dict] = []
    for remote_path in remote_files:
        relative = remote_path[len(normalized_prefix):] if normalized_prefix and remote_path.startswith(normalized_prefix) else remote_path
        if not relative:
            relative = Path(remote_path).name
        local_path = target_root / relative
        results.append(_download_remote_path(local_path, remote_path))

    state = _update_state(
        last_action="download-directory",
        last_download_at=time.time(),
        last_error=None,
        last_success="download-directory",
        last_sync_count=len(results),
    )
    return {
        "local_path": str(target_root),
        "remote_prefix": prefix,
        "file_count": len(results),
        "results": results,
        "state": state,
    }
