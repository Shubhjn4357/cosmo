"""
Whisper AI - Chat API Routes.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse


router = APIRouter()

DEFAULT_SYSTEM_PROMPT = (
    "You are Whisper AI, a direct coding and research assistant. "
    "Give accurate, useful answers with minimal filler. "
    "When the user asks for a short answer, keep it short. "
    "Do not repeat yourself, do not restate the same fact in multiple ways, "
    "and do not invent sources. "
    "If code is needed, prefer practical code or concrete steps."
)


class ChatRequest(BaseModel):
    """Chat request model."""
    message: str
    history: Optional[list[dict[str, str]]] = None  # List of {"role": "user"|"assistant", "content": "..."}
    context: Optional[str] = None
    use_rag: bool = True
    temperature: float = 0.8
    max_tokens: int = 256
    top_k: int = 50
    top_p: float = 0.9
    system_prompt: Optional[str] = None  # Personality prompt from client
    # Token system parameters
    is_local: bool = True  # Default to local (free)
    user_id: Optional[str] = None  # User ID if logged in
    session_id: Optional[str] = None  # Session ID for guests


class ChatResponse(BaseModel):
    """Chat response model."""
    response: str
    tokens_used: int
    sources: list[dict] = Field(default_factory=list)
    model_used: Optional[str] = None
    backend: Optional[str] = None


def _build_prompt(
    request: ChatRequest,
    state,
    *,
    knowledge_context: Optional[str] = None,
    knowledge_sources: Optional[list[dict[str, Any]]] = None,
) -> tuple[str, list[dict]]:
    sources: list[dict] = list(knowledge_sources or [])
    system_sections: list[str] = [request.system_prompt or DEFAULT_SYSTEM_PROMPT]

    if request.context:
        system_sections.append(f"Additional context:\n{request.context}")

    knowledge_resolved = knowledge_context is not None or knowledge_sources is not None
    if knowledge_resolved:
        if knowledge_context:
            system_sections.append(f"Knowledge:\n{knowledge_context}")
            system_sections.append(
                "Use the knowledge section first. Convert raw retrieved facts into a concise, presentable answer."
            )
    elif request.use_rag and state.rag is not None:
        try:
            context, sources = state.rag.build_context(request.message)
            if context:
                system_sections.append(f"Knowledge:\n{context}")
        except Exception as exc:
            logger.warning(f"RAG retrieval failed: {exc}")

    prompt_parts: list[str] = [
        "<|im_start|>system",
        "\n\n".join(system_sections),
        "<|im_end|>",
    ]

    if request.history:
        for turn in request.history[-8:]:
            role = turn.get("role", "user")
            content = turn.get("content", "").strip()
            if not content:
                continue
            label = "assistant" if role == "assistant" else "user"
            prompt_parts.extend(
                [
                    f"<|im_start|>{label}",
                    content,
                    "<|im_end|>",
                ]
            )

    prompt_parts.extend(
        [
            "<|im_start|>user",
            request.message,
            "<|im_end|>",
            "<|im_start|>assistant",
        ]
    )

    return "\n\n".join(prompt_parts), sources


async def _resolve_knowledge_context(request: ChatRequest, state) -> tuple[str, list[dict]]:
    if not request.use_rag or state.rag is None:
        return "", []

    try:
        context, sources = state.rag.build_context(request.message)
    except Exception as exc:
        logger.warning(f"RAG retrieval failed: {exc}")
        context, sources = "", []

    min_context_chars = max(0, int(os.getenv("WHISPER_WEB_FALLBACK_MIN_CONTEXT_CHARS", "160")))
    if len((context or "").strip()) >= min_context_chars:
        return context, sources

    web_fallback_enabled = os.getenv("WHISPER_ENABLE_WEB_KNOWLEDGE_FALLBACK", "true").lower() == "true"
    if not web_fallback_enabled or not request.message.strip():
        return context, sources

    try:
        from api.routes.research import DiscoverRequest, _discover_and_ingest

        fallback_request = DiscoverRequest(
            topic=request.message.strip(),
            max_pages=max(1, int(os.getenv("WHISPER_WEB_FALLBACK_MAX_PAGES", "2"))),
            provider=os.getenv("WHISPER_WEB_FALLBACK_PROVIDER", "auto"),
            max_sites=max(1, int(os.getenv("WHISPER_WEB_FALLBACK_MAX_SITES", "1"))),
            depth=max(1, int(os.getenv("WHISPER_WEB_FALLBACK_DEPTH", "1"))),
            render=os.getenv("WHISPER_WEB_FALLBACK_RENDER", "false").lower() == "true",
            refresh_existing=os.getenv("WHISPER_WEB_FALLBACK_REFRESH_EXISTING", "false").lower() == "true",
        )
        logger.info(f"Knowledge fallback triggered for chat topic: {request.message[:120]}")
        await _discover_and_ingest(fallback_request)
    except Exception as exc:
        logger.warning(f"Knowledge web fallback failed: {exc}")
        return context, sources

    try:
        refreshed_context, refreshed_sources = state.rag.build_context(request.message)
        if refreshed_context or refreshed_sources:
            return refreshed_context, refreshed_sources
    except Exception as exc:
        logger.warning(f"RAG refresh after web fallback failed: {exc}")

    return context, sources


def _record_chat_interaction(
    request: ChatRequest,
    response_text: str,
    result: dict,
    sources: list[dict],
    *,
    learning_source: Optional[str] = None,
):
    from api.routes.learn import save_training_pair
    from api.routes.profile import get_supabase

    save_training_pair(
        request.message,
        response_text,
        source=learning_source or result.get("model_used", "local"),
        metadata={
            "backend": result.get("backend"),
            "user_id": request.user_id,
            "session_id": request.session_id,
        },
    )

    try:
        supabase = get_supabase()
        if supabase is not None:
            supabase.table("chats").insert(
                {
                    "user_id": request.user_id,
                    "session_id": request.session_id,
                    "prompt": request.message,
                    "response": response_text,
                    "model_used": result.get("model_used"),
                    "backend": result.get("backend"),
                }
            ).execute()
    except Exception as log_exc:
        logger.warning(f"Failed to log chat interaction: {log_exc}")


def _self_learner_output_is_usable(text: str) -> bool:
    stripped = (text or "").strip()
    if len(stripped) < 12:
        return False

    alpha_count = sum(1 for char in stripped if char.isalpha())
    unique_chars = len(set(stripped.lower()))
    return alpha_count >= 6 and unique_chars >= 4


def _load_self_learner_state() -> dict:
    from services.runtime_manager import SELF_LEARNER_STATE

    if not SELF_LEARNER_STATE.exists():
        return {}

    try:
        return json.loads(SELF_LEARNER_STATE.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning(f"Failed to read self-learner state: {exc}")
        return {}


@router.post("/chat")
async def chat(request: ChatRequest) -> ChatResponse:
    """
    Generate a text response.
    
    Args:
        request: Chat request with message and options
    
    Returns:
        Generated response with metadata
    """
    from api.route import get_app_state
    from api.routes.profile import get_supabase
    from services.token_service import check_and_use_tokens
    
    # CHECK TOKENS - Local is free, cloud costs tokens
    token_result = await check_and_use_tokens(
        supabase=get_supabase() if request.user_id else None,
        feature='chat',
        is_local=request.is_local,
        is_smart=False,
        user_id=request.user_id,
        session_id=request.session_id
    )
    
    if not token_result.get('success'):
        raise HTTPException(
            status_code=403 if 'insufficient' in token_result.get('error', '') else 401,
            detail=token_result
        )
    
    state = get_app_state()
    
    if state.chat_runtime is None:
        raise HTTPException(status_code=503, detail="Chat runtime not configured")

    knowledge_context, knowledge_sources = await _resolve_knowledge_context(request, state)
    prompt, sources = _build_prompt(
        request,
        state,
        knowledge_context=knowledge_context,
        knowledge_sources=knowledge_sources,
    )
    
    try:
        result = await asyncio.to_thread(
            state.chat_runtime.generate,
            prompt,
            request.max_tokens,
            request.temperature,
            request.top_p,
        )
        response_text = (result.get("text") or "").strip()
        if not response_text:
            raise HTTPException(status_code=502, detail="Model returned an empty response")

        _record_chat_interaction(request, response_text, result, sources)
        
        return ChatResponse(
            response=response_text,
            tokens_used=max(1, len(response_text.split())),
            sources=[{"source": s.get("source", "unknown")} for s in sources[:5]],
            model_used=result.get("model_used"),
            backend=result.get("backend"),
        )
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Generation failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/chat/self-learner")
async def chat_self_learner(request: ChatRequest) -> ChatResponse:
    """
    Generate a response using the built-in scratch Whisper transformer.
    """
    from api.route import get_app_state
    from api.routes.profile import get_supabase
    from services.runtime_manager import get_self_learner_runtime_manager
    from services.token_service import check_and_use_tokens

    token_result = await check_and_use_tokens(
        supabase=get_supabase() if request.user_id else None,
        feature='chat',
        is_local=True,
        is_smart=False,
        user_id=request.user_id,
        session_id=request.session_id,
    )

    if not token_result.get('success'):
        raise HTTPException(
            status_code=403 if 'insufficient' in token_result.get('error', '') else 401,
            detail=token_result,
        )

    state = get_app_state()
    learner_state = _load_self_learner_state()
    min_steps = int(os.getenv("WHISPER_SELF_LEARNER_MIN_STEPS", "50"))
    min_sequences = int(os.getenv("WHISPER_SELF_LEARNER_MIN_SEQUENCES", "20"))

    if learner_state.get("steps", 0) < min_steps or learner_state.get("dataset_sequences", 0) < min_sequences:
        return ChatResponse(
            response=(
                "Self-learner mode is online, but the built-in transformer is still warming up. "
                f"Current progress: {learner_state.get('steps', 0)}/{min_steps} training steps and "
                f"{learner_state.get('dataset_sequences', 0)}/{min_sequences} dataset sequences."
            ),
            tokens_used=0,
            sources=[],
            model_used="whisper-micro-transformer",
            backend="micro_transformer",
        )

    knowledge_context, knowledge_sources = await _resolve_knowledge_context(request, state)
    prompt, sources = _build_prompt(
        request,
        state,
        knowledge_context=knowledge_context,
        knowledge_sources=knowledge_sources,
    )
    runtime = get_self_learner_runtime_manager()

    try:
        result = await asyncio.to_thread(
            runtime.generate,
            prompt,
            min(request.max_tokens, 384),
            request.temperature,
            request.top_p,
        )
        response_text = (result.get("text") or "").strip()
        if not _self_learner_output_is_usable(response_text):
            return ChatResponse(
                response=(
                    "Self-learner mode is online, but the built-in transformer still needs more training "
                    "before it can answer reliably. Run a longer training pass or add more learned pairs."
                ),
                tokens_used=0,
                sources=[],
                model_used=result.get("model_used"),
                backend=result.get("backend"),
            )

        _record_chat_interaction(
            request,
            response_text,
            result,
            sources,
            learning_source="self-learner",
        )

        return ChatResponse(
            response=response_text,
            tokens_used=max(1, len(response_text.split())),
            sources=[{"source": s.get("source", "unknown")} for s in sources[:5]],
            model_used=result.get("model_used"),
            backend=result.get("backend"),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Self-learner generation failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/chat/self-learner/status")
async def self_learner_status():
    from services.runtime_manager import (
        SELF_LEARNER_CHECKPOINT,
        SELF_LEARNER_INT8_CHECKPOINT,
        SELF_LEARNER_STATE,
        SELF_LEARNER_TOKENIZER,
        get_self_learner_runtime_manager,
    )

    runtime = get_self_learner_runtime_manager()
    readiness = runtime.readiness()
    learner_state = _load_self_learner_state()
    min_steps = int(os.getenv("WHISPER_SELF_LEARNER_MIN_STEPS", "50"))
    min_sequences = int(os.getenv("WHISPER_SELF_LEARNER_MIN_SEQUENCES", "20"))
    chat_ready = (
        readiness.get("can_load", False)
        and learner_state.get("steps", 0) >= min_steps
        and learner_state.get("dataset_sequences", 0) >= min_sequences
    )
    return {
        "ready": readiness.get("can_load", False),
        "chat_ready": chat_ready,
        "summary": readiness.get("summary"),
        "training_state": learner_state,
        "runtime": runtime.status(),
        "artifacts": {
            "checkpoint": {
                "path": str(SELF_LEARNER_CHECKPOINT),
                "exists": SELF_LEARNER_CHECKPOINT.exists(),
            },
            "quantized_checkpoint": {
                "path": str(SELF_LEARNER_INT8_CHECKPOINT),
                "exists": SELF_LEARNER_INT8_CHECKPOINT.exists(),
            },
            "tokenizer": {
                "path": str(SELF_LEARNER_TOKENIZER),
                "exists": SELF_LEARNER_TOKENIZER.exists(),
            },
            "state": {
                "path": str(SELF_LEARNER_STATE),
                "exists": SELF_LEARNER_STATE.exists(),
            },
        },
    }


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Stream a text response token by token.
    
    Uses Server-Sent Events (SSE) for real-time streaming.
    """
    from api.route import get_app_state
    
    state = get_app_state()
    
    async def generate():
        if state.chat_runtime is None:
            yield {"data": "[ERROR] Chat runtime not configured"}
            return

        try:
            knowledge_context, knowledge_sources = await _resolve_knowledge_context(request, state)
            prompt, _ = _build_prompt(
                request,
                state,
                knowledge_context=knowledge_context,
                knowledge_sources=knowledge_sources,
            )
            result = await asyncio.to_thread(
                state.chat_runtime.generate,
                prompt,
                request.max_tokens,
                request.temperature,
                request.top_p,
            )
            response_text = (result.get("text") or "").strip()
            for token in response_text.split():
                yield {"data": f"{token} "}
                await asyncio.sleep(0)
        except Exception as exc:
            logger.error(f"Streaming generation failed: {exc}")
            yield {"data": f"[ERROR] {exc}"}

        yield {"data": "[DONE]"}
    
    return EventSourceResponse(generate())


class CorrectionRequest(BaseModel):
    """Correction request for learning from mistakes."""
    input_text: str
    expected_output: str
    actual_output: str


@router.post("/chat/correct")
async def correct_response(request: CorrectionRequest):
    """
    Submit a correction to learn from mistakes.
    
    This creates training data for future improvement.
    """
    from api.route import get_app_state
    import json
    from utils.app_paths import DATA_ROOT, ensure_app_dirs
    
    state = get_app_state()
    
    # Log the correction
    ensure_app_dirs()
    corrections_path = DATA_ROOT / "feedback.jsonl"
    corrections_path.parent.mkdir(parents=True, exist_ok=True)
    
    correction = {
        "input": request.input_text,
        "expected": request.expected_output,
        "actual": request.actual_output
    }
    
    with open(corrections_path, "a") as f:
        f.write(json.dumps(correction) + "\n")
    
    logger.info(f"Recorded correction for learning")
    
    return {"status": "recorded", "message": "Thank you! I'll learn from this."}


# =============================================================================
# Training Data Sync (from mobile devices)
# =============================================================================

class TrainingSyncRequest(BaseModel):
    """Training data from mobile on-device models."""
    pairs: list  # List of {input: str, output: str, model: str}
    device_id: str = "unknown"


@router.post("/training/sync")
async def sync_training_data(request: TrainingSyncRequest):
    """
    Receive training data from mobile devices.
    
    Mobile apps run LLMs locally and sync conversation pairs
    here to train the Whisper server model.
    """
    try:
        from api.routes.learn import save_training_pair

        count = 0
        for pair in request.pairs:
            if "input" in pair and "output" in pair:
                save_training_pair(
                    pair["input"],
                    pair["output"],
                    source=pair.get("model", "mobile"),
                )
                count += 1
        
        logger.info(f"Synced {count} training pairs from device {request.device_id}")
        return {"status": "success", "synced": count}
        
    except Exception as e:
        logger.error(f"Training sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
