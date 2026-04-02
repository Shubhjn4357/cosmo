"""
Whisper AI - Agent routes.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.agent_profiles import get_agent_profile, list_agent_profiles
from services.agent_runtime import (
    SUPPORTED_AGENT_BACKENDS,
    AgentRunRequestPayload,
    cancel_agent_session,
    get_agent_session,
    list_agent_sessions,
    run_agent,
)


router = APIRouter()


class AgentRunRequest(BaseModel):
    message: str
    history: Optional[list[dict[str, str]]] = None
    session_id: Optional[str] = None
    context: Optional[str] = None
    system_prompt: Optional[str] = None
    use_rag: bool = True
    roleplay_mode: bool = False
    nsfw_mode: bool = False
    backend: str = "server"
    allow_research: bool = True
    allow_images: bool = True
    max_steps: int = 4
    max_tokens: int = 320
    user_id: Optional[str] = None
    profile_id: Optional[str] = None
    wait_for_completion: bool = False


@router.post("/agent/run")
async def run_agent_route(request: AgentRunRequest):
    from api.route import get_app_state

    backend = request.backend.lower().strip()
    if backend not in SUPPORTED_AGENT_BACKENDS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported backend '{request.backend}'. Available: {sorted(SUPPORTED_AGENT_BACKENDS)}",
        )
    if request.profile_id and get_agent_profile(request.profile_id) is None:
        raise HTTPException(status_code=400, detail=f"Unknown profile_id '{request.profile_id}'")

    payload = AgentRunRequestPayload(
        message=request.message,
        history=request.history or [],
        session_id=request.session_id,
        context=request.context or "",
        system_prompt=request.system_prompt,
        use_rag=request.use_rag,
        roleplay_mode=request.roleplay_mode,
        nsfw_mode=request.nsfw_mode,
        backend=backend,
        allow_research=request.allow_research,
        allow_images=request.allow_images,
        max_steps=max(1, min(request.max_steps, 6)),
        max_tokens=max(64, min(request.max_tokens, 512)),
        user_id=request.user_id,
        profile_id=request.profile_id,
    )

    session = await run_agent(
        payload,
        get_app_state(),
        wait_for_completion=request.wait_for_completion,
    )
    return {
        "session_id": session["id"],
        "status": session.get("status"),
        "backend": session.get("backend_resolved"),
        "profile_id": session.get("profile_id"),
        "goal": session.get("goal"),
        "answer": session.get("answer", ""),
        "image_url": session.get("image_url"),
        "plan": session.get("plan", []),
        "tool_results": session.get("tool_results", []),
        "citations": session.get("citations", []),
        "updated_at": session.get("updated_at"),
    }


@router.get("/agent/profiles")
async def list_agent_profiles_route():
    return {"profiles": list_agent_profiles()}


@router.get("/agent/sessions")
async def list_agent_sessions_route(limit: int = 20):
    return {"sessions": list_agent_sessions(limit=max(1, min(limit, 100)))}


@router.get("/agent/sessions/{session_id}")
async def get_agent_session_route(session_id: str):
    session = get_agent_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent session '{session_id}'")
    return session


@router.post("/agent/sessions/{session_id}/cancel")
async def cancel_agent_session_route(session_id: str):
    session = await cancel_agent_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent session '{session_id}'")
    return session
