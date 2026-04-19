"""
Central Hugging Face Model Hub Sync Helpers.

Manages pushing and pulling of self-learning model states to/from Hugging Face Models hub,
allowing ephemeral Spaces to persist fine-tunes indefinitely.
"""

from __future__ import annotations

import os
from pathlib import Path
from loguru import logger
import time

try:
    from huggingface_hub import HfApi, snapshot_download
    HF_HUB_AVAILABLE = True
except ImportError:
    HfApi = None  # type: ignore
    snapshot_download = None  # type: ignore
    HF_HUB_AVAILABLE = False


DEFAULT_HF_MODEL_REPO = "shubhjn/Cosmo-model"

def get_hf_model_repo_id() -> str | None:
    value = os.getenv("HF_MODEL_REPO", "").strip()
    if value:
        return value
    return DEFAULT_HF_MODEL_REPO

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
    return None

def is_configured() -> bool:
    return HF_HUB_AVAILABLE and bool(get_hf_model_repo_id()) and bool(get_hf_token())

def can_read() -> bool:
    return HF_HUB_AVAILABLE and bool(get_hf_model_repo_id())

def _client(*, require_token: bool = True) -> HfApi:
    if not HF_HUB_AVAILABLE:
        raise RuntimeError("huggingface_hub is not installed")
    repo_id = get_hf_model_repo_id()
    token = get_hf_token()
    if not repo_id:
        raise RuntimeError("HF_MODEL_REPO is required")
    if require_token and not token:
        raise RuntimeError("HF_TOKEN is required for model uploads")
    return HfApi(token=token)

def _ensure_repo(api: HfApi):
    try:
        api.create_repo(
            repo_id=get_hf_model_repo_id(),
            repo_type="model",
            private=True, # Self learner models are usually private by default
            exist_ok=True,
            token=get_hf_token(),
        )
    except Exception as exc:
        logger.debug(f"Repo ensure skipped/failed: {exc}")

def push_checkpoints(checkpoint_dir: Path | str, commit_message: str = "Auto-save checkpoint from self-learner") -> bool:
    """Push local checkpoint artifacts directly to the HF Model Hub."""
    if not is_configured():
        logger.warning("HF Model Hub sync is not fully configured (missing HF_TOKEN or HF_MODEL_REPO)")
        return False
        
    checkpoint_dir = Path(checkpoint_dir)
    if not checkpoint_dir.exists():
        logger.warning(f"Checkpoint directory {checkpoint_dir} does not exist, nothing to push.")
        return False

    api = _client(require_token=True)
    _ensure_repo(api)
    
    repo_id = get_hf_model_repo_id()
    try:
        api.upload_folder(
            folder_path=str(checkpoint_dir),
            repo_id=repo_id,  # type: ignore
            repo_type="model",
            commit_message=commit_message,
            token=get_hf_token(),
        )
        logger.info(f"Successfully pushed model checkpoints to {repo_id}")
        description="Scratch-built Cosmo transformer with automatic learning and int8 turbo quant checkpoints."
        return True
    except Exception as exc:
        logger.error(f"Failed to push checkpoints to {repo_id}: {exc}")
        return False

def pull_latest_checkpoint(checkpoint_dir: Path | str) -> bool:
    """Pull the latest state from the HF Model Hub down to the local checkpoint directory."""
    if not can_read():
        logger.warning("HF Model Hub sync cannot read (missing huggingface_hub or HF_MODEL_REPO)")
        return False
        
    checkpoint_dir = Path(checkpoint_dir)
    repo_id = get_hf_model_repo_id()
    
    try:
        download_path = snapshot_download(
            repo_id=repo_id,  # type: ignore
            repo_type="model",
            local_dir=str(checkpoint_dir),
            token=get_hf_token() or None,  # Can use None if public, otherwise needs token
        )
        logger.info(f"Successfully pulled latest model checkpoints to {download_path}")
        return True
    except Exception as exc:
        logger.warning(f"Failed to pull latest checkpoints from {repo_id}: {exc}")
        return False
