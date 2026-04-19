"""
Cosmo Business Agent API Routes
===============================
Endpoints for Voice-to-Goal, Handoff, and Mission Management.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from loguru import logger
import time

router = APIRouter()

# ─── Request Models ─────────────────────────────────────────────────────────

class LaunchSessionRequest(BaseModel):
    goal: str
    company_context: Optional[str] = ""

class VoiceIntakeRequest(BaseModel):
    raw_text: str

class HandoffRequest(BaseModel):
    message: str
    user_id: str

class VoteRequest(BaseModel):
    user_id: str
    msg_id: str
    agree: bool

# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.post("/cosmo/business/voice-intake")
async def voice_to_goal(request: VoiceIntakeRequest) -> Dict[str, str]:
    """Analyzes raw voice text and returns a structured Goal/Context proposal."""
    from services.cosmo_business import get_business_engine
    engine = get_business_engine()
    return await engine.pre_flight.analyze(request.raw_text)

@router.post("/cosmo/business/launch")
async def launch_business_session(request: LaunchSessionRequest) -> Dict[str, str]:
    from services.cosmo_business import launch_session
    session = await launch_session(goal=request.goal, company_context=request.company_context)  # type: ignore
    return {"session_id": session.id, "status": "running"}

@router.get("/cosmo/business/sessions/diagnostics")
async def get_business_diagnostics() -> Dict[str, Any]:
    """Returns environmental health for the business agent."""
    from services.cosmo_business import get_business_engine
    engine = get_business_engine()
    return await engine.run_hardware_diagnostics()  # type: ignore

@router.get("/cosmo/business/sessions/{session_id}")
async def get_business_session(session_id: str) -> Dict[str, Any]:
    if session_id == "diagnostics":
        return await get_business_diagnostics()
    from services.cosmo_business import load_session, is_session_running
    data = load_session(session_id)
    if not data: raise HTTPException(status_code=404, detail="Session not found")
    data["is_running"] = is_session_running(session_id)
    return data

@router.post("/cosmo/business/sessions/{session_id}/handoff")
async def start_handoff(session_id: str, request: HandoffRequest):
    """Signals the engine to pause for user input and appends the user's message."""
    from services.cosmo_business import load_session, _save_session, BusinessSession, BusinessTask
    data = load_session(session_id)
    if not data: raise HTTPException(status_code=404, detail="Session not found")
    
    # Reconstruct session object (partial)
    session = BusinessSession(id=session_id, goal=data['goal'], company_context=data['company_context'])  # type: ignore
    session.is_handoff_active = True
    session.messages = data.get("messages", [])  # type: ignore
    session.messages.append({  # type: ignore
        "role": "user", 
        "text": request.message, 
        "ts": time.time(),
        "user_id": request.user_id # v1.4 Tracking
    })
    
    # Simple bot response for handoff context
    session.messages.append({  # type: ignore
        "role": "bot", 
        "text": "Discussion joined. Execution paused. I'm listening to your steering instructions.", 
        "ts": time.time()
    })
    
    _save_session(session)

    # Multi-user Scaling: Broadcast the handoff message to all WebSocket clients
    try:
        from api.route import get_app_state
        app_state = get_app_state()
        await app_state.ws_manager.broadcast(session_id, {
            "type": "handoff_message",
            "messages": session.messages
        })
    except Exception as e:
        logger.debug(f"Broadcast failed: {e}")

    return {"status": "handoff_active", "messages": session.messages}

@router.post("/cosmo/business/sessions/{session_id}/resume")
async def resume_session(session_id: str):
    """Resumes the autonomous mission loop."""
    from services.cosmo_business import load_session, _save_session, BusinessSession
    data = load_session(session_id)
    if not data: raise HTTPException(status_code=404, detail="Session not found")
    
    session = BusinessSession(id=session_id)
    session.is_handoff_active = False
    _save_session(session)

    # Broadcast resume event
    try:
        from api.route import get_app_state
        app_state = get_app_state()
        await app_state.ws_manager.broadcast(session_id, {
            "type": "mission_resumed",
            "status": "running"
        })
    except Exception as e:
        logger.debug(f"Broadcast failed: {e}")

    return {"status": "resuming"}

@router.post("/cosmo/business/sessions/{session_id}/vote")
async def cast_vote(session_id: str, request: VoteRequest):
    """Casts a vote for a specific steering instruction."""
    from services.cosmo_business import load_session, _save_session, BusinessSession
    data = load_session(session_id)
    if not data: raise HTTPException(status_code=404, detail="Session not found")
    
    # Replay session with full meta-state
    session = BusinessSession(
        id=session_id, 
        goal=data.get('goal', ''),   # type: ignore
        company_context=data.get('company_context', '')  # type: ignore
    )
    session.consensus_votes = data.get("consensus_votes", {})  # type: ignore
    session.multi_user_mode = data.get("multi_user_mode", True)  # type: ignore
    session.is_handoff_active = data.get("is_handoff_active", True)  # type: ignore
    session.messages = data.get("messages", [])  # type: ignore
    session.tasks = [
        BusinessTask(  # type: ignore
            id=t.get('id', ''),  # type: ignore
            title=t.get('title', ''),  # type: ignore
            description=t.get('description', ''),  # type: ignore
            assigned_to=EmployeeRole(t.get('assigned_to', 'analyst')),  # type: ignore
            status=TaskStatus(t.get('status', 'pending'))  # type: ignore
        ) for t in data.get("tasks", [])  # type: ignore
    ]
    
    session.register_vote(request.msg_id, request.user_id, request.agree)
    _save_session(session)
    
    return {"status": "vote_recorded", "consensus": session.evaluate_consensus(request.msg_id)}

@router.post("/cosmo/business/distill")
async def trigger_distillation(steps: int = 150):
    """Manually triggers the distillation of Mythos memory into the core model."""
    from services.distillation_service import distill_memory_to_training
    from api.route import get_app_state
    return distill_memory_to_training(get_app_state(), steps=steps)

@router.post("/cosmo/business/sync-global")
async def trigger_global_sync():
    """Triggers a pull of community lessons from the Global Model Hub."""
    from services.cosmo_model import CosmoModel
    model = CosmoModel.get_instance()
    return model.sync_global_hub()

@router.get("/cosmo/business/sessions")
async def list_business_sessions(limit: int = 20) -> Dict[str, Any]:
    from services.cosmo_business import list_sessions
    return {"sessions": list_sessions(limit)}
