"""
Whisper AI - Admin Dashboard API Routes.
"""

import json
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Any, List, Optional
import os
from loguru import logger

from .auth import verify_admin_token
from services.google_auth import google_auth_status
from .profile import _sanitize_profile, get_supabase
from api.routes.payment import get_active_plans, payment_gateway_status, validate_payment_gateway
from services.gguf_bootstrap import get_gguf_bootstrap_status, start_gguf_runtime_bootstrap
from services.admin_state import get_model_enabled, set_model_enabled, upsert_payment_plan
from services.model_manager import get_profile, get_profiles, queue_profile_download, runtime_profiles_payload, validate_profile
from services.runtime_manager import RuntimeConfig
from services.system_jobs import LOGS_DIR, refresh_job_state, start_training_job, stop_training_job
from services.hf_dataset_sync import status as hf_sync_status, get_hf_token, get_repo_id
from services.cloudflare_crawl import CRAWLER
from services.turso_db import DB_PATH, libsql, validate_database_connection


blocked_ips_storage = []
router = APIRouter()

SMART_PROVIDER_IDS = {"gemini", "huggingface", "horde", "local"}


def _plan_features(plan_id: str, plan: dict) -> list[str]:
    if isinstance(plan.get("features"), list):
        return plan["features"]
    if plan.get("type") == "subscription":
        return [f"{plan.get('tokens', 0)} tokens per cycle", "Premium features"]
    return [f"{plan.get('tokens', 0)} token add-on"]


def _count_profiles_by_tier(supabase) -> dict[str, int]:
    counts = {"free": 0, "pro": 0}
    if not supabase:
        return counts

    for tier in counts:
        try:
            result = (
                supabase.table("profiles")
                .select("id", count="exact")
                .eq("subscription_tier", tier)
                .execute()
            )
            counts[tier] = result.count or 0
        except Exception:
            counts[tier] = 0
    return counts


def _estimate_revenue_paise(supabase) -> int:
    if not supabase:
        return 0

    total = 0
    for table in ("subscriptions", "token_purchases"):
        try:
            result = supabase.table(table).select("amount").execute()
            total += sum(int(row.get("amount") or 0) for row in (result.data or []))
        except Exception:
            continue
    return total


def _format_currency_from_paise(amount_paise: int, currency: str = "INR") -> str:
    symbol = "₹" if currency.upper() == "INR" else currency.upper()
    return f"{symbol}{amount_paise / 100:.2f}"


def _safe_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _tail_text_file(path: Path, max_chars: int = 1600) -> str:
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore").strip()
    except Exception:
        return ""
    return text[-max_chars:] if len(text) > max_chars else text


def _collect_dataset_payload() -> dict[str, Any]:
    from api.routes.datasets import DATASETS_DIR, MANAGED_DATASETS, _dataset_info

    datasets: list[dict[str, Any]] = []
    seen: set[str] = set()

    for path in MANAGED_DATASETS:
        if path.exists() and path.name not in seen:
            datasets.append(_dataset_info(path))
            seen.add(path.name)

    for path in sorted(DATASETS_DIR.glob("*")):
        if path.is_file() and path.name not in seen:
            datasets.append(_dataset_info(path))
            seen.add(path.name)

    return {
        "datasets": datasets,
        "count": len(datasets),
        "dataset_dir": str(DATASETS_DIR),
    }


def _self_learner_summary() -> dict[str, Any]:
    from services.runtime_manager import (
        SELF_LEARNER_CHECKPOINT,
        SELF_LEARNER_INT8_CHECKPOINT,
        SELF_LEARNER_STATE,
        SELF_LEARNER_TOKENIZER,
        get_self_learner_runtime_manager,
    )

    runtime = get_self_learner_runtime_manager()
    readiness = runtime.readiness()
    training_state = _safe_json_file(SELF_LEARNER_STATE)
    min_steps = max(1, int(os.getenv("WHISPER_SELF_LEARNER_MIN_STEPS", "50")))
    min_sequences = max(1, int(os.getenv("WHISPER_SELF_LEARNER_MIN_SEQUENCES", "20")))
    steps = int(training_state.get("steps") or 0)
    sequences = int(training_state.get("dataset_sequences") or 0)
    chat_ready = readiness.get("can_load", False) and steps >= min_steps and sequences >= min_sequences

    return {
        "ready": readiness.get("can_load", False),
        "chat_ready": chat_ready,
        "summary": readiness.get("summary"),
        "training_state": training_state,
        "thresholds": {
            "min_steps": min_steps,
            "min_sequences": min_sequences,
            "step_progress": min(1.0, steps / min_steps),
            "sequence_progress": min(1.0, sequences / min_sequences),
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
            ("horde", bool(os.getenv("AI_HORDE_API_KEY", "").strip())),
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
    payment_status = payment_gateway_status()

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
        "payments": payment_status,
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
    if not sections["payments"]["configured"]:
        blockers.append(
            {
                "id": "payments",
                "severity": "warning",
                "message": "Payment gateway is not configured; set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET",
            }
        )
    elif sections["payments"].get("last_valid") is False:
        blockers.append(
            {
                "id": "payments_invalid",
                "severity": "warning",
                "message": sections["payments"].get("last_message") or "Payment gateway validation failed",
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
        RESEARCH_STATS,
        SOURCE_POLICY,
        list_research_documents,
        list_research_runs,
        summarize_research_documents,
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
        "research": dict(RESEARCH_STATS),
        "research_history": {
            "runs": list_research_runs(limit=6),
        },
        "research_documents": {
            "documents": list_research_documents(limit=6, include_text=False),
            "summary": summarize_research_documents(),
        },
        "research_policy": SOURCE_POLICY.status(),
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


class SubscriptionPlanRequest(BaseModel):
    plan_id: Optional[str] = None
    name: str = ""
    price: float = 0
    currency: str = "INR"
    features: List[str] = []
    tokens: int = 0
    plan_type: str = "subscription"
    active: bool = True


@router.get("/runtime-status")
async def get_runtime_status():
    """Public runtime status for the chat and admin UI."""
    from api.route import get_app_state
    from api.routes.research import RESEARCH_STATS

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
        "research": dict(RESEARCH_STATS),
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


@router.post("/payments/validate")
async def validate_payments(payload: dict = Depends(verify_admin_token)):
    return await validate_payment_gateway()


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
    profile = get_profile(request.profile_id)
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
    profile = get_profile(request.profile_id)
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
    supabase = get_supabase()
    if not supabase:
        return {"success": False, "error": "Database not available"}
    
    try:
        offset = (page - 1) * limit
        query = supabase.table("profiles").select("*", count="exact")
        
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


@router.put("/users/{user_id}/subscription")
async def update_user_subscription(
    user_id: str,
    tier: str,
    payload: dict = Depends(verify_admin_token)
):
    """Update user subscription tier"""
    supabase = get_supabase()
    if not supabase:
        return {"success": False, "error": "Database not available"}
    
    try:
        tokens_limit = 1000 if tier == "pro" else 20
        
        supabase.table("profiles").update({
            "subscription_tier": tier,
            "tokens_limit": tokens_limit
        }).eq("id", user_id).execute()
        
        return {"success": True, "message": f"User upgraded to {tier}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/users/{user_id}/ban")
async def ban_user(
    user_id: str,
    banned: bool,
    payload: dict = Depends(verify_admin_token)
):
    """Ban or unban a user"""
    supabase = get_supabase()
    if not supabase:
        return {"success": False, "error": "Database not available"}
    
    try:
        supabase.table("profiles").update({
            "banned": banned
        }).eq("id", user_id).execute()
        
        return {"success": True, "message": f"User {'banned' if banned else 'unbanned'}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# SUBSCRIPTIONS MANAGEMENT
# ============================================================================

@router.get("/subscriptions")
async def get_subscriptions(payload: dict = Depends(verify_admin_token)):
    """Get all subscription plans"""
    supabase = get_supabase()
    tier_counts = _count_profiles_by_tier(supabase)
    plans = []

    for plan_id, plan in get_active_plans().items():
        currency = plan.get("currency", "INR")
        subscriber_count = tier_counts.get("pro", 0) if plan.get("type") == "subscription" else 0
        plans.append(
            {
                "id": plan_id,
                "name": plan.get("name", plan_id),
                "price": round((plan.get("amount", 0) or 0) / 100, 2),
                "currency": currency,
                "tokens": plan.get("tokens", 0),
                "type": plan.get("type", "subscription"),
                "features": _plan_features(plan_id, plan),
                "active": bool(plan.get("active", True)),
                "subscriber_count": subscriber_count,
            }
        )

    return {"success": True, "plans": plans}


@router.post("/subscriptions/create")
async def create_subscription(
    request: SubscriptionPlanRequest,
    payload: dict = Depends(verify_admin_token),
):
    """Create new subscription plan"""
    raw_name = (request.name or "").strip()
    if not raw_name:
        raise HTTPException(status_code=400, detail="Plan name is required")

    plan_id = request.plan_id or raw_name.lower().replace(" ", "_")
    plan = {
        "name": raw_name,
        "amount": max(0, int(round(request.price * 100))),
        "currency": request.currency or "INR",
        "tokens": max(0, request.tokens),
        "type": request.plan_type or "subscription",
        "features": request.features,
        "active": request.active,
    }
    upsert_payment_plan(plan_id, plan, get_active_plans())
    return {
        "success": True,
        "message": f"Plan '{plan_id}' created successfully",
        "plan_id": plan_id,
        "plan": plan,
    }


@router.post("/subscriptions/{plan_id}/update")
async def update_subscription(
    plan_id: str,
    request: SubscriptionPlanRequest,
    payload: dict = Depends(verify_admin_token),
):
    """Update subscription plan"""
    plans = get_active_plans()
    if plan_id not in plans:
        raise HTTPException(status_code=404, detail=f"Unknown plan '{plan_id}'")

    updates = {}
    if request.name:
        updates["name"] = request.name
    if request.price is not None:
        updates["amount"] = max(0, int(round(request.price * 100)))
    if request.currency:
        updates["currency"] = request.currency
    if request.features:
        updates["features"] = request.features
    if request.tokens:
        updates["tokens"] = max(0, request.tokens)
    if request.plan_type:
        updates["type"] = request.plan_type
    updates["active"] = request.active

    merged = upsert_payment_plan(plan_id, updates, plans)[plan_id]
    return {
        "success": True,
        "message": f"Plan '{plan_id}' updated successfully",
        "plan": merged,
    }


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
        horde_key=os.getenv("HORDE_API_KEY"),
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
    enabled: bool,
    payload: dict = Depends(verify_admin_token)
):
    """Enable or disable a model"""
    from api.route import get_app_state
    from api.routes.image import IMAGE_MODEL_IDS

    parts = model_id.split(".", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Model id must be scoped, for example 'runtime.fast-coder'")

    scope, raw_id = parts
    app_state = get_app_state()

    if scope == "runtime":
        if raw_id not in get_profiles():
            raise HTTPException(status_code=404, detail=f"Unknown runtime profile '{raw_id}'")
        if not enabled and app_state.chat_runtime and app_state.chat_runtime.get_selected_profile() == raw_id:
            raise HTTPException(status_code=400, detail="Cannot disable the active runtime profile")
    elif scope == "image":
        if raw_id not in IMAGE_MODEL_IDS:
            raise HTTPException(status_code=404, detail=f"Unknown image model '{raw_id}'")
    elif scope == "smart":
        if raw_id not in SMART_PROVIDER_IDS:
            raise HTTPException(status_code=404, detail=f"Unknown smart provider '{raw_id}'")
    else:
        raise HTTPException(status_code=404, detail=f"Unknown model scope '{scope}'")

    set_model_enabled(model_id, enabled)
    return {
        "success": True,
        "message": f"Model '{model_id}' {'enabled' if enabled else 'disabled'}",
        "model_id": model_id,
        "enabled": enabled,
    }


# ============================================================================
# ANALYTICS
# ============================================================================

@router.get("/analytics")
async def get_analytics(payload: dict = Depends(verify_admin_token)):
    """Get analytics data for charts"""
    from api.routes.analytics import analytics as request_analytics

    supabase = get_supabase()
    request_stats = request_analytics.get_stats()
    daily = request_analytics.get_daily_series(days=7)
    tier_counts = _count_profiles_by_tier(supabase)
    total_users = sum(tier_counts.values())
    revenue_paise = _estimate_revenue_paise(supabase)

    feature_rows = [
        {"name": "Chat", "usage": daily["totals"]["chat_requests"], "color": "#6366f1"},
        {"name": "Image Gen", "usage": daily["totals"]["image_requests"], "color": "#8b5cf6"},
        {"name": "Knowledge", "usage": daily["totals"]["knowledge_added"], "color": "#10b981"},
        {"name": "Errors", "usage": daily["totals"]["errors"], "color": "#ef4444"},
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
        "revenue": _format_currency_from_paise(revenue_paise),
        "request_totals": request_stats,
        "subscription_counts": tier_counts,
    }


# ============================================================================
# SYSTEM CONTROL
# ============================================================================

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
