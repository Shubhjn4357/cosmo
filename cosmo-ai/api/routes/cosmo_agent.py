"""
Cosmo Multi-Agent API Routes
Exposes the Planner → Researcher → Executor → Critic pipeline via FastAPI.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field

router = APIRouter()


# ─── Request / Response Models ─────────────────────────────────────────────

class AgentChatRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    message: str
    history: Optional[List[Dict[str, str]]] = None
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    is_local: bool = True


class AgentStepResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    role: str
    content: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AgentChatResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    final_response: str
    plan: List[str]
    research_context: str
    agent_steps: List[AgentStepResponse]
    task_id: str
    model_used: str = "cosmo-agents-1.1"
    backend: str = "multi_agent_pipeline"


# ─── Endpoints ─────────────────────────────────────────────────────────────

@router.post("/cosmo/agent/chat", response_model=AgentChatResponse)
async def cosmo_agent_chat(request: AgentChatRequest) -> AgentChatResponse:
    """
    Full multi-agent chat endpoint.
    Runs the complete Planner → Researcher → Executor → CAI Critic pipeline.
    """
    from services.cosmo_model import cosmo_instance
    from services.cosmo_agents import get_cosmo_orchestrator

    if not request.message.strip():
        raise HTTPException(status_code=400, detail="message is required")

    try:
        orchestrator = get_cosmo_orchestrator(
            rag_system=cosmo_instance.rag,
            personality=cosmo_instance._personality,
        )
        task = await orchestrator.run(request.message, history=request.history)

        steps = [
            AgentStepResponse(
                role=str(m.role.value),
                content=m.content[:800],
                metadata=m.metadata,
            )
            for m in task.messages
        ]

        return AgentChatResponse(
            final_response=task.final_response,
            plan=task.plan,
            research_context=(task.research_context or "")[:500],
            agent_steps=steps,
            task_id=task.id,
        )
    except Exception as e:
        logger.error(f"[AgentAPI] Pipeline error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cosmo/agent/sessions")
async def list_agent_sessions(limit: int = 20) -> Dict[str, Any]:
    """List recent multi-agent session logs."""
    from utils.app_paths import DATA_ROOT
    import json

    log_dir = DATA_ROOT / "runtime" / "agent_sessions"
    if not log_dir.exists():
        return {"sessions": [], "count": 0}

    sessions = []
    files = sorted(log_dir.glob("session_*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
    for f in files[:limit]:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            sessions.append({
                "id": data.get("id"),
                "prompt": (data.get("prompt") or "")[:100],
                "plan_steps": len(data.get("plan") or []),
                "agent_steps": len(data.get("messages") or []),
                "ts": data.get("ts"),
            })
        except Exception:
            pass

    return {"sessions": sessions, "count": len(sessions)}


@router.get("/cosmo/agent/sessions/{session_id}")
async def get_agent_session(session_id: str) -> Dict[str, Any]:
    """Get full detail of a specific agent session."""
    from utils.app_paths import DATA_ROOT
    import json

    log_path = DATA_ROOT / "runtime" / "agent_sessions" / f"session_{session_id}.json"
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        return json.loads(log_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cosmo/agent/personality")
async def update_cosmo_personality(payload: Dict[str, str]) -> Dict[str, Any]:
    """Hot-update Cosmo's personality. Accepts raw 'personality' string or a prebuilt 'profile_id'."""
    from services.cosmo_model import cosmo_instance
    from services.cosmo_agents import get_cosmo_orchestrator
    from services.cosmo_offline import PERSONALITIES

    profile_id = (payload.get("profile_id") or "").strip()
    new_personality = (payload.get("personality") or "").strip()

    if profile_id and profile_id in PERSONALITIES:
        new_personality = PERSONALITIES[profile_id]

    if not new_personality:
        raise HTTPException(status_code=400, detail="personality or profile_id is required")

    cosmo_instance.update_personality(new_personality)

    try:
        orch = get_cosmo_orchestrator()
        orch.personality = new_personality
        orch.executor.BASE_SYSTEM_PROMPT = new_personality
    except Exception:
        pass

    return {
        "status": "ok",
        "message": "Cosmo personality updated.",
        "profile_id": profile_id or None,
        "personality": new_personality,
    }


@router.get("/cosmo/agent/constitution")
async def get_constitution() -> Dict[str, Any]:
    """Return the active Constitutional AI principles governing Cosmo."""
    from services.cosmo_agents import COSMO_CONSTITUTION
    return {
        "principles": COSMO_CONSTITUTION,
        "count": len(COSMO_CONSTITUTION),
        "source": "Anthropic Constitutional AI (2022) — public research implementation",
    }


@router.get("/cosmo/agent/profiles")
async def list_prebuilt_profiles() -> Dict[str, Any]:
    """
    Return all prebuilt Cosmo personality profiles.
    These are always available — no auth required, no network needed from client perspective.
    """
    from services.cosmo_offline import PERSONALITIES
    profiles = [
        {
            "id": pid,
            "name": pid.replace("cosmo_", "").replace("_", " ").title(),
            "description": text[:120] + "...",
            "system_prompt": text,
        }
        for pid, text in PERSONALITIES.items()
    ]
    return {"profiles": profiles, "count": len(profiles), "offline_ready": True}
