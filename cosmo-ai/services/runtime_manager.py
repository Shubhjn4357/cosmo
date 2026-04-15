"""
Local chat runtime manager.

Supports a lightweight default transformers backend and optional llama.cpp or
AirLLM backends when those packages are installed and configured.
"""

from __future__ import annotations

import json
import importlib
import importlib.util
import os
import re
import subprocess
import sys
import threading
import time
import types
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Union
from typing_extensions import TypedDict

from loguru import logger
from utils.app_paths import DATA_ROOT, MODELS_DIR, RUNTIME_CONFIG_PATH, ensure_app_dirs
from utils.system_tuning import apply_process_tuning, configure_torch_threads, recommended_thread_count

# ensure_app_dirs() - Moving to function level
# apply_process_tuning() - Moving to function level
_AIRLLM_IMPORT_CACHE: Optional[dict[str, Any]] = None
SELF_LEARNER_DIR = Path(os.getenv("COSMO_SELF_LEARNER_DIR", str(DATA_ROOT / "checkpoints")))
SELF_LEARNER_CHECKPOINT = SELF_LEARNER_DIR / "latest.pt"
SELF_LEARNER_INT8_CHECKPOINT = SELF_LEARNER_DIR / "latest-int8.pt"
SELF_LEARNER_TOKENIZER = SELF_LEARNER_DIR / "tokenizer.json"
SELF_LEARNER_STATE = SELF_LEARNER_DIR / "state.json"
DEFAULT_FAST_MODEL_ID = "Qwen/Qwen3-1.7B"
DEFAULT_BALANCED_MODEL_ID = "Qwen/Qwen3-4B"
DEFAULT_GGUF_MODEL_ID = "unsloth/Qwen3-1.7B-GGUF"
DEFAULT_GGUF_FILENAME = "Qwen3-1.7B-Q4_K_M.gguf"
DEFAULT_GGUF_MODEL_PATH = MODELS_DIR / "llm" / "gguf-coder" / DEFAULT_GGUF_FILENAME
DEFAULT_AIRLLM_MODEL_ID = "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"
DEFAULT_AIRLLM_MODEL_PATH = MODELS_DIR / "llm" / "heavy-airllm"
DEFAULT_BITNET_MODEL_ID = "microsoft/BitNet-b1.58-2B-4T-gguf"
DEFAULT_BITNET_FILENAME = "ggml-model-i2_s.gguf"
DEFAULT_BITNET_MODEL_PATH = MODELS_DIR / "llm" / "bitnet-cpu" / DEFAULT_BITNET_FILENAME
DEFAULT_BITNET_REPO_PATH = Path(__file__).parent.parent / "native"
LEGACY_MODEL_ID_MAP = {
    "Qwen/Qwen2.5-Coder-0.5B-Instruct": DEFAULT_FAST_MODEL_ID,
    "Qwen/Qwen2.5-1.5B-Instruct-GGUF": DEFAULT_GGUF_MODEL_ID,
    "cosmo-micro-transformer": DEFAULT_FAST_MODEL_ID,
}
LEGACY_GGUF_FILENAMES = {
    "qwen2.5-1.5b-instruct-q4_k_m.gguf",
}


def get_self_learner_chat_thresholds() -> dict[str, int]:
    return {
        "min_steps": max(1, int(os.getenv("COSMO_SELF_LEARNER_MIN_STEPS", "8"))),
        "min_sequences": max(1, int(os.getenv("COSMO_SELF_LEARNER_MIN_SEQUENCES", "4"))),
    }


def _package_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def _repair_collapsed_spacing(text: str) -> str:
    cleaned = str(text or "").strip()
    if not cleaned:
        return cleaned

    # Leave already well-spaced output alone.
    if cleaned.count(" ") >= max(2, len(cleaned) // 24):
        return cleaned

    repaired = re.sub(r"([.!?,:;])([A-Za-z0-9`])", r"\1 \2", cleaned)
    repaired = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", repaired)
    repaired = re.sub(r"([A-Za-z])(`)", r"\1 \2", repaired)
    repaired = re.sub(r"(`)([A-Za-z])", r"\1 \2", repaired)
    repaired = re.sub(r"(\d)([A-Za-z])", r"\1 \2", repaired)
    repaired = re.sub(r"([A-Za-z])(\d)", r"\1 \2", repaired)
    repaired = re.sub(r"\s{2,}", " ", repaired).strip()
    return repaired if repaired.count(" ") > cleaned.count(" ") else cleaned


class AirLLMDiagnostics(TypedDict):
    available: bool
    shimmed: bool
    error: Optional[str]
    module: Optional[types.ModuleType]


def airllm_import_diagnostics(reset_cache: bool = False) -> AirLLMDiagnostics:
    global _AIRLLM_IMPORT_CACHE
    if _AIRLLM_IMPORT_CACHE is not None and not reset_cache:
        return _AIRLLM_IMPORT_CACHE

    diagnostics: AirLLMDiagnostics = {
        "available": False,
        "shimmed": False,
        "error": None,
        "module": None,
    }

    if not _package_available("airllm"):
        diagnostics["error"] = "airllm is not installed"
        _AIRLLM_IMPORT_CACHE = diagnostics
        return dict(diagnostics)

    try:
        diagnostics["module"] = importlib.import_module("airllm")
        diagnostics["available"] = True
        _AIRLLM_IMPORT_CACHE = diagnostics
        return dict(diagnostics)
    except Exception as exc:
        diagnostics["error"] = str(exc)
        message = diagnostics["error"]
        if "BetterTransformer requires transformers<4.49" not in message and "optimum.bettertransformer" not in message:
            _AIRLLM_IMPORT_CACHE = diagnostics
            return dict(diagnostics)

    try:
        _purge_airllm_modules()
        _install_bettertransformer_shim()
        diagnostics["module"] = importlib.import_module("airllm")
        diagnostics["available"] = True
        diagnostics["shimmed"] = True
        diagnostics["error"] = None
    except Exception as retry_exc:
        diagnostics["error"] = str(retry_exc)

    _AIRLLM_IMPORT_CACHE = diagnostics
    return diagnostics


def _normalize_model_id(model_id: str | None, *, fallback: str) -> str:
    candidate = (model_id or "").strip()
    if not candidate:
        return fallback
    return LEGACY_MODEL_ID_MAP.get(candidate, candidate)


def _default_model_id_from_env() -> str:
    configured = os.getenv("LOCAL_MODEL_ID", DEFAULT_FAST_MODEL_ID)
    return _normalize_model_id(configured, fallback=DEFAULT_FAST_MODEL_ID)


@dataclass
class RuntimeConfig:
    backend: str = field(default_factory=lambda: os.getenv("LOCAL_CHAT_BACKEND", "auto").lower())
    model_id: str = field(default_factory=_default_model_id_from_env)
    gguf_model_path: str = field(default_factory=lambda: os.getenv("LOCAL_GGUF_MODEL_PATH", ""))
    airllm_model_id: str = field(default_factory=lambda: os.getenv("AIRLLM_MODEL_ID", ""))
    airllm_model_path: str = field(default_factory=lambda: os.getenv("LOCAL_AIRLLM_MODEL_PATH", ""))
    bitnet_model_path: str = field(default_factory=lambda: os.getenv("LOCAL_BITNET_MODEL_PATH", ""))
    bitnet_repo_path: str = field(default_factory=lambda: os.getenv("LOCAL_BITNET_REPO_PATH", ""))
    bitnet_command_template: str = field(default_factory=lambda: os.getenv("LOCAL_BITNET_COMMAND_TEMPLATE", ""))
    max_context_tokens: int = field(default_factory=lambda: int(os.getenv("LOCAL_MAX_CONTEXT_TOKENS", "4096")))
    max_new_tokens: int = field(default_factory=lambda: int(os.getenv("LOCAL_MAX_NEW_TOKENS", "512")))
    device: str = field(default_factory=lambda: os.getenv("LOCAL_MODEL_DEVICE", "cpu"))
    allow_remote_code: bool = field(
        default_factory=lambda: os.getenv("LOCAL_MODEL_TRUST_REMOTE_CODE", "false").lower() == "true"
    )
    n_threads: int = field(
        default_factory=lambda: int(os.getenv("LOCAL_MODEL_THREADS", str(recommended_thread_count())))
    )
    micro_checkpoint_path: str = field(
        default_factory=lambda: os.getenv("COSMO_MICRO_CHECKPOINT_PATH", str(SELF_LEARNER_CHECKPOINT))
    )
    micro_quantized_checkpoint_path: str = field(
        default_factory=lambda: os.getenv("COSMO_MICRO_INT8_CHECKPOINT_PATH", str(SELF_LEARNER_INT8_CHECKPOINT))
    )
    micro_tokenizer_path: str = field(
        default_factory=lambda: os.getenv("COSMO_MICRO_TOKENIZER_PATH", str(SELF_LEARNER_TOKENIZER))
    )
    micro_use_dynamic_quantization: bool = field(
        default_factory=lambda: os.getenv("COSMO_MICRO_USE_DYNAMIC_QUANTIZATION", "true").lower() == "true"
    )


@dataclass
class ResolvedRuntimeChoice:
    config: RuntimeConfig
    backend: str
    model_id: str
    selected_profile: str
    reason: str


def _test_mode_enabled() -> bool:
    return os.getenv("COSMO_TEST_MODE", "false").lower() == "true"


def _clone_runtime_config(config: RuntimeConfig) -> RuntimeConfig:
    return RuntimeConfig(**asdict(config))


def _default_self_learner_config() -> RuntimeConfig:
    return RuntimeConfig(
        backend="micro_transformer",
        model_id="cosmo-micro-transformer",
        device="cpu",
        max_context_tokens=int(os.getenv("COSMO_MICRO_MAX_CONTEXT_TOKENS", "1024")),
        max_new_tokens=int(os.getenv("COSMO_MICRO_MAX_NEW_TOKENS", "384")),
        micro_checkpoint_path=str(SELF_LEARNER_CHECKPOINT),
        micro_quantized_checkpoint_path=str(SELF_LEARNER_INT8_CHECKPOINT),
        micro_tokenizer_path=str(SELF_LEARNER_TOKENIZER),
        micro_use_dynamic_quantization=os.getenv("COSMO_MICRO_USE_DYNAMIC_QUANTIZATION", "true").lower() == "true",
    )


def _default_profile_config(profile_id: str) -> RuntimeConfig | None:
    if profile_id == "fast-coder":
        return RuntimeConfig(
            backend="transformers",
            model_id=DEFAULT_FAST_MODEL_ID,
            max_context_tokens=4096,
            max_new_tokens=384,
        )
    if profile_id == "balanced-coder":
        return RuntimeConfig(
            backend="transformers",
            model_id=DEFAULT_BALANCED_MODEL_ID,
            max_context_tokens=4096,
            max_new_tokens=512,
        )
    if profile_id == "gguf-coder":
        return RuntimeConfig(
            backend="llama_cpp",
            model_id=DEFAULT_GGUF_MODEL_ID,
            gguf_model_path=str(DEFAULT_GGUF_MODEL_PATH),
            max_context_tokens=8192,
            max_new_tokens=512,
        )
    if profile_id == "heavy-airllm":
        return RuntimeConfig(
            backend="airllm",
            model_id=DEFAULT_AIRLLM_MODEL_ID,
            airllm_model_id=DEFAULT_AIRLLM_MODEL_ID,
            airllm_model_path=str(DEFAULT_AIRLLM_MODEL_PATH),
            max_context_tokens=8192,
            max_new_tokens=768,
        )
    if profile_id == "bitnet-cpu":
        return RuntimeConfig(
            backend="bitnet_cpp",
            model_id=DEFAULT_BITNET_MODEL_ID,
            bitnet_model_path=str(DEFAULT_BITNET_MODEL_PATH),
            bitnet_repo_path=str(DEFAULT_BITNET_REPO_PATH),
            max_context_tokens=4096,
            max_new_tokens=384,
            device="cpu",
        )
    if profile_id == "self-learner-turbo":
        return _default_self_learner_config()
    return None


def _looks_legacy_gguf_path(path_value: str | None) -> bool:
    if not path_value:
        return False
    return Path(path_value).name.lower() in LEGACY_GGUF_FILENAMES


def _migrate_runtime_state(config: RuntimeConfig, selected_profile: Optional[str]) -> tuple[RuntimeConfig, Optional[str], bool]:
    original = asdict(config)
    migrated = _clone_runtime_config(config)

    profile_config = _default_profile_config(selected_profile or "")
    if profile_config is not None:
        profile_config.n_threads = migrated.n_threads
        if selected_profile in {"fast-coder", "balanced-coder"}:
            profile_config.device = migrated.device or profile_config.device
            profile_config.allow_remote_code = migrated.allow_remote_code
        migrated = profile_config
    else:
        migrated.model_id = _normalize_model_id(migrated.model_id, fallback=DEFAULT_FAST_MODEL_ID)
        if _looks_legacy_gguf_path(migrated.gguf_model_path):
            migrated.gguf_model_path = str(DEFAULT_GGUF_MODEL_PATH)
            if migrated.backend == "llama_cpp":
                migrated.model_id = DEFAULT_GGUF_MODEL_ID
        if migrated.backend == "airllm":
            migrated.model_id = _normalize_model_id(migrated.model_id, fallback=DEFAULT_AIRLLM_MODEL_ID)
            migrated.airllm_model_id = _normalize_model_id(
                migrated.airllm_model_id or migrated.model_id,
                fallback=DEFAULT_AIRLLM_MODEL_ID,
            )
            if not (migrated.airllm_model_path or "").strip():
                migrated.airllm_model_path = str(DEFAULT_AIRLLM_MODEL_PATH)
        elif migrated.backend == "bitnet_cpp":
            migrated.model_id = migrated.model_id or DEFAULT_BITNET_MODEL_ID
            if not (migrated.bitnet_model_path or "").strip():
                migrated.bitnet_model_path = str(DEFAULT_BITNET_MODEL_PATH)
            if not (migrated.bitnet_repo_path or "").strip():
                migrated.bitnet_repo_path = str(DEFAULT_BITNET_REPO_PATH)
        elif migrated.backend in {"auto", "transformers"}:
            migrated.model_id = _normalize_model_id(migrated.model_id, fallback=DEFAULT_FAST_MODEL_ID)

    changed = asdict(migrated) != original
    return migrated, selected_profile, changed


def _resolve_gguf_model_path(config: RuntimeConfig) -> Optional[Path]:
    configured = (config.gguf_model_path or "").strip()
    if configured:
        candidate = Path(configured)
        if candidate.exists():
            return candidate.resolve()

    if DEFAULT_GGUF_MODEL_PATH.exists():
        return DEFAULT_GGUF_MODEL_PATH.resolve()

    search_roots = []
    llm_root = MODELS_DIR / "llm"
    if llm_root.exists():
        search_roots.append(llm_root)
    search_roots.append(MODELS_DIR)

    for root in search_roots:
        gguf_files = sorted(
            (path.resolve() for path in root.rglob("*.gguf")),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        if gguf_files:
            return gguf_files[0]

    return Path(configured) if configured else None


def _resolve_llama_cli_path() -> Optional[Path]:
    candidates = []
    configured = os.getenv("LOCAL_LLAMA_CLI_PATH", "").strip()
    if configured:
        candidates.append(Path(configured))

    candidates.extend(
        [
            Path(".tools/llama-bin/llama-completion"),
            Path(".tools/llama-bin/llama-cli"),
            Path(".tools/llama-bin/llama-completion.exe"),
            Path(".tools/llama-bin/llama-cli.exe"),
            Path(".tools/llama-completion"),
            Path(".tools/llama-cli"),
            Path(".tools/llama-completion.exe"),
            Path(".tools/llama-cli.exe"),
            MODELS_DIR / "llama-bin" / "llama-completion",
            MODELS_DIR / "llama-bin" / "llama-cli",
            MODELS_DIR / "llama-bin" / "llama-completion.exe",
            MODELS_DIR / "llama-bin" / "llama-cli.exe",
        ]
    )

    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()

    return None


def _resolve_airllm_model_path(config: RuntimeConfig) -> Optional[Path]:
    configured = (config.airllm_model_path or "").strip()
    if configured:
        candidate = Path(configured)
        if candidate.exists():
            return candidate.resolve()
        return candidate

    candidates = []
    if config.airllm_model_id:
        slug = config.airllm_model_id.replace("/", "--")
        candidates.append(MODELS_DIR / "llm" / slug)
    candidates.append(MODELS_DIR / "llm" / "heavy-airllm")

    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()

    return None


def _resolve_bitnet_model_path(config: RuntimeConfig) -> Optional[Path]:
    configured = (config.bitnet_model_path or "").strip()
    if configured:
        candidate = Path(configured)
        if candidate.exists():
            return candidate.resolve()
        return candidate

    if DEFAULT_BITNET_MODEL_PATH.exists():
        return DEFAULT_BITNET_MODEL_PATH.resolve()

    search_roots = []
    llm_root = MODELS_DIR / "llm"
    if llm_root.exists():
        search_roots.append(llm_root)
    search_roots.append(MODELS_DIR)

    for root in search_roots:
        bitnet_files = sorted(
            (
                path.resolve()
                for path in root.rglob("*.gguf")
                if "bitnet" in path.as_posix().lower() or path.name.lower().startswith("ggml-model")
            ),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        if bitnet_files:
            return bitnet_files[0]

    return Path(configured) if configured else None


def _resolve_bitnet_repo_path(config: RuntimeConfig) -> Optional[Path]:
    configured = (config.bitnet_repo_path or "").strip()
    if configured:
        candidate = Path(configured)
        if candidate.exists():
            return candidate.resolve()
        return candidate

    if DEFAULT_BITNET_REPO_PATH.exists():
        return DEFAULT_BITNET_REPO_PATH.resolve()

    candidates = [
        Path(__file__).parent.parent / "native",
        MODELS_DIR / "llm" / "bitnet.cpp",
        Path(".tools/bitnet.cpp"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()

    return None


def _resolve_bitnet_runner(config: RuntimeConfig) -> Optional[dict[str, str]]:
    template = (config.bitnet_command_template or "").strip()
    if template:
        return {
            "kind": "template",
            "command_template": template,
            "cwd": os.getenv("LOCAL_BITNET_COMMAND_CWD", "").strip(),
        }

    configured_entrypoint = os.getenv("LOCAL_BITNET_ENTRYPOINT", "").strip()
    if configured_entrypoint:
        candidate = Path(configured_entrypoint)
        if candidate.exists() and candidate.suffix.lower() == ".py":
            return {
                "kind": "python_script",
                "path": str(candidate.resolve()),
                "cwd": str(candidate.resolve().parent),
            }

    repo_path = _resolve_bitnet_repo_path(config)
    if repo_path is None:
        return None

    for candidate in (repo_path / "run_inference.py", repo_path / "utils" / "run_inference.py"):
        if candidate.exists():
            return {
                "kind": "python_script",
                "path": str(candidate.resolve()),
                "cwd": str(repo_path),
            }

    return None


def _resolve_micro_checkpoint_path(config: RuntimeConfig) -> Optional[Path]:
    quantized = (config.micro_quantized_checkpoint_path or "").strip()
    standard = (config.micro_checkpoint_path or "").strip()

    for candidate in (quantized, standard):
        if not candidate:
            continue
        path = Path(candidate)
        if path.exists():
            return path.resolve()

    fallback_candidates = [SELF_LEARNER_INT8_CHECKPOINT, SELF_LEARNER_CHECKPOINT]
    for candidate in fallback_candidates:
        if candidate.exists():
            return candidate.resolve()

    return Path(quantized or standard) if (quantized or standard) else None


def _resolve_micro_tokenizer_path(config: RuntimeConfig) -> Optional[Path]:
    configured = (config.micro_tokenizer_path or "").strip()
    if configured:
        candidate = Path(configured)
        if candidate.exists():
            return candidate.resolve()
        return candidate

    if SELF_LEARNER_TOKENIZER.exists():
        return SELF_LEARNER_TOKENIZER.resolve()

    return None


def load_runtime_state() -> tuple[Optional[RuntimeConfig], Optional[str]]:
    if not RUNTIME_CONFIG_PATH.exists():
        return None, None

    try:
        raw = json.loads(RUNTIME_CONFIG_PATH.read_text(encoding="utf-8"))
        config_data = raw.get("config") or {}
        selected_profile = raw.get("selected_profile")
        config = RuntimeConfig(**config_data)
        migrated_config, migrated_profile, changed = _migrate_runtime_state(config, selected_profile)
        if changed:
            save_runtime_state(migrated_config, migrated_profile)
        return migrated_config, migrated_profile
    except Exception as exc:
        logger.warning(f"Failed to load runtime config: {exc}")
        return None, None


def save_runtime_state(config: RuntimeConfig, selected_profile: Optional[str] = None):
    payload = {
        "selected_profile": selected_profile,
        "config": asdict(config),
        "updated_at": time.time(),
    }
    RUNTIME_CONFIG_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    try:
        from utils.persistence import backup_file

        backup_file(str(RUNTIME_CONFIG_PATH))
    except Exception as exc:
        logger.debug(f"Runtime config backup skipped: {exc}")


def resolve_runtime_choice(config: RuntimeConfig) -> Optional[ResolvedRuntimeChoice]:
    configured_backend = (config.backend or "").lower()
    if configured_backend != "auto":
        resolved = _clone_runtime_config(config)
        if configured_backend == "transformers":
            resolved.model_id = _normalize_model_id(resolved.model_id, fallback=DEFAULT_FAST_MODEL_ID)
        elif configured_backend == "airllm":
            resolved.model_id = _normalize_model_id(resolved.model_id, fallback=DEFAULT_AIRLLM_MODEL_ID)
            resolved.airllm_model_id = _normalize_model_id(
                resolved.airllm_model_id or resolved.model_id,
                fallback=DEFAULT_AIRLLM_MODEL_ID,
            )
            resolved.airllm_model_path = resolved.airllm_model_path or str(DEFAULT_AIRLLM_MODEL_PATH)
        elif configured_backend == "bitnet_cpp":
            resolved.model_id = resolved.model_id or DEFAULT_BITNET_MODEL_ID
            resolved.bitnet_model_path = resolved.bitnet_model_path or str(DEFAULT_BITNET_MODEL_PATH)
            resolved.bitnet_repo_path = resolved.bitnet_repo_path or str(DEFAULT_BITNET_REPO_PATH)
        elif configured_backend == "llama_cpp" and not (resolved.gguf_model_path or "").strip():
            resolved.gguf_model_path = str(DEFAULT_GGUF_MODEL_PATH)
        return ResolvedRuntimeChoice(
            config=resolved,
            backend=configured_backend,
            model_id=resolved.bitnet_model_path or resolved.airllm_model_path or resolved.airllm_model_id or resolved.model_id,
            selected_profile="custom",
            reason=f"Configured backend: {configured_backend}",
        )

    gguf_path = _resolve_gguf_model_path(config)
    llama_available = _package_available("llama_cpp") or _resolve_llama_cli_path() is not None
    if gguf_path is not None and gguf_path.exists() and llama_available:
        resolved = _clone_runtime_config(config)
        resolved.backend = "llama_cpp"
        resolved.gguf_model_path = str(gguf_path)
        return ResolvedRuntimeChoice(
            config=resolved,
            backend="llama_cpp",
            model_id=gguf_path.name,
            selected_profile="gguf-coder",
            reason="Auto selected GGUF runtime because a local GGUF artifact and llama backend are available",
        )

    bitnet_path = _resolve_bitnet_model_path(config)
    bitnet_runner = _resolve_bitnet_runner(config)
    if bitnet_path is not None and bitnet_path.exists() and bitnet_runner is not None:
        resolved = _clone_runtime_config(config)
        resolved.backend = "bitnet_cpp"
        resolved.bitnet_model_path = str(bitnet_path)
        if not resolved.bitnet_repo_path:
            resolved.bitnet_repo_path = str(_resolve_bitnet_repo_path(config) or DEFAULT_BITNET_REPO_PATH)
        return ResolvedRuntimeChoice(
            config=resolved,
            backend="bitnet_cpp",
            model_id=bitnet_path.name,
            selected_profile="bitnet-cpu",
            reason="Auto selected BitNet because a local BitNet artifact and bitnet.cpp runner are available",
        )

    if _package_available("transformers"):
        resolved = _clone_runtime_config(config)
        resolved.backend = "transformers"
        if not resolved.model_id:
            resolved.model_id = DEFAULT_FAST_MODEL_ID
        resolved.model_id = _normalize_model_id(resolved.model_id, fallback=DEFAULT_FAST_MODEL_ID)
        selected_profile = "fast-coder" if resolved.model_id == DEFAULT_FAST_MODEL_ID else "custom"
        return ResolvedRuntimeChoice(
            config=resolved,
            backend="transformers",
            model_id=resolved.model_id,
            selected_profile=selected_profile,
            reason="Auto selected transformers backend because no ready GGUF runtime was found",
        )

    if _package_available("airllm") and (config.airllm_model_id or config.model_id):
        resolved = _clone_runtime_config(config)
        resolved.backend = "airllm"
        resolved.airllm_model_id = _normalize_model_id(
            resolved.airllm_model_id or DEFAULT_AIRLLM_MODEL_ID,
            fallback=DEFAULT_AIRLLM_MODEL_ID,
        )
        resolved.model_id = _normalize_model_id(resolved.model_id, fallback=DEFAULT_AIRLLM_MODEL_ID)
        resolved.airllm_model_path = resolved.airllm_model_path or str(_resolve_airllm_model_path(resolved) or "")
        return ResolvedRuntimeChoice(
            config=resolved,
            backend="airllm",
            model_id=resolved.airllm_model_path or resolved.airllm_model_id,
            selected_profile="heavy-airllm",
            reason="Auto selected AirLLM backend because transformers and GGUF backends are unavailable",
        )

    return None

    return None


def validate_runtime_config(
    config: RuntimeConfig,
    *,
    selected_profile: Optional[str] = None,
    test_load: bool = False,
    refresh_imports: bool = True,
) -> Dict[str, Any]:
    """Run a fresh runtime preflight probe without mutating the active app runtime."""

    if refresh_imports:
        airllm_import_diagnostics(reset_cache=True)

    validated_at = time.time()
    probe = ChatRuntimeManager(config=_clone_runtime_config(config))
    if selected_profile:
        probe._selected_profile = selected_profile

    preflight = probe.readiness()
    validation: Dict[str, Any] = {
        "validated_at": validated_at,
        "configured_backend": config.backend,
        "resolved_backend": preflight.get("resolved_backend"),
        "resolved_profile": preflight.get("resolved_profile"),
        "preflight": preflight,
        "test_load": {
            "attempted": False,
            "loaded": False,
            "active_backend": None,
            "last_error": None,
            "duration_seconds": 0.0,
        },
        "ok": bool(preflight.get("can_load")),
        "summary": preflight.get("summary") or "Validation completed",
    }

    if not test_load:
        return validation

    started_at = time.time()
    loaded = probe.ensure_loaded()
    status = probe.status()
    duration_seconds = round(time.time() - started_at, 3)
    validation["test_load"] = {
        "attempted": True,
        "loaded": loaded,
        "active_backend": status.get("active_backend"),
        "last_error": status.get("last_error"),
        "duration_seconds": duration_seconds,
    }
    validation["ok"] = loaded
    validation["summary"] = "Load test passed" if loaded else (status.get("last_error") or validation["summary"])
    probe.unload()
    return validation


class ChatRuntimeManager:
    """Lazy-loading wrapper around the configured local text backend."""

    def __init__(self, config: Optional[RuntimeConfig] = None):
        stored_config, stored_profile = load_runtime_state()
        self.config = config or stored_config or RuntimeConfig()
        self._lock = threading.Lock()
        self._loaded = False
        self._backend_name = "uninitialized"
        
        # Audit: Strict Union for model instances
        self._model: Optional[Union[dict, types.ModuleType, object]] = None
        self._tokenizer: Optional[object] = None
        
        self._last_error: Optional[str] = None
        self._loaded_at: Optional[float] = None
        self._selected_profile = stored_profile or "custom"
        self._resolved_config: Optional[RuntimeConfig] = None
        self._resolved_profile: Optional[str] = None

    def _load_transformers(self):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        configure_torch_threads(force=True)
        model_id = self.config.model_id
        logger.info(f"Loading transformers backend: {model_id}")

        tokenizer = AutoTokenizer.from_pretrained(
            model_id,
            trust_remote_code=self.config.allow_remote_code,
        )
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model = AutoModelForCausalLM.from_pretrained(
            model_id,
            trust_remote_code=self.config.allow_remote_code,
            torch_dtype=torch.float32,
            low_cpu_mem_usage=True,
        )
        model.to(self.config.device)
        
        # Apply dynamic quantization on CPU to reduce memory footprint
        if self.config.device == "cpu":
            try:
                logger.info("Applying dynamic quantization to transformers model (CPU)")
                model = torch.quantization.quantize_dynamic(
                    model, {torch.nn.Linear}, dtype=torch.qint8
                )
            except Exception as e:
                logger.warning(f"Dynamic quantization failed: {e}")
                
        model.eval()

        self._backend_name = "transformers"
        self._model = model
        self._tokenizer = tokenizer


    def _load_llama_cpp(self):
        gguf_path = _resolve_gguf_model_path(self.config)
        if gguf_path is None:
            raise RuntimeError("LOCAL_GGUF_MODEL_PATH is required for llama_cpp backend")
        self.config.gguf_model_path = str(gguf_path)
        llama_cli_path = _resolve_llama_cli_path()

        if _package_available("llama_cpp"):
            from llama_cpp import Llama

            logger.info(f"Loading llama.cpp backend: {gguf_path}")
            self._model = Llama(
                model_path=str(gguf_path),
                n_ctx=self.config.max_context_tokens,
                n_threads=self.config.n_threads,
                n_batch=min(512, self.config.max_context_tokens),
                verbose=False,
            )
            self._backend_name = "llama_cpp"
            return

        if llama_cli_path is None:
            raise RuntimeError("Neither llama-cpp-python nor a llama.cpp completion binary is available")

        logger.info(f"Loading llama.cpp CLI backend: {llama_cli_path}")
        self._model = {"cli_path": str(llama_cli_path), "model_path": str(gguf_path)}
        self._backend_name = "llama_cpp_cli"

    def _load_airllm(self):
        apply_process_tuning()
        diagnostics = airllm_import_diagnostics()
        if not diagnostics["available"]:
            raise RuntimeError(diagnostics["error"] or "airllm import failed")
        AutoModel = diagnostics["module"].AutoModel

        local_path = _resolve_airllm_model_path(self.config)
        model_source = str(local_path) if local_path and local_path.exists() else (self.config.airllm_model_id or self.config.model_id)
        logger.info(f"Loading AirLLM backend: {model_source}")

        model = AutoModel.from_pretrained(model_source)
        tokenizer = model.tokenizer

        self._backend_name = "airllm"
        self._model = model
        self._tokenizer = tokenizer

    def _load_bitnet_cpp(self):
        model_path = _resolve_bitnet_model_path(self.config)
        if model_path is None:
            raise RuntimeError("BitNet model artifact was not found in the configured or default local search paths")
        runner = _resolve_bitnet_runner(self.config)
        if runner is None:
            raise RuntimeError(
                "BitNet runner was not found in the configured or default local search paths"
            )

        self.config.bitnet_model_path = str(model_path)
        if not self.config.bitnet_repo_path:
            self.config.bitnet_repo_path = str(_resolve_bitnet_repo_path(self.config) or "")

        logger.info(f"Loading BitNet runtime: {model_path}")
        self._model = {
            "runner": runner,
            "model_path": str(model_path),
        }
        self._backend_name = "bitnet_cpp"

    def _load_micro_transformer(self):
        import torch

        from model.quantization import load_quantized_checkpoint, quantize_micro_transformer
        from model.tokenizer import CosmoTokenizer
        from model.transformer import MicroTransformer

        configure_torch_threads(force=True)

        try:
            from services.hf_model_sync import is_configured as is_hf_configured, pull_latest_checkpoint
            if is_hf_configured():
                checkpoint_dir = Path(os.getenv("COSMO_SELF_LEARNER_DIR", str(DATA_ROOT / "checkpoints")))
                logger.info("Checking Hugging Face Model Hub for latest checkpoints...")
                pull_latest_checkpoint(checkpoint_dir)
        except Exception as exc:
            logger.warning(f"HF Model Hub pull skipped/failed during boot: {exc}")

        checkpoint_path = _resolve_micro_checkpoint_path(self.config)
        tokenizer_path = _resolve_micro_tokenizer_path(self.config)

        if checkpoint_path is None:
            raise RuntimeError("Self-learner checkpoint path is not configured")
        if tokenizer_path is None:
            raise RuntimeError("Self-learner tokenizer path is not configured")
        if not checkpoint_path.exists():
            raise RuntimeError(f"Self-learner checkpoint not found: {checkpoint_path}")
        if not tokenizer_path.exists():
            raise RuntimeError(f"Self-learner tokenizer not found: {tokenizer_path}")

        logger.info(f"Loading self-learner runtime from {checkpoint_path}")
        if str(checkpoint_path).endswith("int8.pt"):
            model = load_quantized_checkpoint(checkpoint_path, device="cpu")
        else:
            model = MicroTransformer.load(str(checkpoint_path), device="cpu")
            if self.config.micro_use_dynamic_quantization:
                model = quantize_micro_transformer(model)
            model.eval()

        tokenizer = CosmoTokenizer.load(str(tokenizer_path))

        self._backend_name = "micro_transformer"
        self._model = model
        self._tokenizer = tokenizer

    def readiness(self) -> Dict[str, Any]:
        configured_backend = self.config.backend
        resolved = resolve_runtime_choice(self.config)
        effective_config = resolved.config if resolved is not None else self.config
        backend = effective_config.backend
        messages = []
        backend_available = False
        artifact_required = backend == "llama_cpp"
        artifact_path = effective_config.gguf_model_path if artifact_required else ""
        artifact_exists = None
        source_target = effective_config.bitnet_model_path or effective_config.airllm_model_id or effective_config.model_id

        if configured_backend == "auto":
            if resolved is None:
                messages.append("Auto backend could not find a usable local runtime")
            else:
                messages.append(resolved.reason)

        if backend == "stub":
            backend_available = True
        elif backend == "micro_transformer":
            checkpoint_path = _resolve_micro_checkpoint_path(effective_config)
            tokenizer_path = _resolve_micro_tokenizer_path(effective_config)
            backend_available = _package_available("torch")
            artifact_required = True
            artifact_path = str(checkpoint_path or "")
            artifact_exists = bool(
                checkpoint_path
                and checkpoint_path.exists()
                and tokenizer_path
                and tokenizer_path.exists()
            )
            if not backend_available:
                messages.append("torch is not installed")
            if checkpoint_path is None:
                messages.append("Self-learner checkpoint path is not configured")
            elif not checkpoint_path.exists():
                messages.append(f"Self-learner checkpoint not found: {checkpoint_path}")
            if tokenizer_path is None:
                messages.append("Self-learner tokenizer path is not configured")
            elif not tokenizer_path.exists():
                messages.append(f"Self-learner tokenizer not found: {tokenizer_path}")
            source_target = str(checkpoint_path) if checkpoint_path else "cosmo-micro-transformer"
        elif backend == "llama_cpp":
            has_python_backend = _package_available("llama_cpp")
            llama_cli_path = _resolve_llama_cli_path()
            backend_available = has_python_backend or llama_cli_path is not None
            if not backend_available:
                messages.append("llama-cpp-python is not installed and no llama.cpp completion binary was found")
            resolved_gguf = _resolve_gguf_model_path(effective_config)
            if resolved_gguf is not None:
                artifact_path = str(resolved_gguf)
                artifact_exists = resolved_gguf.exists()
            if not effective_config.gguf_model_path and resolved_gguf is None:
                messages.append("LOCAL_GGUF_MODEL_PATH is not configured")
            elif not artifact_exists:
                messages.append(f"GGUF file not found: {artifact_path}")
            if llama_cli_path is not None:
                messages.append(f"llama.cpp binary available at {llama_cli_path}")
        elif backend == "bitnet_cpp":
            runner = _resolve_bitnet_runner(effective_config)
            resolved_bitnet = _resolve_bitnet_model_path(effective_config)
            backend_available = runner is not None
            artifact_required = True
            artifact_path = str(resolved_bitnet or "")
            artifact_exists = bool(resolved_bitnet and resolved_bitnet.exists())
            source_target = str(resolved_bitnet or effective_config.model_id or DEFAULT_BITNET_MODEL_ID)
            if not backend_available:
                messages.append(
                    "bitnet.cpp runner was not found in the configured or default local search paths"
                )
            else:
                runner_label = runner.get("path") or runner.get("command_template") or "configured runner"
                messages.append(f"BitNet runner available at {runner_label}")
            if resolved_bitnet is None:
                messages.append("BitNet model artifact was not found in the configured or default local search paths")
            elif not artifact_exists:
                messages.append(f"BitNet model file not found: {artifact_path}")
        elif backend == "airllm":
            diagnostics = airllm_import_diagnostics()
            backend_available = diagnostics["available"]
            resolved_airllm = _resolve_airllm_model_path(effective_config)
            if resolved_airllm is not None:
                artifact_path = str(resolved_airllm)
                artifact_exists = resolved_airllm.exists()
                if artifact_exists:
                    source_target = str(resolved_airllm)
                    messages.append(f"Local AirLLM snapshot available at {resolved_airllm}")
            elif effective_config.airllm_model_path:
                artifact_path = effective_config.airllm_model_path
                artifact_exists = False
                messages.append(f"AirLLM snapshot path not found: {effective_config.airllm_model_path}")
            if not backend_available:
                messages.append(diagnostics.get("error") or "airllm is not installed")
            elif diagnostics.get("shimmed"):
                messages.append("AirLLM BetterTransformer compatibility shim is active")
            elif not artifact_exists:
                messages.append("AirLLM will load from the Hugging Face Hub at runtime")
        else:
            backend_available = _package_available("transformers")
            if not backend_available:
                messages.append("transformers is not installed")

        blocking_messages = []
        for message in messages:
            if (
                message.startswith("llama.cpp binary available at")
                or message.startswith("Auto selected")
                or message.startswith("Configured backend:")
                or message.startswith("BitNet runner available at")
                or message.startswith("Local AirLLM snapshot available at")
                or message.startswith("AirLLM will load from the Hugging Face Hub at runtime")
                or message.startswith("AirLLM snapshot path not found:")
                or message.startswith("AirLLM BetterTransformer compatibility shim is active")
            ):
                continue
            blocking_messages.append(message)

        can_load = backend_available and not blocking_messages
        return {
            "backend": backend,
            "configured_backend": configured_backend,
            "resolved_backend": resolved.backend if resolved is not None else None,
            "resolved_model_id": resolved.model_id if resolved is not None else None,
            "resolved_profile": resolved.selected_profile if resolved is not None else None,
            "backend_available": backend_available,
            "artifact_required": artifact_required,
            "artifact_path": artifact_path,
            "artifact_exists": artifact_exists,
            "source_target": source_target,
            "llama_cli_path": str(_resolve_llama_cli_path()) if backend == "llama_cpp" and _resolve_llama_cli_path() else "",
            "bitnet_runner": (_resolve_bitnet_runner(effective_config) or {}).get("path")
            or (_resolve_bitnet_runner(effective_config) or {}).get("command_template")
            or "",
            "messages": messages,
            "summary": "; ".join(blocking_messages) if blocking_messages else "Ready to load",
            "can_load": can_load,
        }

    def ensure_loaded(self) -> bool:
        """Load the configured backend on first use."""
        if self._loaded:
            return True

        with self._lock:
            if self._loaded:
                return True

            readiness = self.readiness()
            if not readiness["can_load"]:
                if self.config.backend != "auto" and os.getenv("COSMO_AUTO_RUNTIME_FALLBACK", "true").lower() == "true":
                    logger.warning(f"Configured backend '{self.config.backend}' is not ready: {readiness.get('summary')}. Falling back to 'auto'.")
                    self.config.backend = "auto"
                    readiness = self.readiness()

                if not readiness["can_load"]:
                    self._last_error = readiness.get("summary", "Unknown error")
                    logger.error(f"Chat runtime blocked: {self._last_error}")
                    return False

            try:
                resolved = resolve_runtime_choice(self.config)
                active_config = resolved.config if resolved is not None else self.config
                backend = active_config.backend
                if backend == "stub":
                    self._load_stub()
                elif backend == "micro_transformer":
                    previous_config = self.config
                    try:
                        self.config = active_config
                        self._load_micro_transformer()
                    finally:
                        self.config = previous_config
                elif backend == "llama_cpp":
                    previous_config = self.config
                    try:
                        self.config = active_config
                        self._load_llama_cpp()
                    finally:
                        self.config = previous_config
                elif backend == "bitnet_cpp":
                    previous_config = self.config
                    try:
                        self.config = active_config
                        self._load_bitnet_cpp()
                    finally:
                        self.config = previous_config
                elif backend == "airllm":
                    previous_config = self.config
                    try:
                        self.config = active_config
                        self._load_airllm()
                    finally:
                        self.config = previous_config
                else:
                    previous_config = self.config
                    try:
                        self.config = active_config
                        self._load_transformers()
                    finally:
                        self.config = previous_config

                self._loaded = True
                self._last_error = None
                self._loaded_at = time.time()
                self._resolved_config = active_config
                self._resolved_profile = resolved.selected_profile if resolved is not None else self._selected_profile
                logger.success(f"Chat runtime ready: {self._backend_name}")
                return True
            except Exception as exc:
                self._last_error = str(exc)
                logger.error(f"Failed to initialize chat runtime: {exc}")
                self._resolved_config = None
                self._resolved_profile = None
                return False

    def is_ready(self) -> bool:
        return self._loaded

    def unload(self):
        with self._lock:
            self._model = None
            self._tokenizer = None
            self._loaded = False
            self._backend_name = "uninitialized"
            self._loaded_at = None
            self._last_error = None
            self._resolved_config = None
            self._resolved_profile = None

    def reconfigure(
        self,
        config: RuntimeConfig,
        selected_profile: Optional[str] = None,
        persist: bool = True,
    ):
        with self._lock:
            self._model = None
            self._tokenizer = None
            self._loaded = False
            self._backend_name = "uninitialized"
            self._loaded_at = None
            self._last_error = None
            self._resolved_config = None
            self._resolved_profile = None
            self.config = config
            self._selected_profile = selected_profile or "custom"
            if persist:
                save_runtime_state(config, self._selected_profile)

    def get_selected_profile(self) -> str:
        return self._selected_profile

    def status(self) -> Dict[str, Any]:
        resolved = resolve_runtime_choice(self.config)
        return {
            "configured_backend": self.config.backend,
            "resolved_backend": (self._resolved_config.backend if self._resolved_config is not None else resolved.backend if resolved else None),
            "active_backend": self._backend_name,
            "model_id": (
                (
                    self._resolved_config.bitnet_model_path
                    or self._resolved_config.airllm_model_id
                    or self._resolved_config.model_id
                )
                if self._resolved_config is not None
                else (
                    resolved.model_id
                    if resolved is not None
                    else (self.config.bitnet_model_path or self.config.airllm_model_id or self.config.model_id)
                )
            ),
            "loaded": self._loaded,
            "loaded_at": self._loaded_at,
            "last_error": self._last_error,
            "selected_profile": self._selected_profile,
            "resolved_profile": self._resolved_profile or (resolved.selected_profile if resolved is not None else None),
            "auto_selection_reason": resolved.reason if self.config.backend == "auto" and resolved is not None else None,
            "config": asdict(self.config),
            "resolved_config": asdict(self._resolved_config) if self._resolved_config is not None else (asdict(resolved.config) if resolved is not None else None),
            "readiness": self.readiness(),
        }

    def generate(
        self,
        prompt: str,
        max_new_tokens: int = 256,
        temperature: float = 0.7,
        top_p: float = 0.9,
    ) -> Dict[str, Any]:
        """Run text generation through the active backend."""
        if not self.ensure_loaded():
            raise RuntimeError(self._last_error or "Chat runtime not available")

        max_new_tokens = min(max_new_tokens, self.config.max_new_tokens)
        
        stop_words = [
            "<|im_end|>", "<|im_start|>user", "<|im_start|>system", 
            "\nUser:", "\nAssistant:", "User:", "Assistant:", 
            "\n\nUser:", "\n\nAssistant:", "### Instruction:", "### Response:"
        ]

        if self._backend_name == "llama_cpp":
            response = self._model(
                prompt,
                max_tokens=max_new_tokens,
                temperature=temperature,
                top_p=top_p,
                stop=stop_words,
            )
            text = response["choices"][0]["text"].strip()
            # Failsafe truncation
            for stop_word in stop_words:
                if stop_word in text:
                    text = text.split(stop_word)[0].strip()
            return {
                "text": text,
                "model_used": os.path.basename(self.config.gguf_model_path) or "llama_cpp",
                "backend": self._backend_name,
            }

        if self._backend_name == "llama_cpp_cli":
            cli_path = self._model["cli_path"]
            model_path = self._model["model_path"]
            command = [
                cli_path,
                "-m",
                model_path,
                "-p",
                prompt,
                "-n",
                str(max_new_tokens),
                "-c",
                str(self.config.max_context_tokens),
                "-t",
                str(self.config.n_threads),
                "--temp",
                str(temperature),
                "--top-p",
                str(top_p),
                "--simple-io",
                "--no-display-prompt",
                "--no-perf",
                "--no-warmup",
                "-no-cnv",
            ]
            for word in stop_words:
                command.extend(["-r", word])
                
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
                timeout=max(120, max_new_tokens * 5),
                cwd=str(Path(cli_path).parent),
            )
            if result.returncode != 0:
                stderr = result.stderr.strip() or result.stdout.strip()
                raise RuntimeError(stderr or f"llama.cpp completion failed with exit code {result.returncode}")
            text = result.stdout.strip()
            if "[end of text]" in text:
                text = text.replace("[end of text]", "").strip()
            # Failsafe truncation
            for stop_word in stop_words:
                if stop_word in text:
                    text = text.split(stop_word)[0].strip()
            return {
                "text": text,
                "model_used": os.path.basename(model_path) or "llama_cpp_cli",
                "backend": self._backend_name,
            }

        if self._backend_name == "bitnet_cpp":
            runner = self._model["runner"]
            model_path = self._model["model_path"]
            timeout_seconds = max(120, max_new_tokens * 5)

            if runner["kind"] == "template":
                command = runner["command_template"].format_map(
                    {
                        "python": sys.executable,
                        "model_path": model_path,
                        "prompt": prompt,
                        "max_new_tokens": max_new_tokens,
                        "max_context_tokens": self.config.max_context_tokens,
                        "n_threads": self.config.n_threads,
                        "temperature": temperature,
                        "top_p": top_p,
                    }
                )
                result = subprocess.run(
                    command,
                    shell=True,
                    cwd=runner.get("cwd") or None,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="ignore",
                    timeout=timeout_seconds,
                )
            elif runner["kind"] == "python_script":
                command = [
                    sys.executable,
                    runner["path"],
                    "-m",
                    model_path,
                    "-p",
                    prompt,
                    "-n",
                    str(max_new_tokens),
                    "-c",
                    str(self.config.max_context_tokens),
                    "-t",
                    str(self.config.n_threads),
                    "--temp",
                    str(temperature),
                    "--top-p",
                    str(top_p),
                ]
                result = subprocess.run(
                    command,
                    cwd=runner.get("cwd") or None,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="ignore",
                    timeout=timeout_seconds,
                )
            else:
                raise RuntimeError(f"Unsupported BitNet runner kind: {runner['kind']}")

            if result.returncode != 0:
                stderr = result.stderr.strip() or result.stdout.strip()
                raise RuntimeError(stderr or f"BitNet inference failed with exit code {result.returncode}")
            text = result.stdout.strip()
            if text.startswith(prompt):
                text = text[len(prompt):].strip()
            # Failsafe truncation
            for stop_word in stop_words:
                if stop_word in text:
                    text = text.split(stop_word)[0].strip()
            return {
                "text": text,
                "model_used": os.path.basename(model_path) or "bitnet_cpp",
                "backend": self._backend_name,
            }

        if self._backend_name == "stub":
            preview = prompt.strip().splitlines()[-1] if prompt.strip() else "empty prompt"
            return {
                "text": f"stub response: {preview[:120]}",
                "model_used": "stub-model",
                "backend": self._backend_name,
            }

        if self._backend_name == "micro_transformer":
            import torch

            prompt_ids = self._tokenizer.encode(prompt, add_special_tokens=True)
            max_prompt_tokens = max(8, self.config.max_context_tokens - max_new_tokens)
            if len(prompt_ids) > max_prompt_tokens:
                prompt_ids = prompt_ids[-max_prompt_tokens:]
                if prompt_ids and prompt_ids[0] != self._tokenizer.bos_id:
                    prompt_ids = [self._tokenizer.bos_id, *prompt_ids[1:]]

            device = torch.device("cpu")
            try:
                device = next(self._model.parameters()).device
            except (AttributeError, StopIteration, TypeError):
                device = torch.device("cpu")

            input_ids = torch.tensor([prompt_ids], dtype=torch.long, device=device)
            output_ids = self._model.generate(
                input_ids,
                max_new_tokens=max_new_tokens,
                temperature=max(temperature, 1e-5),
                top_k=50,
                top_p=top_p,
                stop_tokens=[self._tokenizer.eos_id],
            )
            generated_ids = output_ids[0][len(prompt_ids) :].tolist()
            text = self._tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
            text = _repair_collapsed_spacing(text)
            # Failsafe truncation
            for stop_word in stop_words:
                if stop_word in text:
                    text = text.split(stop_word)[0].strip()
            return {
                "text": text,
                "model_used": self.config.model_id or "cosmo-micro-transformer",
                "backend": self._backend_name,
            }

        if self._backend_name == "airllm":
            import torch

            inputs = self._tokenizer(
                [prompt],
                return_tensors="pt",
                truncation=True,
                max_length=max(256, self.config.max_context_tokens - max_new_tokens),
            )
            if torch.cuda.is_available():
                input_ids = inputs["input_ids"].cuda()
            else:
                input_ids = inputs["input_ids"]
            output_ids = self._model.generate(
                input_ids,
                max_new_tokens=max_new_tokens,
            )
            text = self._tokenizer.decode(output_ids[0], skip_special_tokens=True)
            if text.startswith(prompt):
                text = text[len(prompt):].strip()
            # Failsafe truncation
            for stop_word in stop_words:
                if stop_word in text:
                    text = text.split(stop_word)[0].strip()
            return {
                "text": text,
                "model_used": self.config.airllm_model_id or self.config.model_id,
                "backend": self._backend_name,
            }

        import torch

        inputs = self._tokenizer(
            prompt,
            return_tensors="pt",
            truncation=True,
            max_length=max(256, self.config.max_context_tokens - max_new_tokens),
        )
        inputs = {key: value.to(self.config.device) for key, value in inputs.items()}

        with torch.inference_mode():
            output_ids = self._model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=temperature > 0,
                temperature=max(temperature, 1e-5),
                top_p=top_p,
                pad_token_id=self._tokenizer.pad_token_id,
                eos_token_id=self._tokenizer.eos_token_id,
            )

        prompt_len = inputs["input_ids"].shape[1]
        generated_ids = output_ids[0][prompt_len:]
        text = self._tokenizer.decode(generated_ids, skip_special_tokens=True).strip()

        # Failsafe truncation
        for stop_word in stop_words:
            if stop_word in text:
                text = text.split(stop_word)[0].strip()

        return {
            "text": text,
            "model_used": self.config.model_id,
            "backend": self._backend_name,
        }


_runtime_manager: Optional[ChatRuntimeManager] = None
_self_learner_runtime_manager: Optional[ChatRuntimeManager] = None
_bitnet_runtime_manager: Optional[ChatRuntimeManager] = None


def get_chat_runtime_manager() -> ChatRuntimeManager:
    global _runtime_manager
    if _runtime_manager is None:
        _runtime_manager = ChatRuntimeManager()
    return _runtime_manager


def get_self_learner_runtime_manager() -> ChatRuntimeManager:
    global _self_learner_runtime_manager
    if _self_learner_runtime_manager is None:
        _self_learner_runtime_manager = ChatRuntimeManager(config=_default_self_learner_config())
        _self_learner_runtime_manager._selected_profile = "self-learner-turbo"
    return _self_learner_runtime_manager


def get_bitnet_runtime_manager() -> ChatRuntimeManager:
    global _bitnet_runtime_manager
    if _bitnet_runtime_manager is None:
        _bitnet_runtime_manager = ChatRuntimeManager(config=_default_profile_config("bitnet-cpu"))
        _bitnet_runtime_manager._selected_profile = "bitnet-cpu"
    return _bitnet_runtime_manager
