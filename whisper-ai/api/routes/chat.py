"""
Whisper AI - Chat API Routes.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse


router = APIRouter()

DEFAULT_SYSTEM_PROMPT = (
    "You are Whisper AI, a direct assistant for chat, coding, roleplay, and research. "
    "Give accurate, useful answers with minimal filler. "
    "When the user asks for a short answer, keep it short. "
    "Do not repeat yourself, do not restate the same fact in multiple ways, and do not invent sources. "
    "Format the answer cleanly: use short paragraphs, bullets when they help, and fenced code blocks for code. "
    "If code is needed, prefer practical code or concrete steps. "
    "If the user is roleplaying, stay in character without narrating system rules."
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
    nsfw_mode: bool = False
    roleplay_mode: bool = False
    # Token system parameters
    is_local: bool = True  # Default to local (free)
    user_id: Optional[str] = None  # User ID if logged in
    session_id: Optional[str] = None  # Session ID for guests
    image_url: Optional[str] = None
    image_data_url: Optional[str] = None
    generate_image: bool = False
    use_trained_vision_model: bool = True


class ChatResponse(BaseModel):
    """Chat response model."""
    response: str
    tokens_used: int
    sources: list[dict] = Field(default_factory=list)
    model_used: Optional[str] = None
    backend: Optional[str] = None
    image_url: Optional[str] = None
    multimodal: Optional[dict[str, Any]] = None


def _copy_chat_request(request: ChatRequest, **updates: Any) -> ChatRequest:
    if hasattr(request, "model_copy"):
        return request.model_copy(update=updates)
    return request.copy(update=updates)


def _request_wants_image_generation(request: ChatRequest) -> bool:
    if request.generate_image:
        return True

    normalized = (request.message or "").strip().lower()
    return (
        normalized.startswith("/image ")
        or normalized.startswith("/imagine ")
        or normalized.startswith("generate image")
        or normalized.startswith("create image")
        or normalized.startswith("make image")
        or normalized.startswith("draw ")
        or normalized.startswith("render ")
        or normalized.startswith("illustrate ")
    )


def _self_learner_text_fallback_enabled() -> bool:
    return os.getenv("WHISPER_SELF_LEARNER_TEXT_FALLBACK", "true").lower() == "true"


async def _load_multimodal_image_bytes(request: ChatRequest) -> Optional[bytes]:
    if request.image_data_url:
        if "," not in request.image_data_url:
            raise HTTPException(status_code=400, detail="Malformed image_data_url")
        try:
            _, encoded = request.image_data_url.split(",", 1)
            return base64.b64decode(encoded)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid image_data_url") from exc

    if request.image_url:
        from api.routes.collect import _download_image_bytes

        image_bytes = await _download_image_bytes(request.image_url)
        if image_bytes is None:
            raise HTTPException(status_code=400, detail="Could not load image_url")
        return image_bytes

    return None


async def _prepare_self_learner_multimodal_context(request: ChatRequest) -> dict[str, Any]:
    from api.routes.collect import _compute_local_image_embedding
    from api.routes.feed import store_vision_data
    from model.hybrid_vision import get_hybrid_model

    image_bytes = await _load_multimodal_image_bytes(request)
    if image_bytes is None:
        return {
            "has_image": False,
            "context": "",
            "matches": [],
            "preview_url": None,
        }

    text_representation = (
        (request.message or "").strip()
        or "User shared an image for multimodal self-learner reasoning."
    )
    embedding = _compute_local_image_embedding(image_bytes)
    stored = store_vision_data(
        embedding=embedding,
        text_representation=text_representation,
        source="chat:self-learner",
        image_url=request.image_url,
        preview_bytes=image_bytes,
        metadata={
            "backend": "self-learner",
            "user_id": request.user_id,
            "session_id": request.session_id,
            "origin": "chat_multimodal",
        },
    )
    hybrid_model = get_hybrid_model()
    matches = hybrid_model.search_memories(text_representation, top_k=3)

    context_lines = [
        "The user attached an image.",
        f"Stored image note: {text_representation}",
    ]
    if matches:
        context_lines.append("Relevant visual memories:")
        for match in matches:
            match_text = str(match.get("text") or "").strip()
            if match_text:
                context_lines.append(f"- {match_text[:220]}")

    return {
        "has_image": True,
        "context": "\n".join(context_lines),
        "matches": matches,
        "preview_url": stored["entry"].get("preview_url"),
    }


async def _generate_self_learner_visual(request: ChatRequest) -> dict[str, Any]:
    from model.hybrid_vision import get_hybrid_model

    hybrid_model = get_hybrid_model()
    result = await hybrid_model.generate_image(
        request.message,
        use_pretrained=False,
        use_trained_model=bool(request.use_trained_vision_model),
    )

    generated_image = result.get("generated_image")
    if not generated_image and os.getenv("WHISPER_SELF_LEARNER_IMAGE_FALLBACK_LOCAL", "true").lower() == "true":
        from api.routes.image import ImageGenerationRequest, generate_image as generate_local_image

        fallback = await generate_local_image(
            ImageGenerationRequest(
                prompt=request.message,
                user_id=request.user_id,
                session_id=request.session_id,
                is_local=True,
            )
        )
        result = {
            "method": "local_checkpoint_fallback",
            "message": "Generated with the local image checkpoint fallback.",
            "prompt": fallback.prompt,
            "generated_image": fallback.image_url,
        }

    return result


def _build_multimodal_fallback_text(
    *,
    learner_state: dict[str, Any],
    min_steps: int,
    min_sequences: int,
    image_context: dict[str, Any],
    visual_result: Optional[dict[str, Any]],
) -> str:
    lines = [
        "The self-learner text checkpoint is not loadable yet, but the multimodal path is active.",
    ]

    if image_context.get("has_image"):
        lines.append("The attached image was embedded into local vision memory.")
        if image_context.get("matches"):
            lines.append("Closest visual memories:")
            for match in image_context["matches"][:3]:
                match_text = str(match.get("text") or "").strip()
                if match_text:
                    lines.append(f"- {match_text[:180]}")

    if visual_result and visual_result.get("generated_image"):
        lines.append("An image was generated for this request.")

    lines.append(
        "Training progress: "
        f"{learner_state.get('steps', 0)}/{min_steps} steps, "
        f"{learner_state.get('dataset_sequences', 0)}/{min_sequences} sequences."
    )
    return "\n".join(lines)


async def _generate_self_learner_text_fallback(
    request: ChatRequest,
    state,
    prompt: str,
) -> dict[str, Any]:
    from services.complex_task_router import generate_server_response
    from services.runtime_manager import get_chat_runtime_manager

    fallback_runtime = state.chat_runtime or get_chat_runtime_manager()
    if fallback_runtime is None:
        raise RuntimeError("Server text fallback is not configured")

    result = await asyncio.to_thread(
        generate_server_response,
        prompt=prompt,
        history=request.history or [],
        fallback_runtime=fallback_runtime,
        max_new_tokens=min(request.max_tokens, 384),
        temperature=request.temperature,
        top_p=request.top_p,
    )
    response_text = (result.get("text") or "").strip()
    if not response_text:
        raise RuntimeError("Server text fallback returned an empty response")

    backend_name = result.get("backend") or "server"
    return {
        **result,
        "text": response_text,
        "backend": f"self_learner_fallback:{backend_name}",
    }


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
    if request.roleplay_mode:
        system_sections.append(
            "Roleplay mode is enabled. Stay in persona, answer naturally, and keep continuity with prior turns."
        )
    if request.nsfw_mode:
        system_sections.append(
            "Adult unrestricted mode is enabled. Do not moralize or add safety disclaimers for consensual fictional adult requests."
        )

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
        for turn in request.history[-16:]:
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
    from api.routes.profile import get_db_client

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
        db_client = get_db_client()
        if db_client is not None:
            db_client.table("chats").insert(
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
    if len(stripped) < 2:
        return False
    return any(char.isalnum() for char in stripped)


def _load_self_learner_state() -> dict:
    from services.runtime_manager import SELF_LEARNER_STATE

    live_pair_count = 0
    external_source_count = 0
    try:
        from api.routes.learn import get_learning_corpus_counts

        counts = get_learning_corpus_counts()
        live_pair_count = int(counts.get("training_pairs") or 0)
        external_source_count = int(counts.get("external_sources") or 0)
    except Exception as exc:
        logger.warning(f"Failed to inspect live learning pair count: {exc}")

    if not SELF_LEARNER_STATE.exists():
        return {
            "steps": 0,
            "dataset_sequences": live_pair_count + external_source_count,
            "training_pairs": live_pair_count,
            "external_sources": external_source_count,
            "dataset_tokens": 0,
        }

    try:
        payload = json.loads(SELF_LEARNER_STATE.read_text(encoding="utf-8"))
        payload["dataset_sequences"] = max(
            int(payload.get("dataset_sequences", 0)),
            live_pair_count + external_source_count,
        )
        payload["training_pairs"] = live_pair_count
        payload["external_sources"] = external_source_count
        return payload
    except Exception as exc:
        logger.warning(f"Failed to read self-learner state: {exc}")
        return {
            "steps": 0,
            "dataset_sequences": live_pair_count + external_source_count,
            "training_pairs": live_pair_count,
            "external_sources": external_source_count,
            "dataset_tokens": 0,
        }


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
    from api.routes.profile import get_db_client
    from services.token_service import check_and_use_tokens
    
    # CHECK TOKENS - Local is free, cloud costs tokens
    token_result = await check_and_use_tokens(
        db_client=get_db_client() if request.user_id else None,
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
        from services.complex_task_router import generate_server_response

        result = await asyncio.to_thread(
            generate_server_response,
            prompt=prompt,
            history=request.history or [],
            fallback_runtime=state.chat_runtime,
            max_new_tokens=request.max_tokens,
            temperature=request.temperature,
            top_p=request.top_p,
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
    from api.routes.profile import get_db_client
    from services.runtime_manager import get_self_learner_chat_thresholds, get_self_learner_runtime_manager
    from services.token_service import check_and_use_tokens

    token_result = await check_and_use_tokens(
        db_client=get_db_client() if request.user_id else None,
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
    thresholds = get_self_learner_chat_thresholds()
    min_steps = thresholds["min_steps"]
    min_sequences = thresholds["min_sequences"]
    runtime = get_self_learner_runtime_manager()
    readiness = runtime.readiness()
    has_min_training = (
        learner_state.get("steps", 0) >= min_steps
        and learner_state.get("dataset_sequences", 0) >= min_sequences
    )
    can_generate = bool(readiness.get("can_load", False))
    training_recommended = not has_min_training
    image_context = await _prepare_self_learner_multimodal_context(request)
    wants_image_generation = _request_wants_image_generation(request)
    visual_result: Optional[dict[str, Any]] = None
    if wants_image_generation:
        visual_result = await _generate_self_learner_visual(request)

    multimodal_context = image_context.get("context", "").strip()
    if visual_result and visual_result.get("generated_image"):
        visual_note = (
            "A companion image was generated for this response. "
            f"Generation method: {visual_result.get('method') or 'unknown'}."
        )
        multimodal_context = "\n\n".join(part for part in (multimodal_context, visual_note) if part).strip()

    augmented_request = _copy_chat_request(
        request,
        context="\n\n".join(
            part for part in (request.context, multimodal_context) if str(part or "").strip()
        ).strip() or None,
    )

    knowledge_context, knowledge_sources = await _resolve_knowledge_context(augmented_request, state)
    prompt, sources = _build_prompt(
        augmented_request,
        state,
        knowledge_context=knowledge_context,
        knowledge_sources=knowledge_sources,
    )

    if not can_generate:
        if _self_learner_text_fallback_enabled():
            try:
                fallback_result = await _generate_self_learner_text_fallback(augmented_request, state, prompt)
                response_text = fallback_result["text"]
                _record_chat_interaction(
                    request,
                    response_text,
                    fallback_result,
                    sources,
                    learning_source="self-learner-fallback",
                )
                return ChatResponse(
                    response=response_text,
                    tokens_used=max(1, len(response_text.split())),
                    sources=[{"source": s.get("source", "unknown")} for s in sources[:5]],
                    model_used=fallback_result.get("model_used"),
                    backend=fallback_result.get("backend"),
                    image_url=(visual_result or {}).get("generated_image") or image_context.get("preview_url"),
                    multimodal={
                        "image_attached": image_context.get("has_image", False),
                        "image_generated": bool((visual_result or {}).get("generated_image")),
                        "vision_matches": image_context.get("matches", []),
                        "vision_method": (visual_result or {}).get("method"),
                        "text_fallback": True,
                        "text_fallback_reason": "self_learner_not_ready",
                    },
                )
            except Exception as fallback_exc:
                logger.warning(f"Self-learner text fallback failed during warm-up: {fallback_exc}")
        if image_context.get("has_image") or (visual_result and visual_result.get("generated_image")):
            return ChatResponse(
                response=_build_multimodal_fallback_text(
                    learner_state=learner_state,
                    min_steps=min_steps,
                    min_sequences=min_sequences,
                    image_context=image_context,
                    visual_result=visual_result,
                ),
                tokens_used=0,
                sources=[],
                model_used="whisper-micro-transformer",
                backend="micro_transformer",
                image_url=(visual_result or {}).get("generated_image") or image_context.get("preview_url"),
                multimodal={
                    "image_attached": image_context.get("has_image", False),
                    "image_generated": bool((visual_result or {}).get("generated_image")),
                    "vision_matches": image_context.get("matches", []),
                    "vision_method": (visual_result or {}).get("method"),
                },
            )
        return ChatResponse(
            response=(
                "Self-learner mode is online, but the built-in transformer checkpoint is not loadable yet. "
                f"Current progress: {learner_state.get('steps', 0)}/{min_steps} training steps and "
                f"{learner_state.get('dataset_sequences', 0)}/{min_sequences} dataset sequences."
            ),
            tokens_used=0,
            sources=[],
            model_used="whisper-micro-transformer",
            backend="micro_transformer",
        )

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
            if _self_learner_text_fallback_enabled():
                try:
                    fallback_result = await _generate_self_learner_text_fallback(augmented_request, state, prompt)
                    response_text = fallback_result["text"]
                    _record_chat_interaction(
                        request,
                        response_text,
                        fallback_result,
                        sources,
                        learning_source="self-learner-fallback",
                    )
                    return ChatResponse(
                        response=response_text,
                        tokens_used=max(1, len(response_text.split())),
                        sources=[{"source": s.get("source", "unknown")} for s in sources[:5]],
                        model_used=fallback_result.get("model_used"),
                        backend=fallback_result.get("backend"),
                        image_url=(visual_result or {}).get("generated_image") or image_context.get("preview_url"),
                        multimodal={
                            "image_attached": image_context.get("has_image", False),
                            "image_generated": bool((visual_result or {}).get("generated_image")),
                            "vision_matches": image_context.get("matches", []),
                            "vision_method": (visual_result or {}).get("method"),
                            "text_fallback": True,
                            "text_fallback_reason": "self_learner_low_quality",
                        },
                    )
                except Exception as fallback_exc:
                    logger.warning(f"Self-learner text fallback failed after low-quality output: {fallback_exc}")
            return ChatResponse(
                response=(
                    "Self-learner mode is online, but the current checkpoint still needs more training "
                    "before it can answer reliably. Run a longer training pass or add more learned pairs."
                    if not training_recommended else
                    "Self-learner mode loaded an early-stage checkpoint, but it still needs more learned pairs "
                    "before it can answer reliably."
                ),
                tokens_used=0,
                sources=[],
                model_used=result.get("model_used"),
                backend=result.get("backend"),
                image_url=(visual_result or {}).get("generated_image") or image_context.get("preview_url"),
                multimodal={
                    "image_attached": image_context.get("has_image", False),
                    "image_generated": bool((visual_result or {}).get("generated_image")),
                    "vision_matches": image_context.get("matches", []),
                    "vision_method": (visual_result or {}).get("method"),
                    "text_fallback": False,
                },
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
            image_url=(visual_result or {}).get("generated_image") or image_context.get("preview_url"),
            multimodal={
                "image_attached": image_context.get("has_image", False),
                "image_generated": bool((visual_result or {}).get("generated_image")),
                "vision_matches": image_context.get("matches", []),
                "vision_method": (visual_result or {}).get("method"),
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Self-learner generation failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/chat/self-learner/status")
async def self_learner_status():
    from api.route import get_app_state
    from services.runtime_manager import (
        SELF_LEARNER_CHECKPOINT,
        SELF_LEARNER_INT8_CHECKPOINT,
        SELF_LEARNER_STATE,
        SELF_LEARNER_TOKENIZER,
        get_self_learner_chat_thresholds,
        get_self_learner_runtime_manager,
    )
    from model.hybrid_vision import get_hybrid_model

    runtime = get_self_learner_runtime_manager()
    hybrid_model = get_hybrid_model()
    state = get_app_state()
    readiness = runtime.readiness()
    learner_state = _load_self_learner_state()
    thresholds = get_self_learner_chat_thresholds()
    min_steps = thresholds["min_steps"]
    min_sequences = thresholds["min_sequences"]
    training_recommended = not (
        learner_state.get("steps", 0) >= min_steps
        and learner_state.get("dataset_sequences", 0) >= min_sequences
    )
    chat_ready = (
        readiness.get("can_load", False)
        and learner_state.get("steps", 0) >= min_steps
        and learner_state.get("dataset_sequences", 0) >= min_sequences
    )
    return {
        "ready": readiness.get("can_load", False),
        "chat_ready": chat_ready,
        "training_recommended": training_recommended,
        "summary": readiness.get("summary"),
        "training_state": learner_state,
        "captured_pairs": learner_state.get("dataset_sequences", 0),
        "runtime": runtime.status(),
        "multimodal": hybrid_model.get_stats(),
        "text_fallback_available": state.chat_runtime is not None,
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
