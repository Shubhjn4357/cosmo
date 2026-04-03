"""
Whisper AI - Data Persistence via HuggingFace Datasets
Automatically backs up and restores training data across container rebuilds.
"""

import os
import json
from pathlib import Path
from typing import Optional
from loguru import logger

from services import hf_dataset_sync
from utils.app_paths import DATA_ROOT, MODELS_DIR, ensure_app_dirs
from utils.system_tuning import env_flag_enabled

# ensure_app_dirs() - Moved to app.py

TRAINING_PAIRS_PATH = DATA_ROOT / "training_pairs.jsonl"
FEEDBACK_PATH = DATA_ROOT / "feedback.jsonl"
EXTERNAL_SOURCES_PATH = DATA_ROOT / "external_sources.jsonl"
RESEARCH_DOCUMENTS_PATH = DATA_ROOT / "crawled_documents.jsonl"
RESEARCH_HISTORY_PATH = DATA_ROOT / "research" / "history.jsonl"
SCRAPER_STATE_PATH = DATA_ROOT / "raw" / "scraper_state.json"
KNOWLEDGE_INDEX_PATH = DATA_ROOT / "knowledge" / "faiss.index"
KNOWLEDGE_METADATA_PATH = DATA_ROOT / "knowledge" / "metadata.jsonl"
RUNTIME_CONFIG_PATH = DATA_ROOT / "runtime" / "runtime_config.json"
ADMIN_MODEL_STATE_PATH = DATA_ROOT / "admin_model_state.json"
SELF_LEARNER_CHECKPOINT_PATH = DATA_ROOT / "checkpoints" / "latest.pt"
SELF_LEARNER_INT8_CHECKPOINT_PATH = DATA_ROOT / "checkpoints" / "latest-int8.pt"
SELF_LEARNER_TOKENIZER_PATH = DATA_ROOT / "checkpoints" / "tokenizer.json"
SELF_LEARNER_STATE_PATH = DATA_ROOT / "checkpoints" / "state.json"


def get_repo_id() -> Optional[str]:
    return hf_dataset_sync.get_repo_id()


def get_hf_token() -> Optional[str]:
    return hf_dataset_sync.get_hf_token()

# Files to persist
PERSIST_FILES = [
    str(TRAINING_PAIRS_PATH),
    str(FEEDBACK_PATH),
    str(EXTERNAL_SOURCES_PATH),
    str(RESEARCH_DOCUMENTS_PATH),
    str(RESEARCH_HISTORY_PATH),
    str(SCRAPER_STATE_PATH),
    str(KNOWLEDGE_INDEX_PATH),
    str(KNOWLEDGE_METADATA_PATH),
    str(RUNTIME_CONFIG_PATH),
    str(ADMIN_MODEL_STATE_PATH),
    str(SELF_LEARNER_CHECKPOINT_PATH),
    str(SELF_LEARNER_INT8_CHECKPOINT_PATH),
    str(SELF_LEARNER_TOKENIZER_PATH),
    str(SELF_LEARNER_STATE_PATH),
]


def persist_models_dir_enabled() -> bool:
    return env_flag_enabled(
        "WHISPER_PERSIST_MODELS_DIR",
        False,
        disable_in_low_power=True,
    )


def get_persist_directories() -> list[str]:
    directories: list[str] = []
    if persist_models_dir_enabled():
        directories.append(str(MODELS_DIR))
    return directories


def get_api(*, for_write: bool = False):
    """Backward-compatible configuration check for startup persistence."""
    if for_write:
        if not hf_dataset_sync.can_write():
            if not get_hf_token():
                logger.warning("HF_TOKEN not set. Dataset upload persistence disabled.")
            if not get_repo_id():
                logger.warning("HF_DATASET_REPO not set. Dataset upload persistence disabled.")
            return None
    else:
        if not hf_dataset_sync.can_read():
            if not get_repo_id():
                logger.warning("HF_DATASET_REPO not set. Dataset restore disabled.")
            return None
    return object()


def restore_data():
    """
    Restore training data from HuggingFace Dataset on startup.
    Called during server initialization.
    """
    api = get_api(for_write=False)
    if not api:
        logger.info("Data persistence not configured. Starting fresh.")
        return
    repo_id = get_repo_id()

    logger.info(f"Restoring data from {repo_id}...")
    
    for file_path in PERSIST_FILES:
        try:
            local_path = Path(file_path)
            local_path.parent.mkdir(parents=True, exist_ok=True)
            result = hf_dataset_sync.download_to_path(local_path)
            logger.info(f"Restored: {file_path} from repo file {result['remote_path']}")
        except Exception as e:
            logger.debug(f"Could not restore {file_path}: {e}")
            # File might not exist yet, that's OK

    if not persist_models_dir_enabled():
        logger.info("Managed model directory restore disabled by configuration")

    for directory_path in get_persist_directories():
        try:
            result = hf_dataset_sync.download_directory(directory_path)
            if result["file_count"] > 0:
                logger.info(
                    f"Restored directory: {directory_path} ({result['file_count']} files) from prefix {result['remote_prefix']}"
                )
        except Exception as e:
            logger.debug(f"Could not restore directory {directory_path}: {e}")
    
    logger.info("Data restoration complete.")


def backup_data():
    """
    Backup training data to HuggingFace Dataset.
    Called periodically or on shutdown.
    """
    api = get_api(for_write=True)
    if not api:
        return

    logger.info(f"Backing up data to {get_repo_id()}...")
    
    for file_path in PERSIST_FILES:
        try:
            local_path = Path(file_path)
            if not local_path.exists():
                continue

            result = hf_dataset_sync.sync_path(local_path)
            logger.info(f"Backed up: {file_path} to {result['remote_path']}")
        except Exception as e:
            logger.error(f"Failed to backup {file_path}: {e}")

    if not persist_models_dir_enabled():
        logger.info("Managed model directory backup disabled by configuration")

    for directory_path in get_persist_directories():
        try:
            local_path = Path(directory_path)
            if not local_path.exists():
                continue
            result = hf_dataset_sync.sync_directory(local_path)
            logger.info(
                f"Backed up directory: {directory_path} ({result['file_count']} files) to prefix {result['remote_prefix']}"
            )
        except Exception as e:
            logger.error(f"Failed to backup directory {directory_path}: {e}")
    
    logger.info("Data backup complete.")


def backup_file(file_path: str):
    """Backup a single file immediately."""
    api = get_api(for_write=True)
    if not api:
        return
    
    try:
        local_path = Path(file_path)
        if not local_path.exists():
            return

        result = hf_dataset_sync.sync_path(local_path)
        logger.debug(f"Incremental backup: {file_path} to {result['remote_path']}")
    except Exception as e:
        logger.warning(f"Incremental backup failed for {file_path}: {e}")


# Convenience function for training data
def append_training_pair(user_input: str, ai_response: str, model: str = "whisper"):
    """
    Append a training pair and trigger incremental backup.
    """
    file_path = TRAINING_PAIRS_PATH
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    pair = {
        "input": user_input,
        "output": ai_response,
        "model": model,
    }
    
    with open(file_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(pair, ensure_ascii=False) + "\n")
    
    # Backup every 10 pairs (check file size)
    try:
        line_count = sum(1 for _ in open(file_path, "r", encoding="utf-8"))
        if line_count % 10 == 0:
            backup_file(str(file_path))
    except:
        pass
