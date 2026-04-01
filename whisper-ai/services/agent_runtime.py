"""
Whisper AI - Agent runtime.

Public-repo-inspired session + planning + tool execution layer for the Whisper
server. This is intentionally lightweight and adapted to this backend's
existing capabilities instead of trying to mirror a terminal coding agent
runtime 1:1.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from loguru import logger

from utils.app_paths import DATA_ROOT, ensure_app_dirs

ensure_app_dirs()

AGENT_SESSION_DIR = DATA_ROOT / "agent_sessions"
AGENT_SESSION_DIR.mkdir(parents=True, exist_ok=True)

SUPPORTED_AGENT_BACKENDS = {"server", "self_learner", "cloud"}
IMAGE_TOOL_HINTS = ("image", "draw", "generate", "create", "illustrate", "render")
RESEARCH_TOOL_HINTS = ("latest", "current", "today", "research", "search", "look up", "find", "docs", "documentation")


@dataclass
class AgentRunRequestPayload:
    message: str
    history: list[dict[str, str]]
    session_id: Optional[str]
    context: str
    system_prompt: Optional[str]
    use_rag: bool
    roleplay_mode: bool
    nsfw_mode: bool
    backend: str
    allow_research: bool
    allow_images: bool
    max_steps: int
    max_tokens: int
    user_id: Optional[str]


def _session_path(session_id: str) -> Path:
    return AGENT_SESSION_DIR / f"{session_id}.json"


def _load_session(session_id: str) -> Optional[dict[str, Any]]:
    path = _session_path(session_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning(f"Failed to load agent session {session_id}: {exc}")
        return None


def _save_session(session: dict[str, Any]) -> None:
    session["updated_at"] = time.time()
    path = _session_path(session["id"])
    path.write_text(json.dumps(session, ensure_ascii=False, indent=2), encoding="utf-8")


def _message_preview(text: str, max_chars: int = 140) -> str:
    cleaned = " ".join(str(text or "").split())
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[: max_chars - 1].rstrip()}…"


def _is_image_request(message: str) -> bool:
    lowered = str(message or "").lower()
    return any(hint in lowered for hint in IMAGE_TOOL_HINTS)


def _is_research_request(message: str) -> bool:
    lowered = str(message or "").lower()
    return any(hint in lowered for hint in RESEARCH_TOOL_HINTS)


def _default_plan(payload: AgentRunRequestPayload) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []

    if payload.use_rag:
        steps.append(
            {
                "id": "knowledge_search",
                "tool": "knowledge_search",
                "goal": "Search the Whisper knowledge base for relevant context.",
                "reason": "Ground the answer in indexed knowledge before responding.",
                "status": "pending",
            }
        )

    if payload.allow_research and _is_research_request(payload.message):
        steps.append(
            {
                "id": "web_research",
                "tool": "web_research",
                "goal": "Fetch fresh research if local knowledge is too thin.",
                "reason": "The request looks time-sensitive or explicitly research-oriented.",
                "status": "pending",
            }
        )

    if payload.allow_images and _is_image_request(payload.message):
        steps.append(
            {
                "id": "image_generate",
                "tool": "image_generate",
                "goal": "Generate an image that satisfies the request.",
                "reason": "The user explicitly asked for an image or render.",
                "status": "pending",
            }
        )

    steps.append(
        {
            "id": "final_answer",
            "tool": "final_answer",
            "goal": "Write the final answer using the collected tool results.",
            "reason": "Synthesize the work into a direct user-facing response.",
            "status": "pending",
        }
    )

    return steps[: max(1, payload.max_steps)]


def _extract_json_payload(text: str) -> Optional[Any]:
    import json as _json

    decoder = _json.JSONDecoder()
    raw = str(text or "").strip()
    for index, char in enumerate(raw):
        if char not in "[{":
            continue
        try:
            payload, _ = decoder.raw_decode(raw[index:])
            return payload
        except Exception:
            continue
    return None


def _normalize_planned_steps(payload: Any, max_steps: int) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        payload = payload.get("steps")
    if not isinstance(payload, list):
        return []

    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(payload[:max_steps]):
        if not isinstance(item, dict):
            continue
        tool = str(item.get("tool") or "").strip().lower()
        if tool not in {"knowledge_search", "web_research", "image_generate", "final_answer"}:
            continue
        normalized.append(
            {
                "id": str(item.get("id") or f"step_{index + 1}"),
                "tool": tool,
                "goal": str(item.get("goal") or item.get("description") or tool).strip(),
                "reason": str(item.get("reason") or "").strip(),
                "status": "pending",
            }
        )

    if not normalized or normalized[-1]["tool"] != "final_answer":
        normalized.append(
            {
                "id": f"step_{len(normalized) + 1}",
                "tool": "final_answer",
                "goal": "Write the final answer using the collected tool results.",
                "reason": "Always finish with a direct response.",
                "status": "pending",
            }
        )
    return normalized[:max_steps]


async def _plan_with_backend(payload: AgentRunRequestPayload, app_state) -> list[dict[str, Any]]:
    plan_prompt = (
        "Return JSON only. Build a concise execution plan for the user's request. "
        "Allowed tools: knowledge_search, web_research, image_generate, final_answer. "
        "Prefer 2-4 steps. The last step must be final_answer.\n\n"
        f"User request:\n{payload.message}\n\n"
        f"Use RAG: {payload.use_rag}\nAllow research: {payload.allow_research}\nAllow images: {payload.allow_images}"
    )

    try:
        generated = await _generate_with_backend(
            backend=payload.backend,
            prompt=plan_prompt,
            app_state=app_state,
            max_tokens=220,
            temperature=0.2,
            user_id=payload.user_id,
        )
        parsed = _extract_json_payload(generated)
        normalized = _normalize_planned_steps(parsed, payload.max_steps)
        if normalized:
            return normalized
    except Exception as exc:
        logger.warning(f"Agent planner fell back to heuristic plan: {exc}")

    return _default_plan(payload)


async def _generate_with_backend(
    *,
    backend: str,
    prompt: str,
    app_state,
    max_tokens: int,
    temperature: float,
    user_id: Optional[str],
) -> str:
    if backend == "cloud":
        from api.routes.smart_mode import SmartChatRequest, smart_chat

        result = await smart_chat(
            SmartChatRequest(
                message=prompt,
                conversation_history=[],
                user_id=user_id,
                max_tokens=max_tokens,
            )
        )
        return result.response

    if backend == "self_learner":
        from api.routes.chat import _load_self_learner_state, _self_learner_output_is_usable
        from services.runtime_manager import (
            get_self_learner_chat_thresholds,
            get_self_learner_runtime_manager,
        )

        thresholds = get_self_learner_chat_thresholds()
        learner_state = _load_self_learner_state()
        runtime = get_self_learner_runtime_manager()
        readiness = runtime.readiness()
        if (
            learner_state.get("steps", 0) < thresholds["min_steps"]
            or learner_state.get("dataset_sequences", 0) < thresholds["min_sequences"]
        ) and not readiness.get("can_load", False):
            raise RuntimeError("self-learner runtime is not ready for agent planning")
        result = runtime.generate(prompt, max_tokens, temperature, 0.9)
        text = str(result.get("text") or "")
        if not _self_learner_output_is_usable(text):
            raise RuntimeError("self-learner runtime returned unusable output")
        return text

    if app_state.chat_runtime is None:
        raise RuntimeError("server chat runtime is not configured")

    from services.complex_task_router import generate_server_response

    result = generate_server_response(
        prompt=prompt,
        history=[],
        fallback_runtime=app_state.chat_runtime,
        max_new_tokens=max_tokens,
        temperature=temperature,
        top_p=0.9,
    )
    return str(result.get("text") or "")


def _build_final_prompt(
    payload: AgentRunRequestPayload,
    *,
    tool_results: list[dict[str, Any]],
    knowledge_context: str,
    image_url: Optional[str],
) -> str:
    from api.routes.chat import DEFAULT_SYSTEM_PROMPT

    system_prompt = payload.system_prompt or DEFAULT_SYSTEM_PROMPT
    tool_sections: list[str] = []

    if payload.context.strip():
        tool_sections.append(f"Additional context:\n{payload.context.strip()}")
    if knowledge_context.strip():
        tool_sections.append(f"Tool knowledge:\n{knowledge_context.strip()}")
    if image_url:
        tool_sections.append(f"Generated image URL:\n{image_url}")
    if tool_results:
        compact_results = [
            {
                "tool": item.get("tool"),
                "summary": item.get("summary"),
                "sources": item.get("sources"),
            }
            for item in tool_results
            if item.get("tool") != "final_answer"
        ]
        tool_sections.append(f"Agent execution summary:\n{json.dumps(compact_results, ensure_ascii=False, indent=2)}")

    history_lines = []
    for turn in payload.history[-8:]:
        role = "Assistant" if turn.get("role") == "assistant" else "User"
        content = str(turn.get("content") or "").strip()
        if content:
            history_lines.append(f"{role}: {content}")

    prompt_parts = [
        system_prompt,
        "You are Whisper Agent. Use the tool results. Be direct, structured, and avoid filler.",
    ]
    if payload.roleplay_mode:
        prompt_parts.append("Roleplay mode is enabled. Stay in-character while still using the tool results.")
    if payload.nsfw_mode:
        prompt_parts.append("Adult unrestricted mode is enabled for consensual fictional requests.")
    if history_lines:
        prompt_parts.append("Conversation history:\n" + "\n".join(history_lines))
    if tool_sections:
        prompt_parts.append("\n\n".join(tool_sections))
    prompt_parts.append(f"User request:\n{payload.message}")
    prompt_parts.append("Answer:")
    return "\n\n".join(section for section in prompt_parts if section.strip())


async def _execute_knowledge_search(payload: AgentRunRequestPayload, app_state) -> dict[str, Any]:
    if not payload.use_rag or app_state.rag is None:
        return {
            "tool": "knowledge_search",
            "summary": "Knowledge search skipped because RAG is disabled or unavailable.",
            "context": "",
            "sources": [],
        }

    context, sources = app_state.rag.build_context(payload.message)
    return {
        "tool": "knowledge_search",
        "summary": (
            f"Retrieved {len(sources)} knowledge chunk(s)."
            if sources else "No indexed knowledge matched the request."
        ),
        "context": context,
        "sources": sources,
    }


async def _execute_web_research(payload: AgentRunRequestPayload, app_state) -> dict[str, Any]:
    from api.routes.research import DiscoverRequest, _discover_and_ingest

    if not payload.allow_research:
        return {
            "tool": "web_research",
            "summary": "Web research is disabled for this request.",
            "context": "",
            "sources": [],
        }

    request = DiscoverRequest(
        topic=payload.message.strip(),
        max_pages=2,
        provider="auto",
        max_sites=1,
        depth=1,
        render=False,
        refresh_existing=False,
    )
    result = await _discover_and_ingest(request)

    context = ""
    sources: list[dict[str, Any]] = []
    if app_state.rag is not None:
        context, sources = app_state.rag.build_context(payload.message)

    return {
        "tool": "web_research",
        "summary": (
            f"Research completed using provider {result.get('provider') or 'auto'} "
            f"with {len(result.get('documents') or [])} document(s)."
        ),
        "context": context,
        "sources": sources,
        "details": result,
    }


async def _execute_image_generate(payload: AgentRunRequestPayload) -> dict[str, Any]:
    from api.routes.image import ImageGenerationRequest, generate_image

    if not payload.allow_images:
        return {
            "tool": "image_generate",
            "summary": "Image generation is disabled for this request.",
            "image_url": None,
        }

    result = await generate_image(
        ImageGenerationRequest(
            prompt=payload.message,
            model_id="cyberrealistic-v9",
            is_local=True,
            user_id=payload.user_id,
            session_id=payload.session_id,
        )
    )
    return {
        "tool": "image_generate",
        "summary": "Generated an image for the request.",
        "image_url": result.image_url,
        "seed": result.seed,
    }


async def run_agent(payload: AgentRunRequestPayload, app_state) -> dict[str, Any]:
    backend = payload.backend if payload.backend in SUPPORTED_AGENT_BACKENDS else "server"
    session = _load_session(payload.session_id) if payload.session_id else None
    if session is None:
        session = {
            "id": payload.session_id or uuid.uuid4().hex,
            "created_at": time.time(),
            "status": "planning",
            "goal": payload.message,
            "backend_requested": payload.backend,
            "backend_resolved": backend,
            "history": payload.history,
            "system_prompt": payload.system_prompt,
            "runs": [],
            "plan": [],
            "tool_results": [],
            "answer": "",
            "image_url": None,
        }
    else:
        session["status"] = "planning"
        session["goal"] = payload.message
        session["backend_requested"] = payload.backend
        session["backend_resolved"] = backend
        session["history"] = payload.history
        session["system_prompt"] = payload.system_prompt
        session.setdefault("runs", [])
        session["tool_results"] = []
        session["answer"] = ""
        session["image_url"] = None

    _save_session(session)

    planned_steps = await _plan_with_backend(payload, app_state)
    session["plan"] = planned_steps
    session["status"] = "running"
    _save_session(session)

    knowledge_context = ""
    citations: list[dict[str, Any]] = []
    image_url: Optional[str] = None
    tool_results: list[dict[str, Any]] = []

    for step in session["plan"]:
        step["status"] = "running"
        _save_session(session)

        try:
            if step["tool"] == "knowledge_search":
                result = await _execute_knowledge_search(payload, app_state)
                if result.get("context"):
                    knowledge_context = str(result["context"])
                    citations = list(result.get("sources") or [])
            elif step["tool"] == "web_research":
                result = await _execute_web_research(payload, app_state)
                if result.get("context"):
                    knowledge_context = str(result["context"])
                    citations = list(result.get("sources") or [])
            elif step["tool"] == "image_generate":
                result = await _execute_image_generate(payload)
                image_url = result.get("image_url")
            else:
                final_prompt = _build_final_prompt(
                    payload,
                    tool_results=tool_results,
                    knowledge_context=knowledge_context,
                    image_url=image_url,
                )
                answer = await _generate_with_backend(
                    backend=backend,
                    prompt=final_prompt,
                    app_state=app_state,
                    max_tokens=payload.max_tokens,
                    temperature=0.6 if payload.roleplay_mode else 0.4,
                    user_id=payload.user_id,
                )
                result = {
                    "tool": "final_answer",
                    "summary": "Synthesized the final answer from the collected tool results.",
                    "answer": answer.strip(),
                }

            step["status"] = "completed"
            step["output_preview"] = _message_preview(
                result.get("answer")
                or result.get("summary")
                or result.get("context")
                or result.get("image_url")
                or ""
            )
            tool_results.append(result)
            session["tool_results"] = tool_results
            if result.get("answer"):
                session["answer"] = result["answer"]
            if result.get("image_url"):
                session["image_url"] = result["image_url"]
            _save_session(session)
        except Exception as exc:
            step["status"] = "failed"
            step["output_preview"] = _message_preview(str(exc))
            session["status"] = "failed"
            session["error"] = str(exc)
            _save_session(session)
            raise

    session["status"] = "completed"
    session["citations"] = citations
    session["runs"].append(
        {
            "timestamp": time.time(),
            "message": payload.message,
            "answer": session.get("answer", ""),
            "backend": backend,
            "image_url": session.get("image_url"),
        }
    )
    _save_session(session)
    return session


def list_agent_sessions(limit: int = 20) -> list[dict[str, Any]]:
    sessions: list[dict[str, Any]] = []
    for path in sorted(AGENT_SESSION_DIR.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        sessions.append(
            {
                "id": payload.get("id"),
                "goal": payload.get("goal"),
                "status": payload.get("status"),
                "backend": payload.get("backend_resolved"),
                "updated_at": payload.get("updated_at"),
                "image_url": payload.get("image_url"),
                "answer_preview": _message_preview(payload.get("answer") or ""),
            }
        )
        if len(sessions) >= limit:
            break
    return sessions


def get_agent_session(session_id: str) -> Optional[dict[str, Any]]:
    return _load_session(session_id)
