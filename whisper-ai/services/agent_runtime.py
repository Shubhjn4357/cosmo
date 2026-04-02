"""
Whisper AI - Background agent runtime.

This adapts the existing Whisper backend into a server-owned agent session
model. Requests start or continue a persisted session, the work runs in a
background task, and the mobile client can poll or resume after the app goes
to the background.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional
from urllib import request as urllib_request

from loguru import logger

from utils.app_paths import DATA_ROOT, ensure_app_dirs

ensure_app_dirs()

AGENT_SESSION_DIR = DATA_ROOT / "agent_sessions"
AGENT_SESSION_DIR.mkdir(parents=True, exist_ok=True)

SUPPORTED_AGENT_BACKENDS = {"server", "self_learner", "cloud"}
IMAGE_TOOL_HINTS = ("image", "draw", "generate", "create", "illustrate", "render")
RESEARCH_TOOL_HINTS = (
    "latest",
    "current",
    "today",
    "research",
    "search",
    "look up",
    "find",
    "docs",
    "documentation",
)
RUNTIME_TOOL_HINTS = (
    "runtime",
    "profile",
    "backend",
    "gguf",
    "self-learner",
    "self learner",
    "switch model",
    "switch profile",
    "runtime status",
    "download profile",
    "load profile",
    "reload runtime",
    "unload runtime",
)
MODEL_CONTROL_HINTS = (
    "model catalog",
    "approved models",
    "downloadable models",
    "image model",
    "default image model",
    "local model",
    "model list",
)
DATASET_CONTROL_HINTS = (
    "dataset",
    "hugging face dataset",
    "load_dataset",
    "import dataset",
    "training data",
    "curated import",
)
WORKSPACE_TOOL_HINTS = (
    "file",
    "repo",
    "repository",
    "directory",
    "folder",
    "code",
    "search",
    "read",
    "edit",
    "write",
    "command",
    "run",
    "bash",
    "terminal",
    "module",
)
WORKSPACE_ROOT = Path(
    os.getenv("WHISPER_AGENT_WORKSPACE_ROOT", str(Path(__file__).resolve().parents[1]))
).resolve()
MAX_FILE_READ_CHARS = int(os.getenv("WHISPER_AGENT_MAX_FILE_READ_CHARS", "12000"))
MAX_TOOL_CONTEXT_CHARS = int(os.getenv("WHISPER_AGENT_MAX_TOOL_CONTEXT_CHARS", "4000"))
MAX_COMMAND_OUTPUT_CHARS = int(os.getenv("WHISPER_AGENT_MAX_COMMAND_OUTPUT_CHARS", "8000"))
DEFAULT_AGENT_TIMEOUT_SECONDS = int(os.getenv("WHISPER_AGENT_COMMAND_TIMEOUT_SECONDS", "45"))
SHELL_TOOLS_ENABLED = os.getenv("WHISPER_AGENT_SHELL_TOOLS", "true").lower() == "true"
WRITE_TOOLS_ENABLED = os.getenv("WHISPER_AGENT_WRITE_TOOLS", "true").lower() == "true"
HTTP_FETCH_ENABLED = os.getenv("WHISPER_AGENT_WEB_FETCH", "true").lower() == "true"

_RUNNING_AGENT_TASKS: dict[str, asyncio.Task] = {}
_RUNNING_AGENT_LOCK = asyncio.Lock()


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


def _message_preview(text: str, max_chars: int = 160) -> str:
    cleaned = " ".join(str(text or "").split())
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[: max_chars - 3].rstrip()}..."


def _extract_json_payload(text: str) -> Optional[Any]:
    decoder = json.JSONDecoder()
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


def _is_image_request(message: str) -> bool:
    lowered = str(message or "").lower()
    return any(hint in lowered for hint in IMAGE_TOOL_HINTS)


def _is_research_request(message: str) -> bool:
    lowered = str(message or "").lower()
    return any(hint in lowered for hint in RESEARCH_TOOL_HINTS)


def _is_workspace_request(message: str) -> bool:
    lowered = str(message or "").lower()
    return any(hint in lowered for hint in WORKSPACE_TOOL_HINTS)


def _is_runtime_control_request(message: str) -> bool:
    lowered = str(message or "").lower()
    return any(hint in lowered for hint in RUNTIME_TOOL_HINTS)


def _is_model_control_request(message: str) -> bool:
    lowered = str(message or "").lower()
    return any(hint in lowered for hint in MODEL_CONTROL_HINTS)


def _is_dataset_control_request(message: str) -> bool:
    lowered = str(message or "").lower()
    return any(hint in lowered for hint in DATASET_CONTROL_HINTS)


def _available_tools(payload: AgentRunRequestPayload) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []

    if payload.use_rag:
        tools.append(
            {
                "name": "knowledge_search",
                "description": "Search the Whisper knowledge base for relevant indexed context.",
                "input_schema": {"query": "string"},
            }
        )

    if payload.allow_research:
        tools.append(
            {
                "name": "web_research",
                "description": "Discover and ingest fresh external sources for time-sensitive questions.",
                "input_schema": {"query": "string"},
            }
        )

    tools.extend(
        [
            {
                "name": "runtime_status",
                "description": "Inspect the current server runtime backend, selected profile, and readiness.",
                "input_schema": {},
            },
            {
                "name": "runtime_profiles",
                "description": "List available runtime profiles and their readiness/download state.",
                "input_schema": {},
            },
            {
                "name": "runtime_select_profile",
                "description": "Switch the active runtime profile.",
                "input_schema": {"profile_id": "string", "eager_load": "boolean"},
            },
            {
                "name": "runtime_validate_profile",
                "description": "Run runtime validation checks for a profile without changing the current runtime.",
                "input_schema": {"profile_id": "string", "test_load": "boolean"},
            },
            {
                "name": "runtime_download_profile",
                "description": "Queue a model/profile download job for a runtime profile.",
                "input_schema": {"profile_id": "string"},
            },
            {
                "name": "model_catalog",
                "description": "Inspect approved text/image model catalogs and download status.",
                "input_schema": {"kind": "text|image|all"},
            },
            {
                "name": "set_image_model",
                "description": "Change the default local image generation model.",
                "input_schema": {"model_id": "string"},
            },
            {
                "name": "dataset_import_hf",
                "description": "Import a Hugging Face dataset into Whisper training data.",
                "input_schema": {
                    "dataset_id": "string",
                    "config_name": "string",
                    "split": "string",
                    "kind": "auto|text|image_prompt|vision|all",
                    "max_rows": "integer",
                    "auto_sync": "boolean",
                },
            },
            {
                "name": "list_directory",
                "description": "List files and folders inside the workspace.",
                "input_schema": {"path": "string"},
            },
            {
                "name": "search_files",
                "description": "Search the workspace for a text pattern.",
                "input_schema": {"pattern": "string", "path": "string"},
            },
            {
                "name": "read_file",
                "description": "Read a file from the workspace with optional line limits.",
                "input_schema": {"path": "string", "start_line": "integer", "end_line": "integer"},
            },
        ]
    )

    if WRITE_TOOLS_ENABLED:
        tools.extend(
            [
                {
                    "name": "write_file",
                    "description": "Overwrite or create a workspace file with provided content.",
                    "input_schema": {"path": "string", "content": "string"},
                },
                {
                    "name": "append_file",
                    "description": "Append content to a workspace file.",
                    "input_schema": {"path": "string", "content": "string"},
                },
            ]
        )

    if SHELL_TOOLS_ENABLED:
        tools.append(
            {
                "name": "run_command",
                "description": "Run a shell command inside the workspace and capture stdout/stderr.",
                "input_schema": {"command": "string", "cwd": "string", "timeout_seconds": "integer"},
            }
        )

    if HTTP_FETCH_ENABLED:
        tools.append(
            {
                "name": "web_fetch",
                "description": "Fetch the text content from a URL.",
                "input_schema": {"url": "string"},
            }
        )

    if payload.allow_images:
        tools.append(
            {
                "name": "image_generate",
                "description": "Generate an image from the current request.",
                "input_schema": {"prompt": "string"},
            }
        )

    return tools


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
                "goal": "Fetch fresher sources for a time-sensitive or research-oriented request.",
                "reason": "The user request appears to need external information.",
                "status": "pending",
            }
        )

    if _is_runtime_control_request(payload.message):
        steps.append(
            {
                "id": "runtime_status",
                "tool": "runtime_status",
                "goal": "Inspect runtime/profile state before making changes.",
                "reason": "The request mentions runtime settings, profiles, or backend control.",
                "status": "pending",
            }
        )

    if _is_model_control_request(payload.message):
        steps.append(
            {
                "id": "model_catalog",
                "tool": "model_catalog",
                "goal": "Inspect model catalog state before changing models.",
                "reason": "The request mentions model catalogs, downloads, or image model selection.",
                "status": "pending",
            }
        )

    if _is_dataset_control_request(payload.message):
        steps.append(
            {
                "id": "dataset_import_hf",
                "tool": "dataset_import_hf",
                "goal": "Import or inspect dataset-related state.",
                "reason": "The request mentions dataset import or training data.",
                "status": "pending",
            }
        )

    if _is_workspace_request(payload.message):
        steps.append(
            {
                "id": "workspace_scan",
                "tool": "search_files",
                "goal": "Inspect the workspace to find relevant files or content.",
                "reason": "The request mentions code, files, commands, or modules.",
                "status": "pending",
            }
        )

    if payload.allow_images and _is_image_request(payload.message):
        steps.append(
            {
                "id": "image_generate",
                "tool": "image_generate",
                "goal": "Generate an image for the request.",
                "reason": "The user explicitly asked for image generation.",
                "status": "pending",
            }
        )

    steps.append(
        {
            "id": "final_answer",
            "tool": "final_answer",
            "goal": "Write the final answer using the collected tool results.",
            "reason": "Synthesize the work into a direct response.",
            "status": "pending",
        }
    )
    return steps[: max(1, payload.max_steps)]


def _append_event(session: dict[str, Any], kind: str, message: str, **extra: Any) -> None:
    session.setdefault("events", []).append(
        {
            "timestamp": time.time(),
            "kind": kind,
            "message": message,
            **extra,
        }
    )
    session["events"] = session["events"][-60:]


def _new_or_reset_session(
    payload: AgentRunRequestPayload,
    *,
    backend: str,
    existing: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    session = existing or {
        "id": payload.session_id or uuid.uuid4().hex,
        "created_at": time.time(),
        "runs": [],
    }
    session.update(
        {
            "status": "queued",
            "goal": payload.message,
            "backend_requested": payload.backend,
            "backend_resolved": backend,
            "history": payload.history,
            "system_prompt": payload.system_prompt,
            "context": payload.context,
            "answer": "",
            "image_url": None,
            "plan": [],
            "tool_results": [],
            "citations": [],
            "error": None,
            "workspace_root": str(WORKSPACE_ROOT),
            "available_tools": [tool["name"] for tool in _available_tools(payload)],
            "current_tool": None,
            "current_step_index": 0,
            "cancel_requested": False,
        }
    )
    _append_event(session, "status", "Agent session queued", backend=backend)
    return session


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
        from services.runtime_manager import get_self_learner_chat_thresholds, get_self_learner_runtime_manager

        thresholds = get_self_learner_chat_thresholds()
        learner_state = _load_self_learner_state()
        runtime = get_self_learner_runtime_manager()
        readiness = runtime.readiness()
        if (
            learner_state.get("steps", 0) < thresholds["min_steps"]
            or learner_state.get("dataset_sequences", 0) < thresholds["min_sequences"]
        ) and not readiness.get("can_load", False):
            raise RuntimeError("self-learner runtime is not ready for agent work")
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


def _tool_result_summary(result: dict[str, Any]) -> str:
    return (
        result.get("summary")
        or result.get("answer")
        or result.get("context")
        or result.get("stdout")
        or result.get("content")
        or result.get("image_url")
        or ""
    )


def _build_action_prompt(
    payload: AgentRunRequestPayload,
    *,
    step_index: int,
    tool_results: list[dict[str, Any]],
    available_tools: list[dict[str, Any]],
) -> str:
    compact_results = [
        {
            "tool": item.get("tool"),
            "summary": _message_preview(_tool_result_summary(item), 260),
        }
        for item in tool_results[-6:]
    ]
    instructions = {
        "format": {
            "kind": "tool|final",
            "tool": "tool name when kind=tool",
            "reason": "short reason",
            "input": "tool input object when kind=tool",
            "answer": "final answer when kind=final",
        },
        "rules": [
            "Return JSON only.",
            "Use at most one tool in this step.",
            "If enough context is already available, choose kind=final.",
            "Paths must stay inside the workspace root.",
            "Prefer read/search actions before write actions.",
        ],
        "workspace_root": str(WORKSPACE_ROOT),
        "available_tools": available_tools,
        "previous_results": compact_results,
        "step_index": step_index + 1,
        "max_steps": payload.max_steps,
        "user_request": payload.message,
        "extra_context": payload.context,
    }
    return (
        "You are Whisper Agent. Decide the next action for this task.\n\n"
        f"{json.dumps(instructions, ensure_ascii=False, indent=2)}"
    )


def _normalize_action_choice(choice: Any, available_tools: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not isinstance(choice, dict):
        return None

    kind = str(choice.get("kind") or choice.get("action") or "").strip().lower()
    available_names = {tool["name"] for tool in available_tools}

    if kind == "final":
        return {
            "kind": "final",
            "reason": str(choice.get("reason") or "").strip(),
            "answer": str(choice.get("answer") or "").strip(),
        }

    if kind != "tool":
        tool_name = str(choice.get("tool") or "").strip().lower()
        if tool_name:
            kind = "tool"
        else:
            return None

    tool_name = str(choice.get("tool") or "").strip().lower()
    if tool_name not in available_names:
        return None

    tool_input = choice.get("input") or {}
    if not isinstance(tool_input, dict):
        tool_input = {}

    return {
        "kind": "tool",
        "tool": tool_name,
        "reason": str(choice.get("reason") or "").strip(),
        "input": tool_input,
    }


def _extract_explicit_path(message: str) -> Optional[str]:
    match = re.search(r"((?:[\w.\-/]+/)+[\w.\-]+)", message or "")
    if match:
        return match.group(1)
    return None


def _fallback_action_choice(
    payload: AgentRunRequestPayload,
    *,
    tool_results: list[dict[str, Any]],
    available_tools: list[dict[str, Any]],
) -> dict[str, Any]:
    used_tools = {item.get("tool") for item in tool_results}
    available_names = {tool["name"] for tool in available_tools}
    lowered = payload.message.lower()
    explicit_path = _extract_explicit_path(payload.message)
    explicit_dataset_id = _extract_dataset_id(payload.message)
    explicit_profile_id = _extract_profile_id(payload.message)
    explicit_image_model_id = _extract_image_model_id(payload.message)

    if (
        "dataset_import_hf" in available_names
        and explicit_dataset_id
        and ("import" in lowered or "feed" in lowered or "train" in lowered or "dataset" in lowered)
        and "dataset_import_hf" not in used_tools
    ):
        return {
            "kind": "tool",
            "tool": "dataset_import_hf",
            "reason": "The request references a Hugging Face dataset id for import.",
            "input": {"dataset_id": explicit_dataset_id},
        }

    if _is_runtime_control_request(payload.message):
        if (
            "runtime_select_profile" in available_names
            and explicit_profile_id
            and any(term in lowered for term in ("select", "switch", "use", "apply", "load"))
            and "runtime_select_profile" not in used_tools
        ):
            return {
                "kind": "tool",
                "tool": "runtime_select_profile",
                "reason": "The request asks to switch the active runtime profile.",
                "input": {"profile_id": explicit_profile_id, "eager_load": True},
            }

        if (
            "runtime_download_profile" in available_names
            and explicit_profile_id
            and "download" in lowered
            and "runtime_download_profile" not in used_tools
        ):
            return {
                "kind": "tool",
                "tool": "runtime_download_profile",
                "reason": "The request asks to download a runtime profile.",
                "input": {"profile_id": explicit_profile_id},
            }
        if "runtime_status" in available_names and "runtime_status" not in used_tools:
            return {
                "kind": "tool",
                "tool": "runtime_status",
                "reason": "Inspect the current runtime state first.",
                "input": {},
            }

    if _is_model_control_request(payload.message):
        if (
            "set_image_model" in available_names
            and explicit_image_model_id
            and ("image model" in lowered or "default image" in lowered or "switch" in lowered or "use" in lowered)
            and "set_image_model" not in used_tools
        ):
            return {
                "kind": "tool",
                "tool": "set_image_model",
                "reason": "The request asks to change the default image model.",
                "input": {"model_id": explicit_image_model_id},
            }

        if "model_catalog" in available_names and "model_catalog" not in used_tools:
            return {
                "kind": "tool",
                "tool": "model_catalog",
                "reason": "Inspect model availability and download state first.",
                "input": {
                    "kind": "image" if "image" in lowered else ("text" if "text" in lowered or "llm" in lowered else "all")
                },
            }

    if _is_dataset_control_request(payload.message) and "dataset_import_hf" in available_names and explicit_dataset_id:
        return {
            "kind": "tool",
            "tool": "dataset_import_hf",
            "reason": "The request appears to be about importing training data from Hugging Face.",
            "input": {"dataset_id": explicit_dataset_id},
        }

    if "read_file" in available_names and explicit_path and "read" in lowered and "read_file" not in used_tools:
        return {
            "kind": "tool",
            "tool": "read_file",
            "reason": "The user explicitly referenced a file path.",
            "input": {"path": explicit_path},
        }

    if "search_files" in available_names and _is_workspace_request(payload.message) and "search_files" not in used_tools:
        pattern = explicit_path or payload.message.strip()
        return {
            "kind": "tool",
            "tool": "search_files",
            "reason": "Search the workspace for relevant code or files first.",
            "input": {"pattern": pattern[:200], "path": "."},
        }

    if "knowledge_search" in available_names and payload.use_rag and "knowledge_search" not in used_tools:
        return {
            "kind": "tool",
            "tool": "knowledge_search",
            "reason": "Ground the answer with indexed knowledge.",
            "input": {"query": payload.message},
        }

    if "web_research" in available_names and _is_research_request(payload.message) and "web_research" not in used_tools:
        return {
            "kind": "tool",
            "tool": "web_research",
            "reason": "The request appears time-sensitive or explicitly research-oriented.",
            "input": {"query": payload.message},
        }

    if "image_generate" in available_names and _is_image_request(payload.message) and "image_generate" not in used_tools:
        return {
            "kind": "tool",
            "tool": "image_generate",
            "reason": "The user asked for an image.",
            "input": {"prompt": payload.message},
        }

    return {
        "kind": "final",
        "reason": "No higher-signal tool action was selected.",
        "answer": "",
    }


async def _decide_next_action(
    payload: AgentRunRequestPayload,
    *,
    backend: str,
    app_state,
    step_index: int,
    tool_results: list[dict[str, Any]],
    available_tools: list[dict[str, Any]],
) -> dict[str, Any]:
    prompt = _build_action_prompt(
        payload,
        step_index=step_index,
        tool_results=tool_results,
        available_tools=available_tools,
    )
    try:
        raw = await _generate_with_backend(
            backend=backend,
            prompt=prompt,
            app_state=app_state,
            max_tokens=220,
            temperature=0.15,
            user_id=payload.user_id,
        )
        parsed = _extract_json_payload(raw)
        normalized = _normalize_action_choice(parsed, available_tools)
        if normalized is not None:
            return normalized
    except Exception as exc:
        logger.warning(f"Agent action planner fell back to heuristics: {exc}")

    return _fallback_action_choice(
        payload,
        tool_results=tool_results,
        available_tools=available_tools,
    )


def _resolve_workspace_path(raw_path: str) -> Path:
    candidate_text = str(raw_path or "").strip()
    if not candidate_text:
        raise ValueError("path is required")
    candidate = Path(candidate_text)

    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        resolved = (WORKSPACE_ROOT / candidate).resolve()

    workspace_root_text = str(WORKSPACE_ROOT)
    resolved_text = str(resolved)
    if resolved_text != workspace_root_text and not resolved_text.startswith(f"{workspace_root_text}{os.sep}"):
        raise ValueError(f"Path '{resolved}' is outside the workspace root")
    return resolved


def _truncate_text(text: str, max_chars: int) -> str:
    value = str(text or "")
    if len(value) <= max_chars:
        return value
    return f"{value[: max_chars - 3].rstrip()}..."


def _strip_html(raw_html: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", raw_html, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def _extract_dataset_id(message: str) -> Optional[str]:
    match = re.search(r"\b([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\b", str(message or ""))
    if match:
        return match.group(1)
    return None


def _extract_profile_id(message: str) -> Optional[str]:
    from services.model_manager import get_profiles

    lowered = str(message or "").lower()
    for profile_id in get_profiles().keys():
        if profile_id.lower() in lowered:
            return profile_id
    return None


def _extract_image_model_id(message: str) -> Optional[str]:
    from services.approved_model_catalog import list_image_models

    lowered = str(message or "").lower()
    for model in list_image_models(include_adult=True, include_edit=False):
        model_id = str(model.get("id") or "")
        if model_id and model_id.lower() in lowered:
            return model_id
    return None


async def _execute_runtime_status(app_state) -> dict[str, Any]:
    from services.model_manager import runtime_profiles_payload

    if app_state.chat_runtime is None:
        raise RuntimeError("chat runtime is not configured")

    selected_profile = app_state.chat_runtime.get_selected_profile()
    runtime = app_state.chat_runtime.status()
    profiles = runtime_profiles_payload(selected_profile)
    summary = (
        f"Runtime backend={runtime.get('active_backend') or runtime.get('configured_backend')} "
        f"profile={selected_profile or 'custom'} loaded={bool(runtime.get('loaded'))}."
    )
    compact_profiles = [
        {
            "id": item.get("id"),
            "backend": item.get("backend"),
            "ready": item.get("ready"),
            "downloaded": item.get("downloaded"),
            "enabled": item.get("enabled"),
        }
        for item in profiles.get("profiles", [])
    ]
    return {
        "tool": "runtime_status",
        "summary": summary,
        "runtime": runtime,
        "selected_profile": selected_profile,
        "profiles": compact_profiles,
        "context": _truncate_text(json.dumps(runtime, ensure_ascii=False, indent=2), MAX_TOOL_CONTEXT_CHARS),
    }


async def _execute_runtime_profiles(app_state) -> dict[str, Any]:
    from services.model_manager import runtime_profiles_payload

    if app_state.chat_runtime is None:
        raise RuntimeError("chat runtime is not configured")

    selected_profile = app_state.chat_runtime.get_selected_profile()
    payload = runtime_profiles_payload(selected_profile)
    profiles = payload.get("profiles", [])
    context = json.dumps(
        [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "backend": item.get("backend"),
                "ready": item.get("ready"),
                "downloaded": item.get("downloaded"),
                "enabled": item.get("enabled"),
                "status_message": item.get("status_message"),
            }
            for item in profiles
        ],
        ensure_ascii=False,
        indent=2,
    )
    return {
        "tool": "runtime_profiles",
        "summary": f"Loaded {len(profiles)} runtime profile(s); selected profile is {selected_profile or 'custom'}.",
        "profiles": profiles,
        "selected_profile": selected_profile,
        "context": _truncate_text(context, MAX_TOOL_CONTEXT_CHARS),
    }


async def _execute_runtime_select_profile(app_state, tool_input: dict[str, Any]) -> dict[str, Any]:
    from services.admin_state import get_model_enabled
    from services.model_manager import get_profile

    if app_state.chat_runtime is None:
        raise RuntimeError("chat runtime is not configured")

    profile_id = str(tool_input.get("profile_id") or "").strip()
    if not profile_id:
        raise ValueError("profile_id is required")

    profile = get_profile(profile_id)
    if not get_model_enabled(f"runtime.{profile.id}", True):
        raise RuntimeError(f"Runtime profile '{profile.id}' is disabled")

    app_state.chat_runtime.reconfigure(profile.to_runtime_config(), selected_profile=profile.id, persist=True)
    eager_load = bool(tool_input.get("eager_load"))
    loaded = False
    if eager_load:
        loaded = await asyncio.to_thread(app_state.chat_runtime.ensure_loaded)

    runtime = app_state.chat_runtime.status()
    return {
        "tool": "runtime_select_profile",
        "summary": f"Selected runtime profile {profile.id}.",
        "selected_profile": profile.id,
        "runtime_loaded": loaded,
        "runtime": runtime,
        "context": _truncate_text(json.dumps(runtime, ensure_ascii=False, indent=2), MAX_TOOL_CONTEXT_CHARS),
    }


async def _execute_runtime_validate_profile(tool_input: dict[str, Any]) -> dict[str, Any]:
    from services.admin_state import get_model_enabled
    from services.model_manager import get_profile, validate_profile

    profile_id = str(tool_input.get("profile_id") or "").strip()
    if not profile_id:
        raise ValueError("profile_id is required")

    profile = get_profile(profile_id)
    if not get_model_enabled(f"runtime.{profile.id}", True):
        raise RuntimeError(f"Runtime profile '{profile.id}' is disabled")

    validation = validate_profile(profile.id, test_load=bool(tool_input.get("test_load")))
    return {
        "tool": "runtime_validate_profile",
        "summary": f"Validated runtime profile {profile.id}.",
        "profile_id": profile.id,
        "validation": validation,
        "context": _truncate_text(json.dumps(validation, ensure_ascii=False, indent=2), MAX_TOOL_CONTEXT_CHARS),
    }


async def _execute_runtime_download_profile(tool_input: dict[str, Any]) -> dict[str, Any]:
    from services.admin_state import get_model_enabled
    from services.model_manager import get_profile, queue_profile_download

    profile_id = str(tool_input.get("profile_id") or "").strip()
    if not profile_id:
        raise ValueError("profile_id is required")

    profile = get_profile(profile_id)
    if not get_model_enabled(f"runtime.{profile.id}", True):
        raise RuntimeError(f"Runtime profile '{profile.id}' is disabled")

    job = queue_profile_download(profile.id)
    return {
        "tool": "runtime_download_profile",
        "summary": f"Queued runtime profile download for {profile.id}.",
        "profile_id": profile.id,
        "job": job,
        "context": _truncate_text(json.dumps(job, ensure_ascii=False, indent=2), MAX_TOOL_CONTEXT_CHARS),
    }


async def _execute_model_catalog(tool_input: dict[str, Any]) -> dict[str, Any]:
    from services.admin_state import get_model_enabled, get_selected_image_model
    from services.approved_model_catalog import list_image_models, list_text_models
    from services.catalog_bootstrap import resolve_bootstrap_artifact

    kind = str(tool_input.get("kind") or "all").strip().lower() or "all"
    if kind not in {"all", "text", "image"}:
        raise ValueError("kind must be one of: all, text, image")

    models: list[dict[str, Any]] = []

    if kind in {"all", "text"}:
        for model in list_text_models(include_adult=True):
            state = resolve_bootstrap_artifact("text", model["id"], model.get("filename") or "")
            models.append(
                {
                    "scope": "text",
                    "id": model["id"],
                    "name": model["name"],
                    "provider": model.get("provider"),
                    "downloaded": bool(state.get("downloaded")),
                    "status": state.get("status", "pending"),
                    "enabled": True,
                }
            )

    if kind in {"all", "image"}:
        current_image_model = get_selected_image_model()
        for model in list_image_models(include_adult=True, include_edit=False):
            state = resolve_bootstrap_artifact("image", model["id"], model.get("filename") or "")
            models.append(
                {
                    "scope": "image",
                    "id": model["id"],
                    "name": model["name"],
                    "provider": model.get("provider"),
                    "downloaded": bool(state.get("downloaded")),
                    "status": state.get("status", "pending"),
                    "enabled": get_model_enabled(f"image.{model['id']}", True),
                    "selected": current_image_model == model["id"],
                }
            )

    return {
        "tool": "model_catalog",
        "summary": f"Loaded {len(models)} approved model catalog entrie(s) for kind={kind}.",
        "models": models,
        "context": _truncate_text(json.dumps(models, ensure_ascii=False, indent=2), MAX_TOOL_CONTEXT_CHARS),
    }


async def _execute_set_image_model(tool_input: dict[str, Any]) -> dict[str, Any]:
    from api.routes.image import set_server_model

    model_id = str(tool_input.get("model_id") or "").strip()
    if not model_id:
        raise ValueError("model_id is required")

    result = await set_server_model(model_id)
    return {
        "tool": "set_image_model",
        "summary": str(result.get("message") or f"Changed image model to {model_id}."),
        "result": result,
        "context": _truncate_text(json.dumps(result, ensure_ascii=False, indent=2), MAX_TOOL_CONTEXT_CHARS),
    }


async def _execute_dataset_import_hf(tool_input: dict[str, Any]) -> dict[str, Any]:
    from services.curated_training_import import import_hf_dataset

    dataset_id = str(tool_input.get("dataset_id") or "").strip()
    if not dataset_id:
        raise ValueError("dataset_id is required")
    if "/" not in dataset_id:
        raise ValueError("dataset_id must look like 'owner/name'")

    result = await asyncio.to_thread(
        import_hf_dataset,
        dataset_id,
        config_name=str(tool_input.get("config_name") or "").strip() or None,
        split=str(tool_input.get("split") or "train").strip() or "train",
        kind=str(tool_input.get("kind") or "auto").strip() or "auto",
        max_rows=int(tool_input["max_rows"]) if tool_input.get("max_rows") is not None else None,
        auto_sync=bool(tool_input.get("auto_sync")),
    )
    return {
        "tool": "dataset_import_hf",
        "summary": (
            f"Imported dataset {dataset_id} with {int(result.get('rows_imported') or 0)} normalized record(s) "
            f"across {', '.join(result.get('resolved_modalities') or [result.get('resolved_kind') or 'unknown'])}."
        ),
        "dataset_id": dataset_id,
        "result": result,
        "context": _truncate_text(json.dumps(result, ensure_ascii=False, indent=2), MAX_TOOL_CONTEXT_CHARS),
    }


async def _execute_knowledge_search(payload: AgentRunRequestPayload, app_state, tool_input: dict[str, Any]) -> dict[str, Any]:
    query = str(tool_input.get("query") or payload.message).strip()
    if not payload.use_rag or app_state.rag is None:
        return {
            "tool": "knowledge_search",
            "summary": "Knowledge search skipped because RAG is disabled or unavailable.",
            "context": "",
            "sources": [],
        }

    context, sources = app_state.rag.build_context(query)
    return {
        "tool": "knowledge_search",
        "summary": (
            f"Retrieved {len(sources)} knowledge chunk(s)." if sources else "No indexed knowledge matched the request."
        ),
        "context": _truncate_text(context, MAX_TOOL_CONTEXT_CHARS),
        "sources": sources,
    }


async def _execute_web_research(payload: AgentRunRequestPayload, app_state, tool_input: dict[str, Any]) -> dict[str, Any]:
    from api.routes.research import DiscoverRequest, _discover_and_ingest

    if not payload.allow_research:
        return {
            "tool": "web_research",
            "summary": "Web research is disabled for this request.",
            "context": "",
            "sources": [],
        }

    request = DiscoverRequest(
        topic=str(tool_input.get("query") or payload.message).strip(),
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
        "context": _truncate_text(context, MAX_TOOL_CONTEXT_CHARS),
        "sources": sources,
        "details": result,
    }


async def _execute_image_generate(payload: AgentRunRequestPayload, tool_input: dict[str, Any]) -> dict[str, Any]:
    from api.routes.image import ImageGenerationRequest, generate_image

    if not payload.allow_images:
        return {
            "tool": "image_generate",
            "summary": "Image generation is disabled for this request.",
            "image_url": None,
        }

    prompt = str(tool_input.get("prompt") or payload.message).strip() or payload.message
    result = await generate_image(
        ImageGenerationRequest(
            prompt=prompt,
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


async def _execute_list_directory(tool_input: dict[str, Any]) -> dict[str, Any]:
    target = _resolve_workspace_path(str(tool_input.get("path") or "."))
    if not target.exists():
        raise FileNotFoundError(str(target))
    if not target.is_dir():
        raise NotADirectoryError(str(target))

    children = []
    for child in sorted(target.iterdir(), key=lambda item: (item.is_file(), item.name.lower()))[:200]:
        descriptor = {"name": child.name, "type": "dir" if child.is_dir() else "file"}
        if child.is_file():
            descriptor["size_bytes"] = child.stat().st_size
        children.append(descriptor)

    return {
        "tool": "list_directory",
        "summary": f"Listed {len(children)} item(s) in {target.relative_to(WORKSPACE_ROOT).as_posix() or '.'}.",
        "path": str(target),
        "items": children,
        "context": json.dumps(children, ensure_ascii=False, indent=2),
    }


def _search_with_rg(pattern: str, base_path: Path) -> list[str]:
    rg_path = shutil.which("rg")
    if not rg_path:
        return []

    process = subprocess.run(
        [rg_path, "-n", "--hidden", "--glob", "!node_modules", "--glob", "!.git", pattern, str(base_path)],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE_ROOT),
        timeout=DEFAULT_AGENT_TIMEOUT_SECONDS,
    )
    output = process.stdout.strip()
    return [line for line in output.splitlines() if line.strip()][:120]


def _search_with_python(pattern: str, base_path: Path) -> list[str]:
    regex = re.compile(pattern, flags=re.IGNORECASE)
    matches: list[str] = []
    for path in base_path.rglob("*"):
        if not path.is_file():
            continue
        if any(part in {".git", "node_modules"} for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            if regex.search(line):
                relative = path.relative_to(WORKSPACE_ROOT).as_posix()
                matches.append(f"{relative}:{line_number}:{line.strip()}")
                if len(matches) >= 120:
                    return matches
    return matches


async def _execute_search_files(tool_input: dict[str, Any]) -> dict[str, Any]:
    pattern = str(tool_input.get("pattern") or "").strip()
    if not pattern:
        raise ValueError("pattern is required")

    base_path = _resolve_workspace_path(str(tool_input.get("path") or "."))
    if base_path.is_file():
        base_path = base_path.parent

    matches = await asyncio.to_thread(_search_with_rg, pattern, base_path)
    if not matches:
        matches = await asyncio.to_thread(_search_with_python, pattern, base_path)

    context = "\n".join(matches[:80])
    return {
        "tool": "search_files",
        "summary": (
            f"Found {len(matches)} workspace match(es) for pattern '{pattern}'."
            if matches
            else f"No workspace matches found for pattern '{pattern}'."
        ),
        "context": _truncate_text(context, MAX_TOOL_CONTEXT_CHARS),
        "matches": matches[:80],
    }


async def _execute_read_file(tool_input: dict[str, Any]) -> dict[str, Any]:
    target = _resolve_workspace_path(str(tool_input.get("path") or ""))
    if not target.exists():
        raise FileNotFoundError(str(target))
    if not target.is_file():
        raise IsADirectoryError(str(target))

    start_line = max(1, int(tool_input.get("start_line") or 1))
    end_line = int(tool_input.get("end_line") or 0)
    text = target.read_text(encoding="utf-8", errors="ignore")
    lines = text.splitlines()
    if end_line <= 0:
        end_line = min(len(lines), start_line + 199)
    selected = lines[start_line - 1 : end_line]
    numbered = [f"{index}: {line}" for index, line in enumerate(selected, start=start_line)]
    context = "\n".join(numbered)
    return {
        "tool": "read_file",
        "summary": f"Read {len(selected)} line(s) from {target.relative_to(WORKSPACE_ROOT).as_posix()} ({start_line}-{end_line}).",
        "context": _truncate_text(context, MAX_FILE_READ_CHARS),
        "path": str(target),
        "line_start": start_line,
        "line_end": end_line,
    }


async def _execute_write_file(tool_input: dict[str, Any]) -> dict[str, Any]:
    if not WRITE_TOOLS_ENABLED:
        raise RuntimeError("workspace write tools are disabled")
    target = _resolve_workspace_path(str(tool_input.get("path") or ""))
    content = str(tool_input.get("content") or "")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return {
        "tool": "write_file",
        "summary": f"Wrote {len(content)} character(s) to {target.relative_to(WORKSPACE_ROOT).as_posix()}.",
        "path": str(target),
    }


async def _execute_append_file(tool_input: dict[str, Any]) -> dict[str, Any]:
    if not WRITE_TOOLS_ENABLED:
        raise RuntimeError("workspace write tools are disabled")
    target = _resolve_workspace_path(str(tool_input.get("path") or ""))
    content = str(tool_input.get("content") or "")
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(content)
    return {
        "tool": "append_file",
        "summary": f"Appended {len(content)} character(s) to {target.relative_to(WORKSPACE_ROOT).as_posix()}.",
        "path": str(target),
    }


def _run_shell_command(command: str, cwd: Path, timeout_seconds: int) -> dict[str, Any]:
    if not command.strip():
        raise ValueError("command is required")

    shell_executable = shutil.which("bash") or shutil.which("sh")
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        shell=True,
        executable=shell_executable,
        capture_output=True,
        text=True,
        timeout=max(1, timeout_seconds),
    )
    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    combined = stdout.strip()
    if stderr.strip():
        combined = f"{combined}\n\nSTDERR:\n{stderr.strip()}".strip()

    return {
        "returncode": completed.returncode,
        "stdout": _truncate_text(stdout, MAX_COMMAND_OUTPUT_CHARS),
        "stderr": _truncate_text(stderr, MAX_COMMAND_OUTPUT_CHARS),
        "combined": _truncate_text(combined, MAX_COMMAND_OUTPUT_CHARS),
    }


async def _execute_run_command(tool_input: dict[str, Any]) -> dict[str, Any]:
    if not SHELL_TOOLS_ENABLED:
        raise RuntimeError("shell tools are disabled")

    command = str(tool_input.get("command") or "").strip()
    cwd_input = str(tool_input.get("cwd") or ".").strip() or "."
    timeout_seconds = int(tool_input.get("timeout_seconds") or DEFAULT_AGENT_TIMEOUT_SECONDS)
    cwd = _resolve_workspace_path(cwd_input)
    if cwd.is_file():
        cwd = cwd.parent
    if not cwd.exists():
        raise FileNotFoundError(str(cwd))

    result = await asyncio.to_thread(_run_shell_command, command, cwd, timeout_seconds)
    summary = f"Command finished with exit code {result['returncode']}."
    if result["returncode"] != 0:
        summary = f"Command failed with exit code {result['returncode']}."

    return {
        "tool": "run_command",
        "summary": summary,
        "command": command,
        "cwd": str(cwd),
        "returncode": result["returncode"],
        "stdout": result["stdout"],
        "stderr": result["stderr"],
        "context": result["combined"],
    }


def _fetch_url(url: str) -> dict[str, Any]:
    if not url:
        raise ValueError("url is required")
    req = urllib_request.Request(
        url,
        headers={
            "User-Agent": "Whisper-Agent/1.0 (+https://huggingface.co/spaces)",
            "Accept": "text/plain,text/html,application/json;q=0.9,*/*;q=0.8",
        },
    )
    with urllib_request.urlopen(req, timeout=30) as response:
        content_type = str(response.headers.get("Content-Type") or "").lower()
        raw = response.read(MAX_FILE_READ_CHARS * 2)
        charset = "utf-8"
        if "charset=" in content_type:
            charset = content_type.split("charset=", 1)[1].split(";", 1)[0].strip() or "utf-8"
        text = raw.decode(charset, errors="ignore")
        if "html" in content_type:
            text = _strip_html(text)
        return {
            "status_code": getattr(response, "status", None) or response.getcode(),
            "content_type": content_type,
            "content": _truncate_text(text, MAX_FILE_READ_CHARS),
        }


async def _execute_web_fetch(tool_input: dict[str, Any]) -> dict[str, Any]:
    if not HTTP_FETCH_ENABLED:
        raise RuntimeError("web fetch is disabled")
    url = str(tool_input.get("url") or "").strip()
    result = await asyncio.to_thread(_fetch_url, url)
    return {
        "tool": "web_fetch",
        "summary": f"Fetched {url} with status {result['status_code']}.",
        "url": url,
        "status_code": result["status_code"],
        "content_type": result["content_type"],
        "context": result["content"],
    }


async def _execute_tool(
    tool_name: str,
    *,
    payload: AgentRunRequestPayload,
    app_state,
    tool_input: dict[str, Any],
) -> dict[str, Any]:
    if tool_name == "runtime_status":
        return await _execute_runtime_status(app_state)
    if tool_name == "runtime_profiles":
        return await _execute_runtime_profiles(app_state)
    if tool_name == "runtime_select_profile":
        return await _execute_runtime_select_profile(app_state, tool_input)
    if tool_name == "runtime_validate_profile":
        return await _execute_runtime_validate_profile(tool_input)
    if tool_name == "runtime_download_profile":
        return await _execute_runtime_download_profile(tool_input)
    if tool_name == "model_catalog":
        return await _execute_model_catalog(tool_input)
    if tool_name == "set_image_model":
        return await _execute_set_image_model(tool_input)
    if tool_name == "dataset_import_hf":
        return await _execute_dataset_import_hf(tool_input)
    if tool_name == "knowledge_search":
        return await _execute_knowledge_search(payload, app_state, tool_input)
    if tool_name == "web_research":
        return await _execute_web_research(payload, app_state, tool_input)
    if tool_name == "image_generate":
        return await _execute_image_generate(payload, tool_input)
    if tool_name == "list_directory":
        return await _execute_list_directory(tool_input)
    if tool_name == "search_files":
        return await _execute_search_files(tool_input)
    if tool_name == "read_file":
        return await _execute_read_file(tool_input)
    if tool_name == "write_file":
        return await _execute_write_file(tool_input)
    if tool_name == "append_file":
        return await _execute_append_file(tool_input)
    if tool_name == "run_command":
        return await _execute_run_command(tool_input)
    if tool_name == "web_fetch":
        return await _execute_web_fetch(tool_input)
    raise ValueError(f"Unsupported tool '{tool_name}'")


def _build_final_prompt(
    payload: AgentRunRequestPayload,
    *,
    tool_results: list[dict[str, Any]],
    citations: list[dict[str, Any]],
) -> str:
    summarized_results = []
    for item in tool_results[-8:]:
        summarized_results.append(
            {
                "tool": item.get("tool"),
                "summary": item.get("summary"),
                "context": _truncate_text(
                    item.get("context")
                    or item.get("stdout")
                    or item.get("answer")
                    or item.get("content")
                    or "",
                    2400,
                ),
            }
        )

    instructions = {
        "task": payload.message,
        "context": payload.context,
        "roleplay_mode": payload.roleplay_mode,
        "nsfw_mode": payload.nsfw_mode,
        "tool_results": summarized_results,
        "citations": citations[:12],
        "rules": [
            "Answer directly and concisely.",
            "If tool output is incomplete, say what is missing.",
            "Do not mention internal chain-of-thought.",
            "If relevant, include concrete file paths or command results.",
        ],
    }
    return (
        "You are Whisper Agent. Write the final user-facing response for this task.\n\n"
        f"{json.dumps(instructions, ensure_ascii=False, indent=2)}"
    )


async def _finalize_answer(
    payload: AgentRunRequestPayload,
    *,
    backend: str,
    app_state,
    tool_results: list[dict[str, Any]],
    citations: list[dict[str, Any]],
    planner_answer: str = "",
) -> str:
    if planner_answer.strip():
        return planner_answer.strip()

    prompt = _build_final_prompt(payload, tool_results=tool_results, citations=citations)
    try:
        answer = await _generate_with_backend(
            backend=backend,
            prompt=prompt,
            app_state=app_state,
            max_tokens=max(220, min(payload.max_tokens, 512)),
            temperature=0.35,
            user_id=payload.user_id,
        )
        if answer.strip():
            return answer.strip()
    except Exception as exc:
        logger.warning(f"Agent finalizer fell back to tool summaries: {exc}")

    if tool_results:
        return "\n\n".join(
            item.get("summary") or _tool_result_summary(item) for item in tool_results if _tool_result_summary(item)
        ).strip()
    return "I could not produce a final answer for that task."


def _update_plan_entry(session: dict[str, Any], tool_name: str, status: str, output_preview: str = "") -> None:
    for step in session.get("plan", []):
        if step.get("tool") == tool_name and step.get("status") in {"pending", "running"}:
            step["status"] = status
            if output_preview:
                step["output_preview"] = _message_preview(output_preview, 180)
            return


def _mark_final_step(session: dict[str, Any], status: str, output_preview: str = "") -> None:
    for step in session.get("plan", []):
        if step.get("tool") == "final_answer":
            step["status"] = status
            if output_preview:
                step["output_preview"] = _message_preview(output_preview, 180)
            return


async def _run_agent_session(
    session_id: str,
    *,
    payload: AgentRunRequestPayload,
    backend: str,
    app_state,
) -> None:
    session = _load_session(session_id)
    if session is None:
        return

    available_tools = _available_tools(payload)
    session["status"] = "running"
    session["plan"] = _default_plan(payload)
    session["tool_results"] = []
    session["citations"] = []
    session["answer"] = ""
    session["image_url"] = None
    session["error"] = None
    session["current_tool"] = None
    session["current_step_index"] = 0
    session.setdefault("runs", []).append(
        {
            "started_at": time.time(),
            "backend": backend,
            "goal": payload.message,
        }
    )
    _append_event(session, "status", "Agent session started", backend=backend)
    _save_session(session)

    try:
        planner_answer = ""
        for step_index in range(max(1, payload.max_steps)):
            session = _load_session(session_id) or session
            if session.get("cancel_requested"):
                raise asyncio.CancelledError()

            action = await _decide_next_action(
                payload,
                backend=backend,
                app_state=app_state,
                step_index=step_index,
                tool_results=session.get("tool_results", []),
                available_tools=available_tools,
            )
            session["current_step_index"] = step_index

            if action.get("kind") == "final":
                planner_answer = str(action.get("answer") or "").strip()
                _mark_final_step(session, "running", planner_answer or "Synthesizing final response")
                _append_event(
                    session,
                    "finalize",
                    "Agent is preparing the final answer",
                    reason=action.get("reason"),
                )
                _save_session(session)
                break

            tool_name = str(action.get("tool") or "").strip()
            tool_input = action.get("input") or {}
            session["current_tool"] = tool_name
            _update_plan_entry(session, tool_name, "running", action.get("reason") or "")
            _append_event(
                session,
                "tool_start",
                f"Running tool: {tool_name}",
                tool=tool_name,
                tool_input=tool_input,
                reason=action.get("reason"),
            )
            _save_session(session)

            try:
                result = await _execute_tool(
                    tool_name,
                    payload=payload,
                    app_state=app_state,
                    tool_input=tool_input,
                )
                session = _load_session(session_id) or session
                session.setdefault("tool_results", []).append(result)
                if result.get("image_url"):
                    session["image_url"] = result.get("image_url")

                for source in result.get("sources") or []:
                    if source not in session.setdefault("citations", []):
                        session["citations"].append(source)

                preview = _tool_result_summary(result)
                _update_plan_entry(session, tool_name, "completed", preview)
                _append_event(
                    session,
                    "tool_complete",
                    f"Completed tool: {tool_name}",
                    tool=tool_name,
                    summary=result.get("summary"),
                )
            except Exception as exc:
                session = _load_session(session_id) or session
                failure = {
                    "tool": tool_name,
                    "summary": f"Tool failed: {exc}",
                    "error": str(exc),
                }
                session.setdefault("tool_results", []).append(failure)
                _update_plan_entry(session, tool_name, "failed", str(exc))
                _append_event(
                    session,
                    "tool_failed",
                    f"Tool failed: {tool_name}",
                    tool=tool_name,
                    error=str(exc),
                )
                logger.warning(f"Agent tool '{tool_name}' failed: {exc}")
            finally:
                session["current_tool"] = None
                _save_session(session)

        session = _load_session(session_id) or session
        final_answer = await _finalize_answer(
            payload,
            backend=backend,
            app_state=app_state,
            tool_results=session.get("tool_results", []),
            citations=session.get("citations", []),
            planner_answer=planner_answer,
        )
        session["answer"] = final_answer
        session["status"] = "completed"
        session["current_tool"] = None
        _mark_final_step(session, "completed", final_answer)
        _append_event(session, "status", "Agent session completed")
        if session.get("runs"):
            session["runs"][-1]["completed_at"] = time.time()
            session["runs"][-1]["status"] = "completed"
        _save_session(session)
    except asyncio.CancelledError:
        session = _load_session(session_id) or session
        session["status"] = "cancelled"
        session["current_tool"] = None
        session["error"] = None
        _mark_final_step(session, "failed", "Cancelled")
        _append_event(session, "status", "Agent session cancelled")
        if session.get("runs"):
            session["runs"][-1]["completed_at"] = time.time()
            session["runs"][-1]["status"] = "cancelled"
        _save_session(session)
        raise
    except Exception as exc:
        session = _load_session(session_id) or session
        session["status"] = "failed"
        session["current_tool"] = None
        session["error"] = str(exc)
        _mark_final_step(session, "failed", str(exc))
        _append_event(session, "status", "Agent session failed", error=str(exc))
        if session.get("runs"):
            session["runs"][-1]["completed_at"] = time.time()
            session["runs"][-1]["status"] = "failed"
        _save_session(session)
        logger.exception(f"Agent session {session_id} failed: {exc}")
    finally:
        async with _RUNNING_AGENT_LOCK:
            _RUNNING_AGENT_TASKS.pop(session_id, None)


async def _ensure_agent_task(
    session_id: str,
    *,
    payload: AgentRunRequestPayload,
    backend: str,
    app_state,
) -> asyncio.Task:
    async with _RUNNING_AGENT_LOCK:
        existing = _RUNNING_AGENT_TASKS.get(session_id)
        if existing is not None and not existing.done():
            return existing

        task = asyncio.create_task(
            _run_agent_session(
                session_id,
                payload=payload,
                backend=backend,
                app_state=app_state,
            )
        )
        _RUNNING_AGENT_TASKS[session_id] = task
        return task


async def run_agent(
    payload: AgentRunRequestPayload,
    app_state,
    *,
    wait_for_completion: bool = False,
) -> dict[str, Any]:
    backend = payload.backend if payload.backend in SUPPORTED_AGENT_BACKENDS else "server"
    existing = _load_session(payload.session_id) if payload.session_id else None
    session = _new_or_reset_session(payload, backend=backend, existing=existing)
    _save_session(session)

    task = await _ensure_agent_task(
        session["id"],
        payload=payload,
        backend=backend,
        app_state=app_state,
    )
    if wait_for_completion:
        try:
            await task
        except asyncio.CancelledError:
            pass
        return get_agent_session(session["id"]) or session

    queued = get_agent_session(session["id"]) or session
    if queued.get("status") == "queued":
        queued["status"] = "running"
    return queued


def list_agent_sessions(limit: int = 20) -> list[dict[str, Any]]:
    sessions: list[dict[str, Any]] = []
    for path in sorted(
        AGENT_SESSION_DIR.glob("*.json"),
        key=lambda item: item.stat().st_mtime if item.exists() else 0,
        reverse=True,
    )[: max(1, limit)]:
        session = _load_session(path.stem)
        if session is None:
            continue
        sessions.append(
            {
                "id": session.get("id"),
                "goal": session.get("goal"),
                "status": session.get("status"),
                "backend_resolved": session.get("backend_resolved"),
                "updated_at": session.get("updated_at"),
                "image_url": session.get("image_url"),
                "answer_preview": _message_preview(session.get("answer") or "", 160),
            }
        )
    return sessions


def get_agent_session(session_id: str) -> Optional[dict[str, Any]]:
    return _load_session(session_id)


async def cancel_agent_session(session_id: str) -> Optional[dict[str, Any]]:
    session = _load_session(session_id)
    if session is None:
        return None

    session["cancel_requested"] = True
    if session.get("status") in {"queued", "running"}:
        session["status"] = "cancelling"
    _append_event(session, "status", "Cancellation requested")
    _save_session(session)

    async with _RUNNING_AGENT_LOCK:
        task = _RUNNING_AGENT_TASKS.get(session_id)
        if task is not None and not task.done():
            task.cancel()

    return get_agent_session(session_id)
