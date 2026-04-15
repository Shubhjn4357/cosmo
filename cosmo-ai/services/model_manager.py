"""
Runtime profile and local model download management.
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from huggingface_hub import HfApi, hf_hub_download, snapshot_download
from loguru import logger

from services import hf_dataset_sync
from services.approved_model_catalog import DEFAULT_TEXT_MODEL_ID, get_text_model
from services.admin_state import get_model_enabled
from services.runtime_manager import (
    DEFAULT_BITNET_FILENAME,
    DEFAULT_BITNET_MODEL_ID,
    DEFAULT_BITNET_MODEL_PATH,
    DEFAULT_BITNET_REPO_PATH,
    RuntimeConfig,
    SELF_LEARNER_CHECKPOINT,
    SELF_LEARNER_INT8_CHECKPOINT,
    SELF_LEARNER_TOKENIZER,
    _resolve_bitnet_runner,
    _resolve_llama_cli_path,
    airllm_import_diagnostics,
    validate_runtime_config,
)
from utils.app_paths import DATA_ROOT, MODELS_DIR, ensure_app_dirs

# ensure_app_dirs() - Moved to app.py

DOWNLOAD_COPY_CHUNK_BYTES = 8 * 1024 * 1024
DOWNLOAD_PROGRESS_STEP_BYTES = 32 * 1024 * 1024


@dataclass
class RuntimeProfile:
    id: str
    name: str
    description: str
    backend: str
    model_id: str
    recommended_for: str
    repo_id: str = ""
    filename: str = ""
    gguf_model_path: str = ""
    airllm_model_id: str = ""
    airllm_model_path: str = ""
    bitnet_model_path: str = ""
    bitnet_repo_path: str = ""
    bitnet_command_template: str = ""
    micro_checkpoint_path: str = ""
    micro_quantized_checkpoint_path: str = ""
    micro_tokenizer_path: str = ""
    max_context_tokens: int = 4096
    max_new_tokens: int = 512
    allow_remote_code: bool = False
    device: str = "cpu"

    def to_runtime_config(self) -> RuntimeConfig:
        return RuntimeConfig(
            backend=self.backend,
            model_id=self.model_id,
            gguf_model_path=self.gguf_model_path,
            airllm_model_id=self.airllm_model_id,
            airllm_model_path=self.airllm_model_path,
            bitnet_model_path=self.bitnet_model_path,
            bitnet_repo_path=self.bitnet_repo_path,
            bitnet_command_template=self.bitnet_command_template,
            micro_checkpoint_path=self.micro_checkpoint_path,
            micro_quantized_checkpoint_path=self.micro_quantized_checkpoint_path,
            micro_tokenizer_path=self.micro_tokenizer_path,
            max_context_tokens=self.max_context_tokens,
            max_new_tokens=self.max_new_tokens,
            allow_remote_code=self.allow_remote_code,
            device=self.device,
        )


_DEFAULT_TEXT_MODEL = get_text_model(DEFAULT_TEXT_MODEL_ID)
_DEFAULT_BALANCED_MODEL = get_text_model("qwen3-4b-q4km")
_DEFAULT_REASONING_MODEL = get_text_model("deepseek-r1-distill-qwen-7b-q4km")
_DEFAULT_COMPLEX_MODEL_ID = os.getenv("COSMO_COMPLEX_TASK_MODEL_ID", "Qwen/Qwen3-Coder-Next")
_DEFAULT_FAST_TRANSFORMERS_MODEL_ID = os.getenv("COSMO_FAST_PROFILE_MODEL_ID", "Qwen/Qwen3-1.7B")
_DEFAULT_BALANCED_TRANSFORMERS_MODEL_ID = os.getenv("COSMO_BALANCED_PROFILE_MODEL_ID", "Qwen/Qwen3-4B")
_DEFAULT_HEAVY_AIRLLM_MODEL_ID = os.getenv(
    "COSMO_HEAVY_PROFILE_MODEL_ID",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
)

if _DEFAULT_TEXT_MODEL is None or _DEFAULT_BALANCED_MODEL is None or _DEFAULT_REASONING_MODEL is None:
    raise RuntimeError("Approved model catalog defaults are missing")


RUNTIME_PROFILES: Dict[str, RuntimeProfile] = {
    "fast-coder": RuntimeProfile(
        id="fast-coder",
        name="Fast Coder",
        description="Small approved CPU-friendly profile for quick replies.",
        backend="transformers",
        model_id=_DEFAULT_FAST_TRANSFORMERS_MODEL_ID,
        recommended_for="Default coding chat on CPU",
        max_context_tokens=4096,
        max_new_tokens=384,
    ),
    "balanced-coder": RuntimeProfile(
        id="balanced-coder",
        name="Balanced Coder",
        description="Higher-quality approved 4B profile for better responses on CPU.",
        backend="transformers",
        model_id=_DEFAULT_BALANCED_TRANSFORMERS_MODEL_ID,
        recommended_for="Higher-quality coding on CPU",
        max_context_tokens=4096,
        max_new_tokens=512,
    ),
    "gguf-coder": RuntimeProfile(
        id="gguf-coder",
        name="GGUF Coder",
        description="Approved default GGUF profile prepared after startup in the background.",
        backend="llama_cpp",
        model_id=_DEFAULT_TEXT_MODEL.repo_id,
        recommended_for="CPU-optimized GGUF serving",
        repo_id=_DEFAULT_TEXT_MODEL.repo_id,
        filename=_DEFAULT_TEXT_MODEL.filename,
        gguf_model_path=str(MODELS_DIR / "llm" / "gguf-coder" / _DEFAULT_TEXT_MODEL.filename),
        max_context_tokens=8192,
        max_new_tokens=512,
    ),
    "heavy-airllm": RuntimeProfile(
        id="heavy-airllm",
        name="Heavy AirLLM",
        description="Reasoning-oriented larger profile for stronger server responses.",
        backend="airllm",
        model_id=_DEFAULT_HEAVY_AIRLLM_MODEL_ID,
        airllm_model_id=_DEFAULT_HEAVY_AIRLLM_MODEL_ID,
        airllm_model_path=str(MODELS_DIR / "llm" / "heavy-airllm"),
        recommended_for="Upgraded hardware or experimental full-local tier",
        max_context_tokens=8192,
        max_new_tokens=768,
    ),
    "complex-coder-next": RuntimeProfile(
        id="complex-coder-next",
        name="Qwen3 Coder Next",
        description="Dedicated complex-task coding profile routed automatically for deep implementation and reasoning work.",
        backend="transformers",
        model_id=_DEFAULT_COMPLEX_MODEL_ID,
        recommended_for="Complex coding, multi-step implementation, deep repo analysis, and agent synthesis",
        max_context_tokens=int(os.getenv("COSMO_COMPLEX_TASK_MAX_CONTEXT_TOKENS", "16384")),
        max_new_tokens=int(os.getenv("COSMO_COMPLEX_TASK_MAX_NEW_TOKENS", "1024")),
        allow_remote_code=os.getenv("COSMO_COMPLEX_TASK_TRUST_REMOTE_CODE", "true").lower() == "true",
        device=os.getenv("COSMO_COMPLEX_TASK_DEVICE", os.getenv("LOCAL_MODEL_DEVICE", "cpu")),
    ),
    "self-learner-turbo": RuntimeProfile(
        id="self-learner-turbo",
        name="Self-Learner Turbo",
        description="Scratch-built Cosmo transformer with automatic learning and int8 turbo quant checkpoints.",
        backend="micro_transformer",
        model_id="cosmo-micro-transformer",
        recommended_for="Zero-token built-in inference trained from captured pairs",
        micro_checkpoint_path=str(SELF_LEARNER_CHECKPOINT),
        micro_quantized_checkpoint_path=str(SELF_LEARNER_INT8_CHECKPOINT),
        micro_tokenizer_path=str(SELF_LEARNER_TOKENIZER),
        max_context_tokens=1024,
        max_new_tokens=384,
    ),
    "bitnet-cpu": RuntimeProfile(
        id="bitnet-cpu",
        name="BitNet CPU",
        description="Microsoft BitNet profile routed through a local bitnet.cpp runner.",
        backend="bitnet_cpp",
        model_id=DEFAULT_BITNET_MODEL_ID,
        recommended_for="Ultra-efficient CPU chat when bitnet.cpp is installed locally",
        repo_id=DEFAULT_BITNET_MODEL_ID,
        filename=DEFAULT_BITNET_FILENAME,
        bitnet_model_path=str(DEFAULT_BITNET_MODEL_PATH),
        bitnet_repo_path=str(DEFAULT_BITNET_REPO_PATH),
        bitnet_command_template=os.getenv("LOCAL_BITNET_COMMAND_TEMPLATE", ""),
        max_context_tokens=4096,
        max_new_tokens=384,
    ),
}

DOWNLOAD_JOBS: Dict[str, Dict[str, Any]] = {}
FILE_METADATA_CACHE: Dict[tuple[str, str], dict] = {}
PROFILE_VALIDATIONS: Dict[str, Dict[str, Any]] = {}
DOWNLOAD_LOG_DIR = DATA_ROOT / "runtime" / "download_jobs"


def _package_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def get_backend_availability() -> Dict[str, bool]:
    return {
        "transformers": _package_available("transformers"),
        "llama_cpp": _package_available("llama_cpp") or _resolve_llama_cli_path() is not None,
        "airllm": airllm_import_diagnostics().get("available", False),
        "bitnet_cpp": _resolve_bitnet_runner(RuntimeConfig(backend="bitnet_cpp")) is not None,
        "micro_transformer": _package_available("torch"),
    }


def get_profiles() -> Dict[str, RuntimeProfile]:
    return RUNTIME_PROFILES


def get_profile(profile_id: str) -> RuntimeProfile:
    profile = RUNTIME_PROFILES.get(profile_id)
    if profile is None:
        raise KeyError(profile_id)
    return profile


def list_local_model_artifacts() -> list[dict]:
    artifacts = []
    if not MODELS_DIR.exists():
        return artifacts

    for path in MODELS_DIR.rglob("*"):
        if not path.is_file():
            continue
        artifacts.append(
            {
                "name": path.name,
                "path": str(path),
                "size_bytes": path.stat().st_size,
                "modified_at": path.stat().st_mtime,
            }
        )
    return sorted(artifacts, key=lambda item: item["path"])


def _directory_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    return sum(child.stat().st_size for child in path.rglob("*") if child.is_file())


def _get_hf_token() -> Optional[str]:
    return os.getenv("HF_READONLY_TOKEN", "").strip() or hf_dataset_sync.get_hf_token()


def _get_repo_file_metadata(repo_id: str, filename: str) -> dict:
    cache_key = (repo_id, filename)
    if cache_key in FILE_METADATA_CACHE:
        return FILE_METADATA_CACHE[cache_key]

    metadata = {}
    try:
        info = HfApi(token=_get_hf_token()).model_info(repo_id, files_metadata=True)
        for sibling in getattr(info, "siblings", []):
            if getattr(sibling, "rfilename", "") != filename:
                continue
            metadata = {
                "filename": filename,
                "size_bytes": getattr(sibling, "size", None),
            }
            break
    except Exception as exc:
        logger.warning(f"Failed to read metadata for {repo_id}/{filename}: {exc}")

    FILE_METADATA_CACHE[cache_key] = metadata
    return metadata


def _profile_artifact_path(profile: RuntimeProfile) -> Path:
    if profile.backend == "llama_cpp" and profile.gguf_model_path:
        return Path(profile.gguf_model_path)
    if profile.backend == "bitnet_cpp" and profile.bitnet_model_path:
        return Path(profile.bitnet_model_path)
    if profile.backend == "airllm" and profile.airllm_model_path:
        return Path(profile.airllm_model_path)
    if profile.backend == "micro_transformer":
        candidates = [profile.micro_quantized_checkpoint_path, profile.micro_checkpoint_path]
        for candidate in candidates:
            if candidate and Path(candidate).exists():
                return Path(candidate)
        for candidate in candidates:
            if candidate:
                return Path(candidate)
    return MODELS_DIR / "llm" / profile.id


def _profile_status(profile: RuntimeProfile) -> dict:
    backends = get_backend_availability()
    backend_available = backends.get(profile.backend, False)
    artifact_required = profile.backend in {"llama_cpp", "bitnet_cpp", "micro_transformer"}
    artifact_optional = profile.backend == "airllm"
    artifact_path = _profile_artifact_path(profile)
    artifact_exists = artifact_path.exists()
    artifact_size_bytes = _directory_size_bytes(artifact_path)
    expected_size_bytes = None
    status_reasons = []
    tokenizer_path = Path(profile.micro_tokenizer_path) if profile.micro_tokenizer_path else None
    tokenizer_exists = bool(tokenizer_path and tokenizer_path.exists())

    if profile.backend in {"llama_cpp", "bitnet_cpp"} and profile.repo_id and profile.filename:
        metadata = _get_repo_file_metadata(profile.repo_id, profile.filename)
        expected_size_bytes = metadata.get("size_bytes")

    if not backend_available:
        package_name = {
            "llama_cpp": "llama-cpp-python or llama.cpp completion binary",
            "airllm": airllm_import_diagnostics().get("error") or "airllm",
            "bitnet_cpp": "bitnet.cpp runner",
            "micro_transformer": "torch",
        }.get(profile.backend, profile.backend)
        status_reasons.append(f"Missing backend package: {package_name}")
    elif profile.backend == "llama_cpp" and _package_available("llama_cpp") is False and _resolve_llama_cli_path() is not None:
        status_reasons.append(f"Using llama.cpp binary fallback: {_resolve_llama_cli_path()}")
    elif profile.backend == "bitnet_cpp" and backend_available:
        status_reasons.append("bitnet.cpp runner is available")
    elif profile.backend == "airllm" and airllm_import_diagnostics().get("shimmed"):
        status_reasons.append("AirLLM BetterTransformer compatibility shim is active")
    elif profile.backend == "micro_transformer" and artifact_exists and tokenizer_exists:
        status_reasons.append("Turbo quant checkpoint and tokenizer are available")

    if artifact_required:
        if profile.backend == "llama_cpp":
            if not profile.gguf_model_path:
                status_reasons.append("GGUF model path is not configured")
            elif not artifact_exists:
                status_reasons.append("GGUF artifact has not been downloaded yet")
        if profile.backend == "bitnet_cpp":
            if not profile.bitnet_model_path:
                status_reasons.append("BitNet model path is not configured")
            elif not artifact_exists:
                status_reasons.append("BitNet artifact has not been downloaded yet")
        if profile.backend == "micro_transformer":
            if not (profile.micro_quantized_checkpoint_path or profile.micro_checkpoint_path):
                status_reasons.append("Self-learner checkpoint path is not configured")
            elif not artifact_exists:
                status_reasons.append("Self-learner checkpoint has not been trained yet")
            if not profile.micro_tokenizer_path:
                status_reasons.append("Self-learner tokenizer path is not configured")
            elif not tokenizer_exists:
                status_reasons.append("Self-learner tokenizer has not been generated yet")
    elif artifact_optional:
        if artifact_exists:
            status_reasons.append("Local AirLLM snapshot is available")
        else:
            status_reasons.append("AirLLM will download or stream model weights at runtime")

    ready = backend_available and (
        (artifact_exists and tokenizer_exists) if profile.backend == "micro_transformer" else (artifact_exists if artifact_required else True)
    )
    if ready:
        status_message = "Ready to load"
    else:
        status_message = "; ".join(status_reasons) or "Not ready"

    progress = None
    if artifact_required and expected_size_bytes:
        progress = min(1.0, artifact_size_bytes / expected_size_bytes) if artifact_size_bytes else 0.0

    return {
        "backend_available": backend_available,
        "artifact_required": artifact_required,
        "artifact_optional": artifact_optional,
        "artifact_path": str(artifact_path),
        "artifact_exists": artifact_exists,
        "artifact_size_bytes": artifact_size_bytes,
        "expected_size_bytes": expected_size_bytes,
        "artifact_progress": progress,
        "tokenizer_path": str(tokenizer_path) if tokenizer_path else "",
        "tokenizer_exists": tokenizer_exists,
        "ready": ready,
        "status_message": status_message,
        "status_reasons": status_reasons,
    }


def _mark_job(job_id: str, **updates):
    job = DOWNLOAD_JOBS.get(job_id)
    if job is None:
        return
    job.update(updates)
    total_bytes = job.get("total_bytes")
    bytes_downloaded = job.get("bytes_downloaded")
    if total_bytes:
        job["progress"] = min(1.0, (bytes_downloaded or 0) / total_bytes)
    job["updated_at"] = time.time()


def _snapshot_runner_script() -> Path:
    return Path(__file__).resolve().parents[1] / "scripts" / "download_model_snapshot.py"


def _close_job_handles(job: dict):
    handle = job.pop("_log_handle", None)
    if handle is not None:
        try:
            handle.close()
        except Exception:
            pass


def _tail_log(path: Path, max_chars: int = 400) -> str:
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""
    text = text.strip()
    return text[-max_chars:] if len(text) > max_chars else text


def _copy_with_progress(source: Path, target: Path, job_id: str):
    total_bytes = source.stat().st_size
    temp_target = target.with_suffix(f"{target.suffix}.part")
    if temp_target.exists():
        temp_target.unlink()

    copied = 0
    last_reported = 0
    with source.open("rb") as src, temp_target.open("wb") as dst:
        while True:
            chunk = src.read(DOWNLOAD_COPY_CHUNK_BYTES)
            if not chunk:
                break
            dst.write(chunk)
            copied += len(chunk)
            if copied == total_bytes or copied - last_reported >= DOWNLOAD_PROGRESS_STEP_BYTES:
                _mark_job(job_id, bytes_downloaded=copied, total_bytes=total_bytes)
                last_reported = copied

    temp_target.replace(target)
    return total_bytes


def _sync_profile_artifact(path: Path):
    if not path.exists():
        return
    try:
        if path.is_dir():
            hf_dataset_sync.sync_directory(path)
        else:
            hf_dataset_sync.sync_path(path)
    except Exception as exc:
        logger.debug(f"Model artifact sync skipped for {path}: {exc}")


def _download_profile_assets(job_id: str, profile: RuntimeProfile):
    hf_token = _get_hf_token()

    _mark_job(job_id, status="running", stage="preparing")
    try:
        if profile.backend in {"llama_cpp", "bitnet_cpp"} and profile.repo_id and profile.filename:
            target_path = profile.gguf_model_path if profile.backend == "llama_cpp" else profile.bitnet_model_path
            target = Path(target_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            expected_size_bytes = _get_repo_file_metadata(profile.repo_id, profile.filename).get("size_bytes")
            if target.exists() and expected_size_bytes and target.stat().st_size == expected_size_bytes:
                _mark_job(
                    job_id,
                    status="completed",
                    stage="ready",
                    output_path=str(target),
                    bytes_downloaded=expected_size_bytes,
                    total_bytes=expected_size_bytes,
                )
                return

            _mark_job(
                job_id,
                stage="downloading from hub",
                output_path=str(target),
                total_bytes=expected_size_bytes,
                bytes_downloaded=target.stat().st_size if target.exists() else 0,
            )
            downloaded = hf_hub_download(
                repo_id=profile.repo_id,
                filename=profile.filename,
                token=hf_token,
            )
            _mark_job(job_id, stage="copying to runtime store")
            copied_bytes = _copy_with_progress(Path(downloaded), target, job_id)
            _sync_profile_artifact(target)
            _mark_job(
                job_id,
                status="completed",
                stage="ready",
                output_path=str(target),
                bytes_downloaded=copied_bytes,
                total_bytes=copied_bytes,
            )
            return

        target_dir = MODELS_DIR / "llm" / profile.id
        target_dir.mkdir(parents=True, exist_ok=True)
        _mark_job(job_id, stage="syncing repository", output_path=str(target_dir))
        snapshot_download(
            repo_id=profile.model_id,
            token=hf_token,
            local_dir=str(target_dir),
            local_dir_use_symlinks=False,
        )
        _sync_profile_artifact(target_dir)
        total_bytes = _directory_size_bytes(target_dir)
        _mark_job(
            job_id,
            status="completed",
            stage="ready",
            output_path=str(target_dir),
            bytes_downloaded=total_bytes,
            total_bytes=total_bytes,
        )
    except Exception as exc:
        logger.error(f"Model download failed for {profile.id}: {exc}")
        _mark_job(job_id, status="failed", stage="failed", error=str(exc))


def _spawn_snapshot_download_job(job_id: str, profile: RuntimeProfile, target_dir: Path):
    DOWNLOAD_LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = DOWNLOAD_LOG_DIR / f"{job_id}.log"
    log_handle = log_path.open("w", encoding="utf-8")
    command = [
        sys.executable,
        str(_snapshot_runner_script()),
        "--repo-id",
        profile.model_id,
        "--target-dir",
        str(target_dir),
        "--max-workers",
        "1",
    ]
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    env.setdefault("TOKENIZERS_PARALLELISM", "false")

    try:
        process = subprocess.Popen(
            command,
            cwd=str(Path(__file__).resolve().parents[1]),
            env=env,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
        )
    except Exception:
        log_handle.close()
        raise

    _mark_job(
        job_id,
        status="running",
        stage="syncing repository",
        output_path=str(target_dir),
        runner="subprocess",
        pid=process.pid,
        log_path=str(log_path),
    )
    job = DOWNLOAD_JOBS[job_id]
    job["_process"] = process
    job["_log_handle"] = log_handle


def _poll_download_job(job: dict):
    output_path = job.get("output_path")
    artifact_path = Path(output_path) if output_path else None
    if artifact_path is not None and artifact_path.exists():
        job["bytes_downloaded"] = _directory_size_bytes(artifact_path)
        total_bytes = job.get("total_bytes")
        if total_bytes:
            job["progress"] = min(1.0, job["bytes_downloaded"] / total_bytes)

    process = job.get("_process")
    if process is None or job.get("runner") != "subprocess" or job.get("status") not in {"queued", "running"}:
        return

    returncode = process.poll()
    if returncode is None:
        job["status"] = "running"
        return

    job.pop("_process", None)
    _close_job_handles(job)

    if returncode == 0:
        final_bytes = _directory_size_bytes(artifact_path) if artifact_path is not None else 0
        if artifact_path is not None and artifact_path.exists():
            _sync_profile_artifact(artifact_path)
        _mark_job(
            job["id"],
            status="completed",
            stage="ready",
            bytes_downloaded=final_bytes,
            total_bytes=final_bytes,
            error=None,
        )
        return

    log_tail = _tail_log(Path(job["log_path"])) if job.get("log_path") else ""
    error_message = f"Snapshot download process exited with code {returncode}"
    if log_tail:
        error_message = f"{error_message}: {log_tail}"
    _mark_job(job["id"], status="failed", stage="failed", error=error_message)


def queue_profile_download(profile_id: str) -> dict:
    profile = get_profile(profile_id)
    status = _profile_status(profile)
    if status["artifact_exists"]:
        existing_completed = next(
            (
                job for job in DOWNLOAD_JOBS.values()
                if job["profile_id"] == profile.id and job["status"] == "completed"
            ),
            None,
        )
        if existing_completed is not None:
            return existing_completed
        artifact_path = _profile_artifact_path(profile)
        return {
            "id": f"ready-{profile.id}",
            "profile_id": profile.id,
            "profile_name": profile.name,
            "profile_backend": profile.backend,
            "status": "completed",
            "stage": "ready",
            "created_at": time.time(),
            "updated_at": time.time(),
            "error": None,
            "output_path": str(artifact_path),
            "bytes_downloaded": status["artifact_size_bytes"],
            "total_bytes": status["artifact_size_bytes"],
            "progress": 1.0,
        }

    existing_job = next(
        (
            job for job in DOWNLOAD_JOBS.values()
            if job["profile_id"] == profile.id and job["status"] in {"queued", "running"}
        ),
        None,
    )
    if existing_job is not None:
        return existing_job

    artifact_path = _profile_artifact_path(profile)
    job_id = uuid.uuid4().hex
    DOWNLOAD_JOBS[job_id] = {
        "id": job_id,
        "profile_id": profile.id,
        "profile_name": profile.name,
        "profile_backend": profile.backend,
        "status": "queued",
        "stage": "queued",
        "created_at": time.time(),
        "updated_at": time.time(),
        "error": None,
        "output_path": str(artifact_path),
        "bytes_downloaded": 0,
        "total_bytes": None,
        "progress": 0.0,
    }
    if profile.backend in {"llama_cpp", "bitnet_cpp"}:
        thread = threading.Thread(target=_download_profile_assets, args=(job_id, profile), daemon=True)
        thread.start()
    else:
        target_dir = MODELS_DIR / "llm" / profile.id
        target_dir.mkdir(parents=True, exist_ok=True)
        try:
            _spawn_snapshot_download_job(job_id, profile, target_dir)
        except Exception as exc:
            logger.error(f"Model download failed to start for {profile.id}: {exc}")
            _mark_job(job_id, status="failed", stage="failed", error=str(exc))
    return DOWNLOAD_JOBS[job_id]


def get_download_jobs() -> list[dict]:
    jobs = []
    for job in DOWNLOAD_JOBS.values():
        _poll_download_job(job)
        snapshot = dict(job)
        snapshot.pop("_process", None)
        snapshot.pop("_log_handle", None)
        output_path = snapshot.get("output_path")
        if output_path:
            artifact_path = Path(output_path)
            if artifact_path.exists():
                snapshot["bytes_downloaded"] = _directory_size_bytes(artifact_path)
                if snapshot.get("total_bytes"):
                    snapshot["progress"] = min(
                        1.0,
                        snapshot["bytes_downloaded"] / snapshot["total_bytes"],
                    )
        jobs.append(snapshot)
    return sorted(jobs, key=lambda item: item["created_at"], reverse=True)


def validate_profile(profile_id: str, *, test_load: bool = False, refresh_imports: bool = True) -> dict:
    profile = get_profile(profile_id)
    validation = validate_runtime_config(
        profile.to_runtime_config(),
        selected_profile=profile.id,
        test_load=test_load,
        refresh_imports=refresh_imports,
    )
    validation.update(
        {
            "profile_id": profile.id,
            "profile_name": profile.name,
            "backend": profile.backend,
            "model_id": profile.model_id,
        }
    )
    PROFILE_VALIDATIONS[profile.id] = validation
    return validation


def runtime_profiles_payload(selected_profile: Optional[str]) -> dict:
    profiles = []
    for profile in RUNTIME_PROFILES.values():
        try:
            profile_status = _profile_status(profile)
            profiles.append(
                {
                    **asdict(profile),
                    **profile_status,
                    "downloaded": profile_status.get("artifact_exists", False),
                    "enabled": get_model_enabled(f"runtime.{profile.id}", True),
                    "validation": PROFILE_VALIDATIONS.get(profile.id),
                }
            )
        except Exception as e:
            logger.warning(f"Failed to include profile {profile.id} in payload: {e}")
            # Add a basic entry so the selector isn't empty
            profiles.append({**asdict(profile), "ready": False, "enabled": True, "status_message": "Initialization error"})

    return {
        "selected_profile": selected_profile,
        "backends": get_backend_availability(),
        "profiles": profiles,
        "local_artifacts": list_local_model_artifacts(),
        "download_jobs": get_download_jobs(),
    }
