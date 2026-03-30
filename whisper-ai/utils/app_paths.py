"""
Application path helpers for local and HF Spaces deployments.
"""

from __future__ import annotations

import os
from pathlib import Path


def _default_data_root() -> Path:
    if Path("/data").exists():
        return Path("/data/whisper")
    return Path("data")


DATA_ROOT = Path(os.getenv("WHISPER_DATA_ROOT", str(_default_data_root())))
DATASETS_DIR = Path(os.getenv("WHISPER_DATASET_DIR", str(DATA_ROOT / "datasets")))
DB_PATH = Path(os.getenv("WHISPER_DB_PATH", str(DATA_ROOT / "db" / "whisper.db")))
UPLOADS_DIR = Path(
    os.getenv(
        "WHISPER_UPLOADS_DIR",
        str(DATA_ROOT / "uploads" if DATA_ROOT != Path("data") else Path("uploads")),
    )
)
MODELS_DIR = Path(
    os.getenv(
        "WHISPER_MODELS_DIR",
        str(DATA_ROOT / "models" if DATA_ROOT != Path("data") else Path("models")),
    )
)
RUNTIME_CONFIG_PATH = Path(os.getenv("WHISPER_RUNTIME_CONFIG", str(DATA_ROOT / "runtime" / "runtime_config.json")))


def ensure_app_dirs():
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
