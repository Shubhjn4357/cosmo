"""
Application path helpers for local and HF Spaces deployments.
"""

from __future__ import annotations

import os
import uuid
import warnings
from pathlib import Path

# Absolute base directory of the repository
APP_ROOT = Path(__file__).resolve().parent.parent

def _should_suppress_fallback_warning(original: Path, fallback: Path) -> bool:
    original_str = str(original)
    fallback_str = str(fallback)
    return original_str.startswith("/data") and not fallback_str.startswith("/data")


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
        probe = path / f".cosmo-write-test-{uuid.uuid4().hex}"
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
                if not _should_suppress_fallback_warning(first_path, path):
                    warnings.warn(
                        f"{label} path '{first_path}' is not writable ({first_reason}); using '{path}' instead.",
                        RuntimeWarning,
                    )
            return path
        errors.append((path, reason or "unknown error"))

    attempts = ", ".join(f"{candidate}: {reason}" for candidate, reason in errors)
    raise RuntimeError(f"Could not find a writable directory for {label}. Tried: {attempts}")


def _candidate_data_roots() -> list[Path]:
    configured = os.getenv("COSMO_DATA_ROOT", "").strip()
    persistent_volume = os.getenv("COSMO_PERSISTENT_VOLUME_ROOT", "").strip()
    use_persistent_volume = os.getenv("COSMO_USE_PERSISTENT_VOLUME", "false").lower() == "true"
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured))
    if persistent_volume:
        candidates.append(Path(persistent_volume))
    if use_persistent_volume and Path("/data").exists():
        candidates.append(Path("/data/cosmo"))
    # Always resolve these against the absolute APP_ROOT to avoid relative CWD issues
    candidates.extend([APP_ROOT / "data", Path("/tmp/cosmo")])
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
                if not _should_suppress_fallback_warning(first_path.parent, path.parent):
                    warnings.warn(
                        f"{env_name} path '{first_path}' is not writable ({first_reason}); using '{path}' instead.",
                        RuntimeWarning,
                    )
            return path
        errors.append((path, reason or "unknown error"))

    attempts = ", ".join(f"{candidate}: {reason}" for candidate, reason in errors)
    raise RuntimeError(f"Could not find a writable file location for {env_name}. Tried: {attempts}")


# Lazy accessors
_DATA_ROOT: Path | None = None
_DATASETS_DIR: Path | None = None
_DB_PATH: Path | None = None

def get_data_root() -> Path:
    global _DATA_ROOT
    if _DATA_ROOT is None:
        _DATA_ROOT = _choose_writable_directory("COSMO_DATA_ROOT", _candidate_data_roots())
    return _DATA_ROOT

def get_datasets_dir() -> Path:
    global _DATASETS_DIR
    if _DATASETS_DIR is None:
        _DATASETS_DIR = _resolve_configured_directory("COSMO_DATASET_DIR", get_data_root() / "datasets")
    return _DATASETS_DIR

def get_db_path() -> Path:
    global _DB_PATH
    if _DB_PATH is None:
        _DB_PATH = _resolve_configured_file("COSMO_DB_PATH", get_data_root() / "db" / "cosmo.db")
    return _DB_PATH

_MODELS_DIR: Path | None = None
_UPLOADS_DIR: Path | None = None
_HF_HOME_DIR: Path | None = None
_HUGGINGFACE_HUB_CACHE_DIR: Path | None = None
_PYTHON_USER_BASE: Path | None = None
_RUNTIME_CONFIG_PATH: Path | None = None
_UI_DIR: Path | None = None

def get_models_dir() -> Path:
    global _MODELS_DIR
    if _MODELS_DIR is None:
        _MODELS_DIR = _resolve_configured_directory("COSMO_MODELS_DIR", get_data_root() / "models")
    return _MODELS_DIR

def get_uploads_dir() -> Path:
    global _UPLOADS_DIR
    if _UPLOADS_DIR is None:
        _UPLOADS_DIR = _resolve_configured_directory("COSMO_UPLOADS_DIR", get_data_root() / "uploads")
    return _UPLOADS_DIR

def get_hf_home_dir() -> Path:
    global _HF_HOME_DIR
    if _HF_HOME_DIR is None:
        _HF_HOME_DIR = _resolve_configured_directory("HF_HOME", get_data_root() / "runtime" / "huggingface")
    return _HF_HOME_DIR

def get_huggingface_hub_cache_dir() -> Path:
    global _HUGGINGFACE_HUB_CACHE_DIR
    if _HUGGINGFACE_HUB_CACHE_DIR is None:
        _HUGGINGFACE_HUB_CACHE_DIR = _resolve_configured_directory("HUGGINGFACE_HUB_CACHE", get_hf_home_dir() / "hub")
    return _HUGGINGFACE_HUB_CACHE_DIR

def get_python_user_base() -> Path:
    global _PYTHON_USER_BASE
    if _PYTHON_USER_BASE is None:
        _PYTHON_USER_BASE = _resolve_configured_directory("PYTHONUSERBASE", get_data_root() / "runtime" / "python-user-base")
    return _PYTHON_USER_BASE

def get_runtime_config_path() -> Path:
    global _RUNTIME_CONFIG_PATH
    if _RUNTIME_CONFIG_PATH is None:
        _RUNTIME_CONFIG_PATH = _resolve_configured_file("COSMO_RUNTIME_CONFIG", get_data_root() / "runtime" / "runtime_config.json")
    return _RUNTIME_CONFIG_PATH

def get_ui_dir() -> Path:
    global _UI_DIR
    if _UI_DIR is None:
        _UI_DIR = APP_ROOT / "frontend" / "dist"
    return _UI_DIR

def __getattr__(name: str) -> Any:  # type: ignore
    if name == "DATA_ROOT":
        return get_data_root()
    if name == "DATASETS_DIR":
        return get_datasets_dir()
    if name == "DB_PATH":
        return get_db_path()
    if name == "MODELS_DIR":
        return get_models_dir()
    if name == "UPLOADS_DIR":
        return get_uploads_dir()
    if name == "HF_HOME_DIR":
        return get_hf_home_dir()
    if name == "HUGGINGFACE_HUB_CACHE_DIR":
        return get_huggingface_hub_cache_dir()
    if name == "PYTHON_USER_BASE":
        return get_python_user_base()
    if name == "RUNTIME_CONFIG_PATH":
        return get_runtime_config_path()
    if name == "UI_DIR":
        return get_ui_dir()
    raise AttributeError(f"module {__name__} has no attribute {name}")

def ensure_app_dirs():
    """Explicitly create all required directories. Called only during main boot."""
    root = get_data_root()
    root.mkdir(parents=True, exist_ok=True)
    get_datasets_dir().mkdir(parents=True, exist_ok=True)
    get_db_path().parent.mkdir(parents=True, exist_ok=True)
    
    get_models_dir().mkdir(parents=True, exist_ok=True)
    get_uploads_dir().mkdir(parents=True, exist_ok=True)
    get_hf_home_dir().mkdir(parents=True, exist_ok=True)
    get_huggingface_hub_cache_dir().mkdir(parents=True, exist_ok=True)
    get_python_user_base().mkdir(parents=True, exist_ok=True)
    get_runtime_config_path().parent.mkdir(parents=True, exist_ok=True)
    get_ui_dir().mkdir(parents=True, exist_ok=True)
    
    # Sync environment variables for libraries that expect them
    os.environ["COSMO_DATA_ROOT"] = str(root)
    os.environ["COSMO_DB_PATH"] = str(get_db_path())
    os.environ["HF_HOME"] = str(get_hf_home_dir())
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(get_huggingface_hub_cache_dir())
    os.environ.setdefault("HF_HOME", str(get_huggingface_hub_cache_dir()))
