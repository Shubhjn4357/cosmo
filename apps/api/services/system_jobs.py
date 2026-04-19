"""
Background process helpers for training and generator jobs.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Protocol, Optional, dict  # type: ignore

class StateProtocol(Protocol):
    training_process: Optional[subprocess.Popen]
    generator_process: Optional[subprocess.Popen]
    is_training: bool
    generator_running: bool

from utils.app_paths import DATA_ROOT, ensure_app_dirs

# ensure_app_dirs() - Moved to app.py

REPO_ROOT = Path(__file__).resolve().parents[1]
LOGS_DIR = DATA_ROOT / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)


def _is_test_mode() -> bool:
    return os.getenv("COSMO_TEST_MODE", "false").lower() == "true"


def _is_running(process: subprocess.Popen | None) -> bool:
    return process is not None and process.poll() is None


def _spawn_process(command: list[str], log_path: Path) -> subprocess.Popen:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a", encoding="utf-8") as handle:
        return subprocess.Popen(
            command,
            cwd=str(REPO_ROOT),
            stdout=handle,
            stderr=subprocess.STDOUT,
        )


def _training_command(steps: int) -> list[str]:
    if _is_test_mode():
        return [sys.executable, "-c", "import time; time.sleep(120)"]
    return [sys.executable, "train.py", "--steps", str(steps)]


def _generator_command() -> list[str]:
    if _is_test_mode():
        return [sys.executable, "-c", "import time; time.sleep(120)"]
    return [sys.executable, "cynical-generator.py", "--iterations", "10", "--interval", "300"]


def refresh_job_state(state: StateProtocol) -> dict[str, Any]:
    training_process = getattr(state, "training_process", None)
    generator_process = getattr(state, "generator_process", None)

    state.is_training = _is_running(training_process)
    state.generator_running = _is_running(generator_process)

    if not state.is_training:
        state.training_process = None
    if not state.generator_running:
        state.generator_process = None

    return {
        "training": {
            "running": state.is_training,
            "pid": state.training_process.pid if state.training_process else None,
            "log_path": str(LOGS_DIR / "training.log"),
        },
        "generator": {
            "running": state.generator_running,
            "pid": state.generator_process.pid if state.generator_process else None,
            "log_path": str(LOGS_DIR / "generator.log"),
        },
    }


def start_training_job(state: StateProtocol, steps: int) -> dict[str, Any]:
    status = refresh_job_state(state)
    if status["training"]["running"]:
        return {
            "success": False,
            "message": "Training already in progress",
            "pid": status["training"]["pid"],
            "log_path": status["training"]["log_path"],
        }

    process = _spawn_process(_training_command(steps), LOGS_DIR / "training.log")
    state.training_process = process
    state.is_training = True
    return {
        "success": True,
        "message": f"Training started with {steps} steps",
        "pid": process.pid,
        "log_path": str(LOGS_DIR / "training.log"),
    }


def stop_training_job(state: StateProtocol) -> dict[str, Any]:
    refresh_job_state(state)
    process = getattr(state, "training_process", None)
    if not _is_running(process):
        state.training_process = None
        state.is_training = False
        return {"success": True, "message": "Training is not running"}

    process.terminate()  # type: ignore
    try:
        process.wait(timeout=10)  # type: ignore
    except subprocess.TimeoutExpired:
        process.kill()  # type: ignore
        process.wait(timeout=10)  # type: ignore

    state.training_process = None
    state.is_training = False
    return {"success": True, "message": "Training stopped"}


def start_generator_job(state: StateProtocol) -> dict[str, Any]:
    status = refresh_job_state(state)
    if status["generator"]["running"]:
        return {
            "success": False,
            "message": "Generator already in progress",
            "pid": status["generator"]["pid"],
            "log_path": status["generator"]["log_path"],
        }

    process = _spawn_process(_generator_command(), LOGS_DIR / "generator.log")
    state.generator_process = process
    state.generator_running = True
    return {
        "success": True,
        "message": "Generator started",
        "pid": process.pid,
        "log_path": str(LOGS_DIR / "generator.log"),
    }


def stop_generator_job(state: StateProtocol) -> dict[str, Any]:
    refresh_job_state(state)
    process = getattr(state, "generator_process", None)
    if not _is_running(process):
        state.generator_process = None
        state.generator_running = False
        return {"success": True, "message": "Generator is not running"}

    process.terminate()  # type: ignore
    try:
        process.wait(timeout=10)  # type: ignore
    except subprocess.TimeoutExpired:
        process.kill()  # type: ignore
        process.wait(timeout=10)  # type: ignore

    state.generator_process = None
    state.generator_running = False
    return {"success": True, "message": "Generator stopped"}
