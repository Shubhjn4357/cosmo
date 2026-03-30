#!/usr/bin/env python
"""
Report the current GGUF runtime state for the local Whisper AI setup.

Usage:
    python scripts/gguf_runtime_probe.py
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.runtime_manager import (
    RuntimeConfig,
    _resolve_gguf_model_path,
    _resolve_llama_cli_path,
    get_chat_runtime_manager,
    resolve_runtime_choice,
)
from utils.app_paths import MODELS_DIR


def package_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def main() -> int:
    runtime = get_chat_runtime_manager()
    readiness = runtime.readiness()
    resolved = resolve_runtime_choice(runtime.config)
    gguf_files = sorted(str(path) for path in MODELS_DIR.rglob("*.gguf"))
    resolved_path = _resolve_gguf_model_path(runtime.config if runtime.config.backend == "llama_cpp" else RuntimeConfig(backend="llama_cpp"))

    payload = {
        "llama_cpp_installed": package_available("llama_cpp"),
        "toolchain": {
            "nmake": shutil.which("nmake"),
            "cl": shutil.which("cl"),
            "cmake": shutil.which("cmake"),
        },
        "configured_backend": runtime.config.backend,
        "resolved_backend": resolved.backend if resolved else None,
        "resolved_profile": resolved.selected_profile if resolved else None,
        "auto_selection_reason": resolved.reason if runtime.config.backend == "auto" and resolved else None,
        "configured_gguf_path": runtime.config.gguf_model_path,
        "llama_cli_path": str(_resolve_llama_cli_path()) if _resolve_llama_cli_path() else None,
        "resolved_gguf_path": str(resolved_path) if resolved_path else None,
        "gguf_files_found": gguf_files,
        "readiness": readiness,
    }

    print(json.dumps(payload, indent=2))
    if not payload["llama_cpp_installed"]:
        print(
            "\nInstall hint:\n"
            "  python -m pip install --prefer-binary "
            "--extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu "
            "llama-cpp-python==0.3.16",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
