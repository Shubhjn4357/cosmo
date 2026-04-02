"""
Background GGUF runtime bootstrap helpers.

Starts optional GGUF preparation after the API is already serving requests:
- queue the GGUF model download into the managed model store
- compile/install llama-cpp-python in a background subprocess when needed
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Optional

from loguru import logger

from services.model_manager import get_download_jobs, get_profile, queue_profile_download
from services.runtime_manager import _resolve_llama_cli_path
from utils.app_paths import DATA_ROOT, ensure_app_dirs
from utils.system_tuning import env_flag_enabled

ensure_app_dirs()

REPO_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOG_DIR = DATA_ROOT / "runtime" / "logs"
RUNTIME_LOG_DIR.mkdir(parents=True, exist_ok=True)
INSTALL_LOG_PATH = RUNTIME_LOG_DIR / "gguf_runtime_install.log"

_LOCK = threading.Lock()
_INSTALL_PROCESS: Optional[subprocess.Popen] = None
_INSTALL_LOG_HANDLE: Optional[Any] = None
_LAST_ERROR: Optional[str] = None
_STARTED_AT: Optional[float] = None


def _env_enabled(name: str, default: bool) -> bool:
    configured = os.getenv(name)
    if configured is None:
        return default
    return configured.strip().lower() == "true"


def _test_mode_enabled() -> bool:
    return os.getenv("WHISPER_TEST_MODE", "false").lower() == "true"


def _bootstrap_enabled() -> bool:
    return (
        env_flag_enabled(
            "WHISPER_BOOTSTRAP_GGUF_RUNTIME",
            True,
            disable_in_low_power=True,
        )
        and not _test_mode_enabled()
    )


def _download_enabled() -> bool:
    return _env_enabled("WHISPER_BOOTSTRAP_GGUF_DOWNLOAD", True)


def _install_enabled() -> bool:
    return _env_enabled("WHISPER_BOOTSTRAP_GGUF_INSTALL", True)


def _package_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def _backend_available() -> bool:
    return _package_available("llama_cpp") or _resolve_llama_cli_path() is not None


def _gguf_artifact_path() -> Path:
    return Path(get_profile("gguf-coder").gguf_model_path)


def _current_download_job() -> Optional[dict[str, Any]]:
    jobs = [
        job
        for job in get_download_jobs()
        if job.get("profile_id") == "gguf-coder"
    ]
    if not jobs:
        return None
    return max(jobs, key=lambda item: item.get("created_at", 0))


def _close_install_log():
    global _INSTALL_LOG_HANDLE
    if _INSTALL_LOG_HANDLE is None:
        return
    try:
        _INSTALL_LOG_HANDLE.close()
    except Exception:
        pass
    _INSTALL_LOG_HANDLE = None


def _tail_log(path: Path, max_chars: int = 800) -> str:
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore").strip()
    except Exception:
        return ""
    return text[-max_chars:] if len(text) > max_chars else text


def _install_status() -> dict[str, Any]:
    global _INSTALL_PROCESS, _LAST_ERROR

    if _INSTALL_PROCESS is None:
        required = _install_enabled() and not _backend_available()
        status = "completed" if not required else "idle"
        return {
            "enabled": _install_enabled(),
            "required": required,
            "status": status,
            "pid": None,
            "log_path": str(INSTALL_LOG_PATH),
            "error": _LAST_ERROR,
        }

    returncode = _INSTALL_PROCESS.poll()
    if returncode is None:
        return {
            "enabled": _install_enabled(),
            "required": True,
            "status": "running",
            "pid": _INSTALL_PROCESS.pid,
            "log_path": str(INSTALL_LOG_PATH),
            "error": None,
        }

    _INSTALL_PROCESS = None
    _close_install_log()
    importlib.invalidate_caches()

    if returncode == 0:
        _LAST_ERROR = None
        return {
            "enabled": _install_enabled(),
            "required": not _backend_available(),
            "status": "completed",
            "pid": None,
            "log_path": str(INSTALL_LOG_PATH),
            "error": None,
        }

    error = f"llama-cpp-python install exited with code {returncode}"
    log_tail = _tail_log(INSTALL_LOG_PATH)
    if log_tail:
        error = f"{error}: {log_tail}"
    _LAST_ERROR = error
    return {
        "enabled": _install_enabled(),
        "required": True,
        "status": "failed",
        "pid": None,
        "log_path": str(INSTALL_LOG_PATH),
        "error": error,
    }


def _spawn_install_process():
    global _INSTALL_PROCESS, _INSTALL_LOG_HANDLE, _LAST_ERROR, _STARTED_AT

    INSTALL_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    _INSTALL_LOG_HANDLE = INSTALL_LOG_PATH.open("a", encoding="utf-8")
    command = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--user",
        "--no-cache-dir",
        "llama-cpp-python==0.3.16",
    ]
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("PIP_DISABLE_PIP_VERSION_CHECK", "1")
    env.setdefault("TOKENIZERS_PARALLELISM", "false")
    env["CMAKE_ARGS"] = "-DLLAMA_BLAS=ON -DLLAMA_BLAS_VENDOR=OpenBLAS"

    try:
        _INSTALL_PROCESS = subprocess.Popen(
            command,
            cwd=str(REPO_ROOT),
            env=env,
            stdout=_INSTALL_LOG_HANDLE,
            stderr=subprocess.STDOUT,
        )
        _LAST_ERROR = None
        _STARTED_AT = _STARTED_AT or time.time()
        logger.info("Started background llama-cpp-python install with pid {}", _INSTALL_PROCESS.pid)
    except Exception:
        _close_install_log()
        raise


def get_gguf_bootstrap_status() -> dict[str, Any]:
    artifact_path = _gguf_artifact_path()
    artifact_exists = artifact_path.exists()
    backend_available = _backend_available()
    download_job = _current_download_job()
    install = _install_status()
    llama_cli_path = _resolve_llama_cli_path()

    if not _bootstrap_enabled():
        status = "completed" if artifact_exists and backend_available else "disabled"
        stage = "ready" if status == "completed" else "disabled"
        message = (
            "GGUF runtime is already ready"
            if status == "completed"
            else "Background GGUF bootstrap is disabled"
        )
    elif install.get("status") == "failed":
        status = "failed"
        stage = "install_failed"
        message = install.get("error") or "Background llama-cpp-python install failed"
    elif download_job and download_job.get("status") == "failed":
        status = "failed"
        stage = "download_failed"
        message = download_job.get("error") or "Background GGUF download failed"
    elif artifact_exists and backend_available:
        status = "completed"
        stage = "ready"
        message = "GGUF runtime is ready"
    elif install.get("status") == "running":
        status = "running"
        stage = "installing_runtime"
        message = "Building llama-cpp-python in the background"
    elif download_job and download_job.get("status") in {"queued", "running"}:
        status = "running"
        stage = "downloading_model"
        message = "Downloading GGUF model in the background"
    else:
        status = "idle"
        stage = "pending"
        message = "Waiting to bootstrap the GGUF runtime"

    activation_hint = None
    if status == "completed":
        activation_hint = "Reload the runtime or wait for the next cold start if another backend is already loaded."

    return {
        "enabled": _bootstrap_enabled(),
        "status": status,
        "stage": stage,
        "message": message,
        "started_at": _STARTED_AT,
        "updated_at": time.time(),
        "ready": artifact_exists and backend_available,
        "artifact_path": str(artifact_path),
        "artifact_exists": artifact_exists,
        "backend_available": backend_available,
        "llama_cli_path": str(llama_cli_path) if llama_cli_path is not None else "",
        "install": install,
        "download_job": download_job,
        "activation_hint": activation_hint,
    }


def start_gguf_runtime_bootstrap() -> dict[str, Any]:
    global _LAST_ERROR, _STARTED_AT

    with _LOCK:
        current = get_gguf_bootstrap_status()
        if not current["enabled"]:
            return current
        if current["ready"]:
            return current

        _STARTED_AT = _STARTED_AT or time.time()

        if (
            _download_enabled()
            and not current["artifact_exists"]
            and (
                current["download_job"] is None
                or current["download_job"].get("status") == "failed"
            )
        ):
            try:
                queue_profile_download("gguf-coder")
                logger.info("Queued background GGUF model download")
            except Exception as exc:
                _LAST_ERROR = f"Failed to queue GGUF model download: {exc}"
                logger.error(_LAST_ERROR)

        if _install_enabled() and not current["backend_available"] and current["install"]["status"] != "running":
            try:
                _spawn_install_process()
            except Exception as exc:
                _LAST_ERROR = f"Failed to start background llama-cpp-python install: {exc}"
                logger.error(_LAST_ERROR)

        return get_gguf_bootstrap_status()
