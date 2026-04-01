"""
Application path helpers for local and HF Spaces deployments.
"""

from __future__ import annotations

import os
import warnings
from pathlib import Path


def _unique_paths(paths: list[Path]) -> list[Path]:
    unique: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def _ensure_writable_directory(path: Path) -> tuple[bool, str | None]:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".whisper-write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True, None
    except Exception as exc:  # pragma: no cover - platform-dependent permission failures
        return False, str(exc)


def _choose_writable_directory(label: str, candidates: list[Path]) -> Path:
    errors: list[tuple[Path, str]] = []
    ordered = _unique_paths(candidates)
    for path in ordered:
        ok, reason = _ensure_writable_directory(path)
        if ok:
            if errors:
                first_path, first_reason = errors[0]
                warnings.warn(
                    f"{label} path '{first_path}' is not writable ({first_reason}); using '{path}' instead.",
                    RuntimeWarning,
                )
            return path
        errors.append((path, reason or "unknown error"))

    attempts = ", ".join(f"{candidate}: {reason}" for candidate, reason in errors)
    raise RuntimeError(f"Could not find a writable directory for {label}. Tried: {attempts}")


def _candidate_data_roots() -> list[Path]:
    configured = os.getenv("WHISPER_DATA_ROOT", "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured))
    if Path("/data").exists():
        candidates.append(Path("/data/whisper"))
    candidates.extend([Path("data"), Path("/tmp/whisper")])
    return candidates


def _resolve_configured_directory(env_name: str, default: Path, *, extra_fallbacks: list[Path] | None = None) -> Path:
    configured = os.getenv(env_name, "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured))
    candidates.append(default)
    if extra_fallbacks:
        candidates.extend(extra_fallbacks)
    return _choose_writable_directory(env_name or "directory", candidates)


def _resolve_configured_file(env_name: str, default: Path) -> Path:
    configured = os.getenv(env_name, "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured))
    candidates.append(default)

    errors: list[tuple[Path, str]] = []
    for path in _unique_paths(candidates):
        ok, reason = _ensure_writable_directory(path.parent)
        if ok:
            if errors:
                first_path, first_reason = errors[0]
                warnings.warn(
                    f"{env_name} path '{first_path}' is not writable ({first_reason}); using '{path}' instead.",
                    RuntimeWarning,
                )
            return path
        errors.append((path, reason or "unknown error"))

    attempts = ", ".join(f"{candidate}: {reason}" for candidate, reason in errors)
    raise RuntimeError(f"Could not find a writable file location for {env_name}. Tried: {attempts}")


DATA_ROOT = _choose_writable_directory("WHISPER_DATA_ROOT", _candidate_data_roots())
DATASETS_DIR = _resolve_configured_directory("WHISPER_DATASET_DIR", DATA_ROOT / "datasets")
DB_PATH = _resolve_configured_file("WHISPER_DB_PATH", DATA_ROOT / "db" / "whisper.db")
UPLOADS_DIR = _resolve_configured_directory(
    "WHISPER_UPLOADS_DIR",
    DATA_ROOT / "uploads" if DATA_ROOT != Path("data") else Path("uploads"),
    extra_fallbacks=[DATA_ROOT / "uploads"],
)
MODELS_DIR = _resolve_configured_directory(
    "WHISPER_MODELS_DIR",
    DATA_ROOT / "models" if DATA_ROOT != Path("data") else Path("models"),
    extra_fallbacks=[DATA_ROOT / "models"],
)
RUNTIME_CONFIG_PATH = _resolve_configured_file(
    "WHISPER_RUNTIME_CONFIG",
    DATA_ROOT / "runtime" / "runtime_config.json",
)
PYTHON_USER_BASE = _resolve_configured_directory(
    "PYTHONUSERBASE",
    DATA_ROOT / "runtime" / "python-user-base",
)
HF_HOME_DIR = _resolve_configured_directory(
    "HF_HOME",
    DATA_ROOT / "runtime" / "huggingface",
)
HUGGINGFACE_HUB_CACHE_DIR = _resolve_configured_directory(
    "HUGGINGFACE_HUB_CACHE",
    HF_HOME_DIR / "hub",
)

os.environ["WHISPER_DATA_ROOT"] = str(DATA_ROOT)
os.environ["WHISPER_DATASET_DIR"] = str(DATASETS_DIR)
os.environ["WHISPER_DB_PATH"] = str(DB_PATH)
os.environ["WHISPER_UPLOADS_DIR"] = str(UPLOADS_DIR)
os.environ["WHISPER_MODELS_DIR"] = str(MODELS_DIR)
os.environ["WHISPER_RUNTIME_CONFIG"] = str(RUNTIME_CONFIG_PATH)
os.environ["PYTHONUSERBASE"] = str(PYTHON_USER_BASE)
os.environ["HF_HOME"] = str(HF_HOME_DIR)
os.environ["HUGGINGFACE_HUB_CACHE"] = str(HUGGINGFACE_HUB_CACHE_DIR)
os.environ.setdefault("TRANSFORMERS_CACHE", str(HUGGINGFACE_HUB_CACHE_DIR))


def ensure_app_dirs():
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    PYTHON_USER_BASE.mkdir(parents=True, exist_ok=True)
    HF_HOME_DIR.mkdir(parents=True, exist_ok=True)
    HUGGINGFACE_HUB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
