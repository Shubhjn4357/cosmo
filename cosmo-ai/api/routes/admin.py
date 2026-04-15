"""
Whisper AI - Admin Dashboard API Routes.
Comprehensively expanded for vision data management, real-time logs, and advanced analytics.
"""

import json
import time
import os
import uuid
from pathlib import Path
from io import BytesIO

from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Any, Optional, List, Dict
from loguru import logger
from PIL import Image

from .auth import verify_admin_token
from services.google_auth import google_auth_status
from .profile import _sanitize_profile, get_db_client
from services.gguf_bootstrap import get_gguf_bootstrap_status, start_gguf_runtime_bootstrap
from services.admin_state import get_model_enabled, set_model_enabled
from services.model_manager import get_profile, get_profiles, queue_profile_download, runtime_profiles_payload, validate_profile
from services.runtime_manager import RuntimeConfig
from services.system_jobs import LOGS_DIR, refresh_job_state, start_training_job, stop_training_job
from services.hf_dataset_sync import status as hf_sync_status, get_hf_token, get_repo_id
from services.cloudflare_crawl import CRAWLER
from services.turso_db import DB_PATH, libsql, validate_database_connection


blocked_ips_storage = []
router = APIRouter()

SMART_PROVIDER_IDS = {"gemini", "huggingface", "local"}


def _count_total_profiles(db_client) -> int:
    if not db_client:
        return 0

    try:
        result = db_client.table("profiles").select("id", count="exact").execute()
        return result.count or 0
    except Exception:
        return 0


def _format_currency_from_paise(amount_paise: int, currency: str = "INR") -> str:
    symbol = "₹" if currency.upper() == "INR" else currency.upper()
    return f"{symbol}{amount_paise / 100:.2f}"


def _require_runtime_profile(profile_id: str):
    normalized = str(profile_id or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="profile_id is required")

    try:
        return get_profile(normalized)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown runtime profile: {normalized}") from exc


def _safe_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _tail_text_file(path: Path, max_chars: int = 4000) -> str:
    if not path.exists():
        return ""
    try:
        # Better tailing logic for large files
        file_size = path.stat().st_size
        if file_size == 0:
            return ""
        
        with open(path, "rb") as f:
            if file_size > max_chars:
                f.seek(-max_chars, 2)
            return f.read().decode("utf-8", errors="ignore").strip()
    except Exception as exc:
        logger.debug(f"Tail failed for {path}: {exc}")
        return ""


def _collect_dataset_payload() -> dict[str, Any]:
    from api.routes.datasets import DATASETS_DIR, list_dataset_entries

    datasets = list_dataset_entries()

    return {
        "datasets": datasets,
        "count": len(datasets),
        "dataset_dir": str(DATASETS_DIR),
    }


def _self_learner_summary() -> dict[str, Any]:
    from api.routes.learn import get_learning_corpus_counts
    from services.runtime_manager import (
        SELF_LEARNER_CHECKPOINT,
        SELF_LEARNER_INT8_CHECKPOINT,
        SELF_LEARNER_STATE,
        SELF_LEARNER_TOKENIZER,
        get_self_learner_chat_thresholds,
        get_self_learner_runtime_manager,
    )

    runtime = get_self_learner_runtime_manager()
    readiness = runtime.readiness()
    training_state = _safe_json_file(SELF_LEARNER_STATE)
    corpus_counts = get_learning_corpus_counts()
    thresholds = get_self_learner_chat_thresholds()
    min_steps = thresholds["min_steps"]
    min_sequences = thresholds["min_sequences"]
    steps = int(training_state.get("steps") or 0)
    sequences = max(int(training_state.get("dataset_sequences") or 0), int(corpus_counts.get("total_sequences") or 0))
    chat_ready = readiness.get("can_load", False) and steps >= min_steps and sequences >= min_sequences
    training_recommended = not (steps >= min_steps and sequences >= min_sequences)

    return {
        "ready": readiness.get("can_load", False),
        "chat_ready": chat_ready,
        "training_recommended": training_recommended,
        "summary": readiness.get("summary"),
        "training_state": {
            **training_state,
            "dataset_sequences": sequences,
            "training_pairs": corpus_counts.get("training_pairs"),
            "external_sources": corpus_counts.get("external_sources"),
        },
        "thresholds": {
            "min_steps": min_steps,
            "min_sequences": min_sequences,
            "step_progress": min(1.0, steps / min_steps) if min_steps > 0 else 1.0,
            "sequence_progress": min(1.0, sequences / min_sequences) if min_sequences > 0 else 1.0,
        },
        "artifacts": {
            "checkpoint": str(SELF_LEARNER_CHECKPOINT),
            "quantized_checkpoint": str(SELF_LEARNER_INT8_CHECKPOINT),
            "tokenizer": str(SELF_LEARNER_TOKENIZER),
            "state": str(SELF_LEARNER_STATE),
            "checkpoint_exists": SELF_LEARNER_CHECKPOINT.exists(),
            "quantized_exists": SELF_LEARNER_INT8_CHECKPOINT.exists(),
            "tokenizer_exists": SELF_LEARNER_TOKENIZER.exists(),
            "state_exists": SELF_LEARNER_STATE.exists(),
        },
        "runtime": runtime.status(),
    }


def _job_logs_snapshot(jobs: dict[str, Any]) -> dict[str, Any]:
    snapshots: dict[str, Any] = {}
    for job_name, job in jobs.items():
        raw_path = job.get("log_path")
        path = Path(raw_path) if raw_path else None
        snapshots[job_name] = {
            "running": bool(job.get("running")),
            "pid": job.get("pid"),
            "log_path": str(path) if path is not None else None,
            "exists": path.exists() if path is not None else False,
            "tail": _tail_text_file(path) if path is not None else "",
        }
    return snapshots


def _ai_mode_cards(
    runtime: dict[str, Any],
    runtime_profiles: dict[str, Any],
    self_learner: dict[str, Any],
    jobs: dict[str, Any],
) -> list[dict[str, Any]]:
    selected_profile = runtime.get("selected_profile") or runtime_profiles.get("selected_profile")
    profiles = runtime_profiles.get("profiles") or []
    ready_profiles = [profile for profile in profiles if profile.get("ready")]
    cloud_providers = [
        name
        for name, configured in (
            ("gemini", bool(os.getenv("GEMINI_API_KEY", "").strip())),
            ("huggingface", bool(get_hf_token())),
            ("openai", bool(os.getenv("OPENAI_API_KEY", "").strip())),
        )
        if configured
    ]
    training_state = self_learner.get("training_state") or {}
    thresholds = self_learner.get("thresholds") or {}

    return [
        {
            "id": "cloud",
            "title": "Cloud Providers",
            "status": "ready" if cloud_providers else "warning",
            "active": False,
            "summary": ", ".join(cloud_providers) if cloud_providers else "No cloud provider keys configured",
            "details": [
                f"{len(cloud_providers)} provider(s) configured",
                "Remote reasoning and fallback capacity",
            ],
        },
        {
            "id": "server",
            "title": "Server Runtime",
            "status": "ready" if runtime.get("readiness", {}).get("can_load") else "error",
            "active": bool(runtime.get("loaded")),
            "summary": runtime.get("readiness", {}).get("summary") or "Runtime not initialized",
            "details": [
                f"Selected profile: {selected_profile or 'custom'}",
                f"Ready profiles: {len(ready_profiles)}/{len(profiles)}",
                f"Backend: {runtime.get('active_backend') or runtime.get('resolved_backend') or 'unknown'}",
            ],
        },
        {
            "id": "self-learner",
            "title": "Self-Learner",
            "status": "ready" if self_learner.get("chat_ready") else ("warning" if self_learner.get("ready") else "error"),
            "active": selected_profile == "self-learner-turbo",
            "summary": self_learner.get("summary") or "Scratch transformer is offline",
            "details": [
                f"Steps: {training_state.get('steps', 0)}/{thresholds.get('min_steps', 0)}",
                f"Sequences: {training_state.get('dataset_sequences', 0)}/{thresholds.get('min_sequences', 0)}",
                "Zero-token local path once warm-up thresholds are met",
            ],
        },
        {
            "id": "training",
            "title": "Training Job",
            "status": "ready" if jobs.get("training", {}).get("running") else "warning",
            "active": bool(jobs.get("training", {}).get("running")),
            "summary": "Training in progress" if jobs.get("training", {}).get("running") else "Idle",
            "details": [
                f"PID: {jobs.get('training', {}).get('pid') or 'n/a'}",
                f"Log: {jobs.get('training', {}).get('log_path') or 'n/a'}",
            ],
        },
        {
            "id": "generator",
            "title": "Generator Job",
            "status": "ready" if jobs.get("generator", {}).get("running") else "warning",
            "active": bool(jobs.get("generator", {}).get("running")),
            "summary": "Generator in progress" if jobs.get("generator", {}).get("running") else "Idle",
            "details": [
                f"PID: {jobs.get('generator', {}).get('pid') or 'n/a'}",
                f"Log: {jobs.get('generator', {}).get('log_path') or 'n/a'}",
            ],
        },
    ]


def _readiness_report(app_state) -> dict:
    runtime = app_state.chat_runtime.status() if app_state.chat_runtime is not None else {}
    selected_profile = app_state.chat_runtime.get_selected_profile() if app_state.chat_runtime is not None else None
    runtime_profiles = runtime_profiles_payload(selected_profile)
    hf_status = hf_sync_status()
    cloudflare_status = CRAWLER.status()
    google_status = google_auth_status()
    turso_url = os.getenv("TURSO_DATABASE_URL", "").strip()
    runtime_profiles_summary = {
        "selected_profile": selected_profile,
        "ready_profiles": [profile["id"] for profile in runtime_profiles["profiles"] if profile.get("ready")],
        "gguf_downloaded": next(
            (profile.get("artifact_exists") for profile in runtime_profiles["profiles"] if profile["id"] == "gguf-coder"),
            False,
        ),
        "airllm_snapshot_downloaded": next(
            (profile.get("artifact_exists") for profile in runtime_profiles["profiles"] if profile["id"] == "heavy-airllm"),
            False,
        ),
        "self_learner_ready": next(
            (profile.get("ready") for profile in runtime_profiles["profiles"] if profile["id"] == "self-learner-turbo"),
            False,
        ),
    }

    runtime_readiness = runtime.get("readiness") or {}
    sections = {
        "runtime": {
            "configured_backend": runtime.get("configured_backend"),
            "resolved_backend": runtime.get("resolved_backend"),
            "active_backend": runtime.get("active_backend"),
            "loaded": runtime.get("loaded"),
            "readiness": runtime_readiness,
            "profiles": runtime_profiles_summary,
        },
        "database": {
            "remote_configured": bool(turso_url),
            "libsql_available": libsql is not None,
            "mode": "turso-remote" if turso_url and libsql is not None else "local-sqlite",
            "db_path": str(DB_PATH),
        },
        "dataset_sync": {
            "configured": hf_status.get("configured"),
            "available": hf_status.get("available"),
            "repo_id": hf_status.get("repo_id") or get_repo_id(),
            "has_token": bool(get_hf_token()),
            "last_validated_at": hf_status.get("last_validated_at"),
            "last_sync_at": hf_status.get("last_sync_at"),
            "last_error": hf_status.get("last_error"),
        },
        "cloudflare": {
            "configured": cloudflare_status.get("configured"),
            "available": cloudflare_status.get("available"),
            "status_message": cloudflare_status.get("status_message"),
            "validation": cloudflare_status.get("validation"),
            "quota": cloudflare_status.get("quota"),
        },
        "google_auth": google_status,
        "image_generation": {
            "hf_token_configured": bool(get_hf_token()),
            "replicate_configured": bool(os.getenv("REPLICATE_API_TOKEN", "").strip()),
            "openai_configured": bool(os.getenv("OPENAI_API_KEY", "").strip()),
        },
    }

    blockers = []

    if not runtime_readiness.get("can_load", False):
        blockers.append(
            {
                "id": "runtime_unavailable",
                "severity": "error",
                "message": runtime_readiness.get("summary") or "No local runtime can load",
            }
        )
    if not sections["database"]["remote_configured"]:
        blockers.append(
            {
                "id": "turso_remote_not_configured",
                "severity": "warning",
                "message": "TURSO_DATABASE_URL is not configured; using local sqlite fallback",
            }
        )
    elif not sections["database"]["libsql_available"]:
        blockers.append(
            {
                "id": "libsql_missing",
                "severity": "error",
                "message": "TURSO_DATABASE_URL is set but libsql is not installed, so remote Turso sync cannot run",
            }
        )
    if not sections["dataset_sync"]["configured"]:
        blockers.append(
            {
                "id": "hf_dataset_sync",
                "severity": "warning",
                "message": "HF dataset sync is not fully configured; set both HF_TOKEN and HF_DATASET_REPO",
            }
        )
    if not sections["cloudflare"]["configured"]:
        blockers.append(
            {
                "id": "cloudflare_credentials",
                "severity": "warning",
                "message": "Cloudflare crawl is not configured; set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN",
            }
        )
    elif not sections["cloudflare"]["available"]:
        blockers.append(
            {
                "id": "cloudflare_unavailable",
                "severity": "warning",
                "message": sections["cloudflare"]["status_message"] or "Cloudflare crawl is unavailable",
            }
        )
    if not sections["google_auth"]["configured"]:
        blockers.append(
            {
                "id": "google_auth",
                "severity": "warning",
                "message": "Google auth is not configured; set GOOGLE_CLIENT_ID",
            }
        )
    if not sections["runtime"]["profiles"]["airllm_snapshot_downloaded"]:
        blockers.append(
            {
                "id": "airllm_snapshot",
                "severity": "info",
                "message": "Heavy AirLLM has no local snapshot yet and will download or stream weights at runtime",
            }
        )
    if not sections["runtime"]["profiles"]["self_learner_ready"]:
        blockers.append(
            {
                "id": "self_learner_checkpoint",
                "severity": "warning",
                "message": "Self-learner turbo is not ready; train the built-in transformer to enable zero-token self-learning mode",
            }
        )

    error_count = sum(1 for item in blockers if item["severity"] == "error")
    warning_count = sum(1 for item in blockers if item["severity"] == "warning")
    overall = "ready" if not blockers else ("degraded" if error_count == 0 else "blocked")

    return {
        "summary": {
            "overall": overall,
            "errors": error_count,
            "warnings": warning_count,
            "infos": sum(1 for item in blockers if item["severity"] == "info"),
            "generated_at": time.time(),
        },
        "sections": sections,
        "blockers": blockers,
    }


def _control_center_payload(app_state) -> dict[str, Any]:
    from api.routes.research import (
        SOURCE_POLICY,
        get_background_research_status,
        get_research_stats_summary,
        list_research_documents,
        list_research_runs,
        summarize_research_documents,
        summarize_research_runs,
    )

    jobs = refresh_job_state(app_state)
    runtime = (
        app_state.chat_runtime.status()
        if app_state.chat_runtime is not None
        else {
            "configured_backend": "unknown",
            "active_backend": "uninitialized",
            "model_id": None,
            "loaded": False,
            "loaded_at": None,
            "last_error": None,
            "config": {},
            "readiness": {},
        }
    )
    selected_profile = app_state.chat_runtime.get_selected_profile() if app_state.chat_runtime is not None else None
    knowledge = (
        app_state.vectordb.get_stats()
        if app_state.vectordb is not None
        else {"total_vectors": 0, "embedding_dim": 0, "index_type": "none"}
    )
    runtime_profiles = runtime_profiles_payload(selected_profile)
    readiness = _readiness_report(app_state)
    self_learner = _self_learner_summary()
    gguf_bootstrap = get_gguf_bootstrap_status()

    return {
        "generated_at": time.time(),
        "uptime_seconds": int(time.time() - app_state.start_time),
        "runtime": runtime,
        "knowledge": knowledge,
        "jobs": jobs,
        "logs": _job_logs_snapshot(jobs),
        "runtime_profiles": runtime_profiles,
        "gguf_bootstrap": gguf_bootstrap,
        "readiness": readiness,
        "hf_sync": hf_sync_status(),
        "datasets": _collect_dataset_payload(),
        "research": get_research_stats_summary(),
        "research_history": {
            "runs": list_research_runs(limit=6),
            "summary": summarize_research_runs(),
        },
        "research_documents": {
            "documents": list_research_documents(limit=6, include_text=False),
            "summary": summarize_research_documents(),
        },
        "research_policy": SOURCE_POLICY.status(),
        "research_autonomy": get_background_research_status(),
        "self_learner": self_learner,
        "system": {
            "logs_dir": str(LOGS_DIR),
            "auto_refresh_seconds": 10,
        },
        "ai_modes": _ai_mode_cards(runtime, runtime_profiles, self_learner, jobs),
    }


class RuntimeProfileSelectionRequest(BaseModel):
    profile_id: str
    eager_load: bool = False


class RuntimeCustomConfigRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    backend: str
    model_id: str
    gguf_model_path: str = ""
    airllm_model_id: str = ""
    airllm_model_path: str = ""
    max_context_tokens: int = 4096
    max_new_tokens: int = 512
    device: str = "cpu"
    allow_remote_code: bool = False
    n_threads: int = 4


class RuntimeProfileValidationRequest(BaseModel):
    profile_id: str
    test_load: bool = False
    refresh_imports: bool = True


class UserBanRequest(BaseModel):
    banned: bool


class ModelToggleRequest(BaseModel):
    enabled: bool


class ServiceToggleRequest(BaseModel):
    enabled: bool


@router.get("/runtime-status")
async def get_runtime_status():
    """Public runtime status for the chat and admin UI."""
    from api.route import get_app_state
    from api.routes.research import get_research_stats_summary

    app_state = get_app_state()
    jobs = refresh_job_state(app_state)
    runtime = (
        app_state.chat_runtime.status()
        if app_state.chat_runtime is not None
        else {
            "configured_backend": "unknown",
            "active_backend": "uninitialized",
            "model_id": None,
            "loaded": False,
            "loaded_at": None,
            "last_error": None,
            "config": {},
        }
    )
    knowledge = (
        app_state.vectordb.get_stats()
        if app_state.vectordb is not None
        else {"total_vectors": 0, "embedding_dim": 0, "index_type": "none"}
    )

    return {
        "runtime": runtime,
        "knowledge": knowledge,
        "research": get_research_stats_summary(),
        "gguf_bootstrap": get_gguf_bootstrap_status(),
        "uptime_seconds": int(time.time() - app_state.start_time),
        "flags": {
            "is_training": app_state.is_training,
            "generator_running": app_state.generator_running,
            "daemon_running": app_state.daemon_running,
        },
        "jobs": jobs,
    }


@router.get("/control-center")
async def get_control_center(payload: dict = Depends(verify_admin_token)):
    """Aggregate admin dashboard state for the AI control page."""
    from api.route import get_app_state

    app_state = get_app_state()
    return _control_center_payload(app_state)


@router.get("/readiness")
async def get_admin_readiness(payload: dict = Depends(verify_admin_token)):
    from api.route import get_app_state

    app_state = get_app_state()
    return _readiness_report(app_state)


@router.post("/database/validate")
async def validate_database(payload: dict = Depends(verify_admin_token)):
    return validate_database_connection()


@router.get("/runtime-profiles")
async def get_runtime_profiles(payload: dict = Depends(verify_admin_token)):
    from api.route import get_app_state

    app_state = get_app_state()
    selected_profile = None
    if app_state.chat_runtime is not None:
        selected_profile = app_state.chat_runtime.get_selected_profile()
    return runtime_profiles_payload(selected_profile)


@router.post("/runtime-profiles/select")
async def select_runtime_profile(
    request: RuntimeProfileSelectionRequest,
    payload: dict = Depends(verify_admin_token),
):
    from api.route import get_app_state

    app_state = get_app_state()
    profile = _require_runtime_profile(request.profile_id)
    if not get_model_enabled(f"runtime.{profile.id}", True):
        raise HTTPException(status_code=400, detail=f"Runtime profile '{profile.id}' is disabled")
    app_state.chat_runtime.reconfigure(profile.to_runtime_config(), selected_profile=profile.id, persist=True)
    loaded = False
    if request.eager_load:
        loaded = app_state.chat_runtime.ensure_loaded()
    return {
        "status": "updated",
        "selected_profile": profile.id,
        "runtime_loaded": loaded,
        "runtime": app_state.chat_runtime.status(),
    }


@router.post("/runtime/custom")
async def set_custom_runtime_config(
    request: RuntimeCustomConfigRequest,
    payload: dict = Depends(verify_admin_token),
):
    from api.route import get_app_state

    app_state = get_app_state()
    config = RuntimeConfig(
        backend=request.backend,
        model_id=request.model_id,
        gguf_model_path=request.gguf_model_path,
        airllm_model_id=request.airllm_model_id,
        airllm_model_path=request.airllm_model_path,
        max_context_tokens=request.max_context_tokens,
        max_new_tokens=request.max_new_tokens,
        device=request.device,
        allow_remote_code=request.allow_remote_code,
        n_threads=request.n_threads,
    )
    app_state.chat_runtime.reconfigure(config, selected_profile="custom", persist=True)
    return {
        "status": "updated",
        "runtime": app_state.chat_runtime.status(),
    }


@router.post('/cosmo/ingest')
async def cosmo_admin_ingest(payload: dict):
    from services.cosmo_model import cosmo_instance
    dataset_name = payload.get('dataset', 'admin_upload')
    content = payload.get('content', [])
    if isinstance(content, dict): content = [content]
    logger.info(f"Ingesting {len(content)} items into Cosmo dataset: {dataset_name}")
    cosmo_instance.ingest_dataset(dataset_name, content)
    return {
        'status': 'ok',
        'message': f'Ingested {len(content)} items into Cosmo Mythos graph and Vector DB.',
        'version': cosmo_instance.version
    }


@router.post("/runtime/reload")
async def reload_runtime(payload: dict = Depends(verify_admin_token)):
    from api.route import get_app_state

    app_state = get_app_state()
    app_state.chat_runtime.unload()
    loaded = app_state.chat_runtime.ensure_loaded()
    return {
        "status": "reloaded",
        "loaded": loaded,
        "runtime": app_state.chat_runtime.status(),
    }


@router.post("/runtime/unload")
async def unload_runtime(payload: dict = Depends(verify_admin_token)):
    from api.route import get_app_state

    app_state = get_app_state()
    app_state.chat_runtime.unload()
    return {
        "status": "unloaded",
        "runtime": app_state.chat_runtime.status(),
    }


@router.post("/runtime/download/{profile_id}")
async def download_runtime_profile(profile_id: str, payload: dict = Depends(verify_admin_token)):
    if not get_model_enabled(f"runtime.{profile_id}", True):
        raise HTTPException(status_code=400, detail=f"Runtime profile '{profile_id}' is disabled")
    return {
        "status": "queued",
        "job": queue_profile_download(profile_id),
    }


@router.post("/runtime/bootstrap/gguf")
async def bootstrap_gguf_runtime(payload: dict = Depends(verify_admin_token)):
    return {
        "status": "started",
        "bootstrap": start_gguf_runtime_bootstrap(),
    }


@router.post("/runtime/validate")
async def validate_runtime_profile(
    request: RuntimeProfileValidationRequest,
    payload: dict = Depends(verify_admin_token),
):
    from api.route import get_app_state

    app_state = get_app_state()
    runtime_before = app_state.chat_runtime.status() if app_state.chat_runtime is not None else None
    profile = _require_runtime_profile(request.profile_id)
    if not get_model_enabled(f"runtime.{profile.id}", True):
        raise HTTPException(status_code=400, detail=f"Runtime profile '{profile.id}' is disabled")

    validation = validate_profile(
        request.profile_id,
        test_load=request.test_load,
        refresh_imports=request.refresh_imports,
    )
    runtime_after = app_state.chat_runtime.status() if app_state.chat_runtime is not None else None
    return {
        "status": "validated",
        "profile_id": profile.id,
        "current_runtime_unchanged": runtime_before == runtime_after,
        "runtime": runtime_after,
        "validation": validation,
    }


@router.get("/runtime/download-jobs")
async def get_runtime_download_jobs(payload: dict = Depends(verify_admin_token)):
    from api.route import get_app_state

    app_state = get_app_state()
    selected_profile = None
    if app_state.chat_runtime is not None:
        selected_profile = app_state.chat_runtime.get_selected_profile()
    return runtime_profiles_payload(selected_profile)


@router.get("/runtime/bootstrap-status")
async def get_runtime_bootstrap_status(payload: dict = Depends(verify_admin_token)):
    return get_gguf_bootstrap_status()


# ============================================================================
# USERS MANAGEMENT
# ============================================================================

@router.get("/users")
async def get_users(
    payload: dict = Depends(verify_admin_token),
    page: int = 1,
    limit: int = 20,
    search: str = ""
):
    """Get paginated list of users"""
    db_client = get_db_client()
    if not db_client:
        return {"success": False, "error": "Database not available"}
    
    try:
        offset = (page - 1) * limit
        query = db_client.table("profiles").select("*", count="exact")
        
        if search:
            query = query.or_(f"email.ilike.%{search}%,display_name.ilike.%{search}%")
        
        result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        
        return {
            "success": True,
            "users": [_sanitize_profile(user) for user in result.data],
            "total": result.count,
            "page": page,
            "limit": limit
        }
    except Exception as e:
        logger.error(f"Failed to fetch users: {e}")
        return {"success": False, "error": str(e)}


@router.post("/users/{user_id}/ban")
async def ban_user(
    user_id: str,
    request: Optional[UserBanRequest] = Body(default=None),
    banned: Optional[bool] = None,
    payload: dict = Depends(verify_admin_token)
):
    """Ban or unban a user"""
    db_client = get_db_client()
    if not db_client:
        return {"success": False, "error": "Database not available"}

    target_state = request.banned if request is not None else banned
    if target_state is None:
        raise HTTPException(status_code=400, detail="'banned' must be provided")

    try:
        db_client.table("profiles").update({
            "banned": target_state
        }).eq("id", user_id).execute()

        return {"success": True, "message": f"User {'banned' if target_state else 'unbanned'}", "banned": target_state}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# MODELS MANAGEMENT
# ============================================================================

@router.get("/models")
async def get_models(payload: dict = Depends(verify_admin_token)):
    """Get all models with stats"""
    from api.route import get_app_state
    from api.routes.analytics import analytics as request_analytics
    from api.routes.image import IMAGE_MODEL_CATALOG, _active_image_model
    from services.smart_mode_service import SmartModeService

    app_state = get_app_state()
    selected_profile = app_state.chat_runtime.get_selected_profile() if app_state.chat_runtime else None
    profile_payload = runtime_profiles_payload(selected_profile)
    smart_service = SmartModeService(
        gemini_key=os.getenv("GEMINI_API_KEY"),
        hf_key=os.getenv("HF_TOKEN"),
    )
    smart_status = await smart_service.get_model_status()
    request_stats = request_analytics.get_stats()
    today_stats = request_stats.get("today", {})
    models = []

    for profile in profile_payload["profiles"]:
        backend_key = profile["backend"]
        models.append(
            {
                "id": f"runtime.{profile['id']}",
                "name": profile["name"],
                "type": "llm",
                "category": "runtime",
                "enabled": bool(profile.get("enabled", True)),
                "selected": profile["id"] == selected_profile,
                "ready": bool(profile.get("ready")),
                "status_message": profile.get("status_message"),
                "backend": backend_key,
                "performance": {
                    "avg_response_time_ms": None,
                    "requests_today": today_stats.get("chat_requests", 0),
                },
            }
        )

    active_image_model = _active_image_model()
    for model in IMAGE_MODEL_CATALOG:
        enabled = get_model_enabled(f"image.{model['id']}", True)
        models.append(
            {
                "id": f"image.{model['id']}",
                "name": model["name"],
                "type": "image",
                "category": "image",
                "enabled": enabled,
                "selected": model["id"] == active_image_model,
                "ready": enabled,
                "status_message": model.get("description"),
                "backend": model.get("provider", "hf_api"),
                "performance": {
                    "avg_response_time_ms": None,
                    "requests_today": today_stats.get("image_requests", 0),
                },
            }
        )

    for provider, available in smart_status.items():
        models.append(
            {
                "id": f"smart.{provider}",
                "name": f"Smart Mode {provider.title()}",
                "type": "provider",
                "category": "smart",
                "enabled": get_model_enabled(f"smart.{provider}", True),
                "selected": False,
                "ready": bool(available),
                "status_message": "Available" if available else "Unavailable",
                "backend": provider,
                "performance": {
                    "avg_response_time_ms": None,
                    "requests_today": 0,
                },
            }
        )

    return {"success": True, "models": models}


@router.post("/models/{model_id}/toggle")
async def toggle_model(
    model_id: str,
    request: Optional[ModelToggleRequest] = Body(default=None),
    enabled: Optional[bool] = None,
    payload: dict = Depends(verify_admin_token)
):
    """Enable or disable a model"""
    from api.route import get_app_state
    from api.routes.image import IMAGE_MODEL_IDS

    target_enabled = request.enabled if request is not None else enabled
    if target_enabled is None:
        raise HTTPException(status_code=400, detail="'enabled' must be provided")

    parts = model_id.split(".", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Model id must be scoped, for example 'runtime.fast-coder'")

    scope, raw_id = parts
    app_state = get_app_state()

    if scope == "runtime":
        if raw_id not in get_profiles():
            raise HTTPException(status_code=404, detail=f"Unknown runtime profile '{raw_id}'")
        if not target_enabled and app_state.chat_runtime and app_state.chat_runtime.get_selected_profile() == raw_id:
            raise HTTPException(status_code=400, detail="Cannot disable the active runtime profile")
    elif scope == "image":
        if raw_id not in IMAGE_MODEL_IDS:
            raise HTTPException(status_code=404, detail=f"Unknown image model '{raw_id}'")
    elif scope == "smart":
        if raw_id not in SMART_PROVIDER_IDS:
            raise HTTPException(status_code=404, detail=f"Unknown smart provider '{raw_id}'")
    else:
        raise HTTPException(status_code=404, detail=f"Unknown model scope '{scope}'")

    set_model_enabled(model_id, target_enabled)
    return {
        "success": True,
        "message": f"Model '{model_id}' {'enabled' if target_enabled else 'disabled'}",
        "model_id": model_id,
        "enabled": target_enabled,
    }


@router.post("/services/{service_name}/toggle")
async def toggle_service(
    service_name: str,
    request: ServiceToggleRequest,
    payload: dict = Depends(verify_admin_token),
):
    """Persist lightweight service toggles for the mobile admin UI."""
    normalized = str(service_name or "").strip().lower()
    allowed = {"horde", "huggingface", "faceswap", "tts", "vision"}
    if normalized not in allowed:
        raise HTTPException(status_code=404, detail=f"Unknown service '{normalized}'")

    state_key = f"service.{normalized}"
    set_model_enabled(state_key, request.enabled)
    return {
        "success": True,
        "service": normalized,
        "enabled": request.enabled,
        "message": f"Service '{normalized}' {'enabled' if request.enabled else 'disabled'}",
    }


# ============================================================================
# VISION & DATA UPLOAD
# ============================================================================

@router.post("/vision/upload")
async def upload_vision_sample(
    file: UploadFile = File(...),
    text: str = "",
    payload: dict = Depends(verify_admin_token)
):
    """Directly upload an image to the vision learning feed"""
    from api.routes.feed import store_vision_data
    
    try:
        content = await file.read()
        image = Image.open(BytesIO(content))
        
        # Determine text representation if missing
        final_text = text.strip() or f"High-quality {image.format} capture ({image.width}x{image.height})"
        
        # Placeholder embedding logic (will be replaced by model generation if trained)
        # For now, we store with the raw bytes and allow the collector to encode
        stored = store_vision_data(
            embedding=[0.0] * 512, # Placeholder, encoded on next reinforcement
            text_representation=final_text,
            source="admin-upload",
            preview_bytes=content,
            metadata={
                "filename": file.filename,
                "width": image.width,
                "height": image.height,
                "format": image.format,
                "manual_upload": True
            }
        )
        
        return {
            "success": True,
            "message": "Image uploaded to vision feed",
            "entry": stored["entry"]
        }
    except Exception as e:
        logger.error(f"Vision upload failed: {e}")
        return {"success": False, "error": str(e)}


# ============================================================================
# ANALYTICS
# ============================================================================

@router.get("/analytics")
async def get_analytics(payload: dict = Depends(verify_admin_token)):
    """Get analytics data for charts"""
    from api.routes.analytics import analytics as request_analytics

    db_client = get_db_client()
    request_stats = request_analytics.get_stats()
    daily = request_analytics.get_daily_series(days=7)
    total_users = _count_total_profiles(db_client)

    feature_rows = [
        {"name": "Chat", "usage": daily["totals"]["chat_requests"], "color": "#8b5cf6"},
        {"name": "Image Gen", "usage": daily["totals"]["image_requests"], "color": "#d946ef"},
        {"name": "Knowledge", "usage": daily["totals"]["knowledge_added"], "color": "#10b981"},
        {"name": "Errors", "usage": daily["totals"]["errors"], "color": "#f43f5e"},
    ]

    return {
        "success": True,
        "dau": {
            "labels": daily["labels"],
            "data": daily["dau"],
        },
        "daily_requests": {
            "labels": daily["labels"],
            "data": daily["requests"],
        },
        "api_usage": {
            "labels": [row["name"] for row in feature_rows],
            "data": [row["usage"] for row in feature_rows],
        },
        "features": feature_rows,
        "total_users": total_users,
        "request_totals": request_stats,
    }


@router.get("/stats")
async def get_admin_stats(payload: dict = Depends(verify_admin_token)):
    from api.route import get_app_state
    from api.routes.analytics import analytics as request_analytics

    app_state = get_app_state()
    db_client = get_db_client()
    request_stats = request_analytics.get_stats()
    today_stats = request_stats.get("today", {})

    total_users = _count_total_profiles(db_client)
    active_users_today = int(today_stats.get("unique_clients", 0))
    total_requests_today = int(today_stats.get("requests", 0))
    total_tokens_used_today = 0.0

    if db_client:
        try:
            today_start = time.strftime("%Y-%m-%dT00:00:00")
            result = (
                db_client.table("token_usage")
                .select("tokens_used,created_at")
                .gte("created_at", today_start)
                .execute()
            )
            total_tokens_used_today = round(
                sum(float(row.get("tokens_used") or 0) for row in (result.data or [])),
                2,
            )
        except Exception:
            total_tokens_used_today = 0.0

    runtime_loaded = bool(app_state.chat_runtime and app_state.chat_runtime.is_ready())
    server_health = "healthy" if runtime_loaded else "degraded"

    return {
        "total_users": total_users,
        "active_users_today": active_users_today,
        "total_requests_today": total_requests_today,
        "total_tokens_used_today": total_tokens_used_today,
        "server_health": server_health,
    }


# ============================================================================
# SYSTEM CONTROL & LOGS
# ============================================================================

@router.get("/system/logs")
async def get_system_logs(
    lines: int = 500,
    payload: dict = Depends(verify_admin_token)
):
    """Fetch the latest global app logs"""
    # Look for the main loguru log file
    log_files = sorted(LOGS_DIR.glob("*.log"), key=os.path.getmtime, reverse=True)
    if not log_files:
        return {"success": False, "error": "No log files found"}
    
    latest_log = log_files[0]
    tail = _tail_text_file(latest_log, max_chars=lines * 200) # Approx 200 chars per line
    
    return {
        "success": True,
        "filename": latest_log.name,
        "tail": tail,
        "timestamp": time.time()
    }


@router.post("/system/training/start")
async def start_training(payload: dict = Depends(verify_admin_token), steps: int = 100):
    """Start model training"""
    from api.route import get_app_state

    app_state = get_app_state()
    return start_training_job(app_state, steps)


@router.post("/system/training/stop")
async def stop_training(payload: dict = Depends(verify_admin_token)):
    """Stop model training"""
    from api.route import get_app_state

    app_state = get_app_state()
    return stop_training_job(app_state)

 @ r o u t e r . p o s t ( ' / c o s m o / i n g e s t ' ) 
 a s y n c   d e f   c o s m o _ a d m i n _ i n g e s t ( p a y l o a d :   d i c t ) : 
         f r o m   s e r v i c e s . c o s m o _ m o d e l   i m p o r t   c o s m o _ i n s t a n c e 
         d a t a s e t _ n a m e   =   p a y l o a d . g e t ( ' d a t a s e t ' ,   ' a d m i n _ u p l o a d ' ) 
         c o n t e n t   =   p a y l o a d . g e t ( ' c o n t e n t ' ,   [ ] ) 
         i f   i s i n s t a n c e ( c o n t e n t ,   d i c t ) :   c o n t e n t   =   [ c o n t e n t ] 
         c o s m o _ i n s t a n c e . i n g e s t _ d a t a s e t ( d a t a s e t _ n a m e ,   c o n t e n t ) 
         r e t u r n   { ' s t a t u s ' :   ' o k ' ,   ' m e s s a g e ' :   f ' I n g e s t e d   { l e n ( c o n t e n t ) }   i n t o   C o s m o   M y t h o s   g r a p h . ' } 
  
 