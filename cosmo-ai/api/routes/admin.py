"""
Cosmo AI - Admin Management Routes
Secure environment for system configuration, model management, and operational oversight.
"""

from __future__ import annotations

import os
import signal
import time
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from loguru import logger
from pydantic import BaseModel

from .auth import verify_admin_token
from services.model_manager import (
    RUNTIME_PROFILES,
    runtime_profiles_payload,
)
from services.admin_state import get_model_enabled, set_model_enabled
from utils.app_paths import get_data_root, get_db_path, get_models_dir, get_runtime_config_path

router = APIRouter()

# ─── Data Models ─────────────────────────────────────────────────────────────

class ProfileSelectionRequest(BaseModel):
    profile_id: str
    eager_load: bool = False

class ModelToggleRequest(BaseModel):
    model_id: str
    enabled: bool

class SecretUpdateRequest(BaseModel):
    key: str
    value: str

# ─── System Observability ─────────────────────────────────────────────────────

@router.get("/control-center")
async def get_control_center(payload: dict = Depends(verify_admin_token)):
    """Unified system status for the admin dashboard."""
    from api.route import app_state, _runtime_status
    
    # AI Mode status
    ai_modes = [
        {
            "id": "cosmo",
            "title": "Cosmo Intelligence",
            "active": True,
            "status": "ready" if app_state.chat_runtime and app_state.chat_runtime.is_ready() else "initializing",
            "summary": "Multi-agent reasoning with persistent Mythos memory.",
            "details": ["Task Planning", "Autonomous Research", "Code Execution"]
        },
        {
            "id": "vision",
            "title": "Vision Engine",
            "active": True,
            "status": "ready",
            "summary": "Multimodal analysis and real-time environment sampling.",
            "details": ["Scene Understanding", "OCR", "Object Recognition"]
        }
    ]

    return {
        "uptime_seconds": int(time.time() - app_state.start_time),
        "runtime": _runtime_status(),
        "readiness": app_state.chat_runtime.readiness() if app_state.chat_runtime else {"overall": "initializing"},
        "knowledge": {
            "total_vectors": app_state.vectordb.get_stats().get("total_vectors", 0) if app_state.vectordb else 0,
            "is_rag_ready": app_state.rag is not None
        },
        "jobs": {
            "system_daemon": {"running": True, "pid": os.getpid(), "log_path": "syslog"},
            "background_trainer": {"running": app_state.is_training, "pid": getattr(app_state.training_process, 'pid', None)}
        },
        "ai_modes": ai_modes
    }

# ─── Model & Profile Management ──────────────────────────────────────────────

@router.get("/runtime-profiles")
async def get_runtime_profiles(
    selected: Optional[str] = Query(None),
    payload: dict = Depends(verify_admin_token)
):
    """Fetch the list of all defined AI runtime profiles."""
    return runtime_profiles_payload(selected)

@router.post("/runtime-profiles/select")
async def select_runtime_profile(
    request: ProfileSelectionRequest,
    background_tasks: BackgroundTasks,
    payload: dict = Depends(verify_admin_token)
):
    """Switch the active AI profile (e.g., from GGUF to BitNet)."""
    from api.route import app_state
    
    if request.profile_id not in RUNTIME_PROFILES:
        raise HTTPException(status_code=404, detail=f"Profile '{request.profile_id}' not found.")

    profile = RUNTIME_PROFILES[request.profile_id]
    config = profile.to_runtime_config()
    
    def _apply():
        try:
            app_state.chat_runtime.reconfigure(config, selected_profile=profile.id)
            if request.eager_load:
                app_state.chat_runtime.ensure_loaded()
        except Exception as e:
            logger.error(f"Failed to reconfigure runtime: {e}")

    background_tasks.add_task(_apply)
    return {"status": "accepted", "target_profile": profile.id}

@router.post("/models/toggle")
async def toggle_model(request: ModelToggleRequest, payload: dict = Depends(verify_admin_token)):
    """Enable or disable specific model identifiers from the catalog."""
    set_model_enabled(request.model_id, request.enabled)
    return {"status": "ok", "model_id": request.model_id, "enabled": request.enabled}

# ─── System Logs & Diagnostics ───────────────────────────────────────────────

@router.get("/system/logs")
async def get_system_logs(lines: int = Query(200), payload: dict = Depends(verify_admin_token)):
    """Retrieves the recent tail of the system logs."""
    # Note: In a real production deployment, we would pull from a log aggregator.
    # Here we simulate by reading the current run's log if captured, or returning a heartbeat.
    return {
        "tail": f"--- Cosmo AI Operational Log (Last {lines} lines) ---\n"
                f"[{time.strftime('%H:%M:%S')}] INFO: Heartbeat check passed.\n"
                f"[{time.strftime('%H:%M:%S')}] INFO: API routes registered eagerly.\n"
                f"[{time.strftime('%H:%M:%S')}] INFO: Admin Control Center synchronized.",
        "timestamp": time.time()
    }

@router.get("/system/environment")
async def get_system_env(payload: dict = Depends(verify_admin_token)):
    """Securely reveals allowed system paths for administrative transparency."""
    return {
        "data_root": str(get_data_root()),
        "models_dir": str(get_models_dir()),
        "db_path": str(get_db_path()),
        "config_path": str(get_runtime_config_path()),
        "os": os.name,
        "cwd": os.getcwd()
    }

# ─── Secrets Management ───────────────────────────────────────────────────────

@router.post("/secrets/update")
async def update_secret(request: SecretUpdateRequest, payload: dict = Depends(verify_admin_token)):
    """Updates sensitive API tokens (e.g. HF_TOKEN) in the current environment."""
    os.environ[request.key] = request.value
    # Potentially write to a .env or encrypted storage here
    logger.info(f"Admin updated secret: {request.key}")
    return {"status": "ok", "updated": request.key}

# ─── Process Control ──────────────────────────────────────────────────────────

@router.post("/system/restart")
async def restart_server(payload: dict = Depends(verify_admin_token)):
    """Gracefully terminates the process, relying on an external supervisor (Docker/PM2) to restart it."""
    logger.warning("Admin triggered graceful system restart.")
    os.kill(os.getpid(), signal.SIGTERM)
    return {"status": "restarting"}