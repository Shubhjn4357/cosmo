"""
Cosmo AI - Voice Routes
Speech-to-text, text-to-speech, voice chat, and talking endpoints.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import tempfile
from typing import Any, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from loguru import logger
from pydantic import BaseModel, Field

from services.approved_model_catalog import (
    DEFAULT_SPEECH_STT_MODEL_ID,
    DEFAULT_SPEECH_TALK_MODEL_ID,
    DEFAULT_SPEECH_TTS_MODEL_ID,
    get_speech_model,
    list_speech_models,
    list_text_models,
)
from services.local_model_service import (
    LocalModelError,
    invoke_audio_endpoint,
    invoke_openai_compatible_chat,
    resolve_local_adapter,
    run_local_command_template,
)
from services.runtime_manager import get_bitnet_runtime_manager, get_self_learner_runtime_manager

router = APIRouter(prefix="/voice", tags=["voice"])

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
USE_LOCAL_COSMO = os.environ.get("USE_LOCAL_COSMO", "false").lower() == "true"


class TTSRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    text: str
    voice: str = "alloy"
    speed: float = 1.0
    model_id: str = DEFAULT_SPEECH_TTS_MODEL_ID


class TranscriptionResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    success: bool
    text: str
    language: Optional[str] = None
    model_id: str = DEFAULT_SPEECH_STT_MODEL_ID


class VoiceChatResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    success: bool
    transcript: str
    response_text: str
    transcription_language: Optional[str] = None
    stt_model_id: str
    tts_model_id: str
    text_backend: str
    model_used: Optional[str] = None
    backend: Optional[str] = None
    talk_backend: Optional[str] = None
    audio: Optional[str] = None
    audio_format: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


_cosmo_model = None


def get_cosmo_model():
    global _cosmo_model
    if _cosmo_model is None and USE_LOCAL_COSMO:
        try:
            import cosmo  # type: ignore

            logger.info("Loading Cosmo model...")
            _cosmo_model = cosmo.load_model("base")
            logger.info("Cosmo model loaded")
        except Exception as exc:
            logger.error(f"Failed to load Cosmo: {exc}")
    return _cosmo_model


async def transcribe_with_openai(audio_bytes: bytes, filename: str, model_id: str = "cosmo-1") -> dict:
    import httpx

    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

    try:
        async with httpx.AsyncClient() as client:
            files = {
                "file": (filename, audio_bytes, "audio/wav"),
                "model": (None, model_id),
            }
            response = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                files=files,  # type: ignore
                timeout=60.0,
            )
            if response.status_code == 200:
                data = response.json()
                return {"text": data.get("text", ""), "language": data.get("language")}
            logger.error(f"OpenAI transcription failed: {response.text}")
            raise HTTPException(status_code=500, detail="Transcription failed")
    except httpx.RequestError as exc:
        logger.error(f"OpenAI request error: {exc}")
        raise HTTPException(status_code=500, detail="Transcription service error") from exc


def transcribe_with_local_cosmo(audio_bytes: bytes) -> dict:
    model = get_cosmo_model()
    if model is None:
        raise HTTPException(status_code=500, detail="Local Cosmo not available")

    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
            handle.write(audio_bytes)
            temp_path = handle.name

        result = model.transcribe(temp_path)
        os.unlink(temp_path)
        return {
            "text": result.get("text", "").strip(),
            "language": result.get("language"),
        }
    except Exception as exc:
        logger.error(f"Local Cosmo error: {exc}")
        raise HTTPException(status_code=500, detail="Transcription failed") from exc


async def synthesize_with_openai(text: str, voice: str, speed: float, model_id: str = "tts-1") -> bytes:
    import httpx

    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/speech",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model_id,
                    "input": text,
                    "voice": voice,
                    "speed": speed,
                },
                timeout=60.0,
            )
            if response.status_code == 200:
                return response.content
            logger.error(f"OpenAI TTS failed: {response.text}")
            raise HTTPException(status_code=500, detail="TTS failed")
    except httpx.RequestError as exc:
        logger.error(f"OpenAI TTS request error: {exc}")
        raise HTTPException(status_code=500, detail="TTS service error") from exc


def synthesize_with_local_tts(text: str) -> bytes:
    try:
        import pyttsx3  # type: ignore

        engine = pyttsx3.init()
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as handle:
            temp_path = handle.name

        engine.save_to_file(text, temp_path)
        engine.runAndWait()
        with open(temp_path, "rb") as handle:  # type: ignore
            audio_bytes = handle.read()
        os.unlink(temp_path)
        return audio_bytes
    except ImportError:
        try:
            import edge_tts  # type: ignore

            async def generate():
                communicate = edge_tts.Communicate(text, "en-US-AriaNeural")
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as handle:
                    temp_path = handle.name
                await communicate.save(temp_path)
                with open(temp_path, "rb") as audio_handle:
                    audio = audio_handle.read()
                os.unlink(temp_path)
                return audio

            return asyncio.run(generate())
        except Exception as exc:
            logger.error(f"Local TTS error: {exc}")
            raise HTTPException(status_code=500, detail="TTS not available") from exc


def _parse_history(history_json: str | None) -> list[dict[str, str]]:
    raw = (history_json or "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid history_json") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="history_json must be a JSON array")
    history: list[dict[str, str]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "user")
        content = str(item.get("content") or "").strip()
        if content:
            history.append({"role": role, "content": content})
    return history


async def _transcribe_audio_bytes(
    *,
    audio_bytes: bytes,
    filename: str,
    stt_model_id: str,
    use_local_override: bool = False,
) -> dict[str, Any]:
    if stt_model_id == "local-cosmo-base" or use_local_override or USE_LOCAL_COSMO:
        result = await asyncio.to_thread(transcribe_with_local_cosmo, audio_bytes)
        return {**result, "model_id": "local-cosmo-base"}

    result = await transcribe_with_openai(audio_bytes, filename, model_id="cosmo-1")
    return {**result, "model_id": "openai-cosmo-1"}


async def _synthesize_audio_bytes(
    *,
    text: str,
    voice: str,
    speed: float,
    tts_model_id: str,
) -> tuple[bytes, str]:
    if tts_model_id == "local-tts":
        audio_bytes = await asyncio.to_thread(synthesize_with_local_tts, text)
        return audio_bytes, "local-tts"

    try:
        audio_bytes = await synthesize_with_openai(text, voice, speed, model_id="tts-1")
        return audio_bytes, "openai-tts-1"
    except HTTPException:
        logger.warning("OpenAI TTS failed, falling back to local TTS")
        audio_bytes = await asyncio.to_thread(synthesize_with_local_tts, text)
        return audio_bytes, "local-tts"


async def _build_local_messages(request, state) -> list[dict[str, Any]]:
    from api.routes.chat import DEFAULT_SYSTEM_PROMPT, _resolve_knowledge_context

    knowledge_context, _ = await _resolve_knowledge_context(request, state)
    system_sections = [request.system_prompt or DEFAULT_SYSTEM_PROMPT]
    if request.context:
        system_sections.append(f"Additional context:\n{request.context}")
    if knowledge_context:
        system_sections.append(f"Knowledge:\n{knowledge_context}")

    messages: list[dict[str, Any]] = [{"role": "system", "content": "\n\n".join(system_sections)}]
    for turn in (request.history or [])[-16:]:
        role = "assistant" if turn.get("role") == "assistant" else "user"
        content = str(turn.get("content") or "").strip()
        if content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": request.message})
    return messages


async def _generate_server_text(request, state) -> dict[str, Any]:
    from api.routes.chat import _build_prompt, _resolve_knowledge_context
    from services.complex_task_router import generate_server_response

    knowledge_context, knowledge_sources = await _resolve_knowledge_context(request, state)
    prompt, _ = _build_prompt(
        request,
        state,
        knowledge_context=knowledge_context,
        knowledge_sources=knowledge_sources,
    )
    return await asyncio.to_thread(
        generate_server_response,
        prompt=prompt,
        history=request.history or [],
        fallback_runtime=state.chat_runtime,
        max_new_tokens=request.max_tokens,
        temperature=request.temperature,
        top_p=request.top_p,
    )


async def _generate_self_learner_text(request, state) -> dict[str, Any]:
    from api.routes.chat import (
        _build_prompt,
        _generate_self_learner_text_fallback,
        _resolve_knowledge_context,
        _self_learner_output_is_usable,
    )

    runtime = get_self_learner_runtime_manager()
    knowledge_context, knowledge_sources = await _resolve_knowledge_context(request, state)
    prompt, _ = _build_prompt(
        request,
        state,
        knowledge_context=knowledge_context,
        knowledge_sources=knowledge_sources,
    )

    if not runtime.readiness().get("can_load", False):
        return await _generate_self_learner_text_fallback(request, state, prompt)

    result = await asyncio.to_thread(
        runtime.generate,
        prompt,
        min(request.max_tokens, 384),
        request.temperature,
        request.top_p,
    )
    response_text = (result.get("text") or "").strip()
    if not _self_learner_output_is_usable(response_text):
        return await _generate_self_learner_text_fallback(request, state, prompt)
    return result


async def _generate_mimo_text(request, state) -> dict[str, Any]:
    from api.routes.chat import _build_prompt, _resolve_knowledge_context

    adapter = resolve_local_adapter("mimo")
    base_url = str(adapter.get("base_url") or "").strip()
    command_template = str(adapter.get("command_template") or "").strip()
    model_name = str(adapter.get("model_name") or "XiaomiMiMo/MiMo-V2-Flash").strip()

    if base_url:
        messages = await _build_local_messages(request, state)
        result = await invoke_openai_compatible_chat(
            base_url=base_url,
            model=model_name,
            messages=messages,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            top_p=request.top_p,
            api_key=adapter.get("api_key"),
        )
        result["backend"] = "local_endpoint:mimo-v2-flash"
        return result

    if command_template:
        knowledge_context, knowledge_sources = await _resolve_knowledge_context(request, state)
        prompt, _ = _build_prompt(
            request,
            state,
            knowledge_context=knowledge_context,
            knowledge_sources=knowledge_sources,
        )
        result = await asyncio.to_thread(
            run_local_command_template,
            command_template=command_template,
            values={
                "model": model_name,
                "prompt": prompt,
                "max_new_tokens": request.max_tokens,
                "temperature": request.temperature,
                "top_p": request.top_p,
            },
            cwd=str(adapter.get("command_cwd") or "").strip() or None,
        )
        return {
            "text": (result.get("text") or "").strip(),
            "model_used": model_name,
            "backend": "local_command:mimo-v2-flash",
        }

    searched = ", ".join(adapter.get("searched_base_urls") or [])
    raise HTTPException(
        status_code=503,
        detail=f"MiMo local runtime was not auto-detected. Checked {searched or 'default localhost ports'} and found no reachable endpoint or local launcher override.",
    )


async def _generate_bitnet_text(request, state) -> dict[str, Any]:
    from api.routes.chat import _build_prompt, _resolve_knowledge_context

    runtime = get_bitnet_runtime_manager()
    knowledge_context, knowledge_sources = await _resolve_knowledge_context(request, state)
    prompt, _ = _build_prompt(
        request,
        state,
        knowledge_context=knowledge_context,
        knowledge_sources=knowledge_sources,
    )
    readiness = runtime.readiness()
    if not readiness.get("can_load", False):
        raise HTTPException(status_code=503, detail=readiness.get("summary") or "BitNet runtime is not ready")
    return await asyncio.to_thread(
        runtime.generate,
        prompt,
        min(request.max_tokens, 384),
        request.temperature,
        request.top_p,
    )


async def _generate_text_response(
    *,
    transcript: str,
    history: list[dict[str, str]],
    context: Optional[str],
    system_prompt: Optional[str],
    text_backend: str,
    temperature: float,
    max_tokens: int,
    top_p: float,
) -> dict[str, Any]:
    from api.route import get_app_state
    from api.routes.chat import ChatRequest

    state = get_app_state()
    if state.chat_runtime is None:
        raise HTTPException(status_code=503, detail="Chat runtime not configured")

    request = ChatRequest(
        message=transcript,
        history=history,
        context=context,
        use_rag=True,
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
        system_prompt=system_prompt,
        is_local=True,
    )

    normalized_backend = (text_backend or "server").strip().lower()
    if normalized_backend in {"server", "default"}:
        return await _generate_server_text(request, state)
    if normalized_backend in {"self_learner", "self-learner", "cosmo-micro-transformer"}:
        return await _generate_self_learner_text(request, state)
    if normalized_backend in {"mimo-v2-flash", "mimo"}:
        return await _generate_mimo_text(request, state)
    if normalized_backend in {"bitnet-b1.58-2b-4t", "bitnet", "bitnet-cpu"}:
        return await _generate_bitnet_text(request, state)

    raise HTTPException(status_code=400, detail=f"Unsupported text backend: {text_backend}")


async def _run_voice_chat(
    *,
    audio_bytes: bytes,
    filename: str,
    history_json: str | None,
    context: str | None,
    system_prompt: str | None,
    text_backend: str,
    stt_model_id: str,
    tts_model_id: str,
    voice: str,
    speed: float,
    temperature: float,
    max_tokens: int,
    top_p: float,
    include_audio: bool,
    use_local_stt: bool = False,
) -> VoiceChatResponse:
    history = _parse_history(history_json)
    transcription = await _transcribe_audio_bytes(
        audio_bytes=audio_bytes,
        filename=filename,
        stt_model_id=stt_model_id,
        use_local_override=use_local_stt,
    )
    transcript = (transcription.get("text") or "").strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="No speech detected in audio")

    result = await _generate_text_response(
        transcript=transcript,
        history=history,
        context=context,
        system_prompt=system_prompt,
        text_backend=text_backend,
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
    )

    response_text = (result.get("text") or "").strip()
    if not response_text:
        raise HTTPException(status_code=502, detail="Model returned an empty response")

    audio_base64 = None
    audio_format = None
    resolved_tts_model = tts_model_id
    if include_audio:
        audio_output, resolved_tts_model = await _synthesize_audio_bytes(
            text=response_text,
            voice=voice,
            speed=speed,
            tts_model_id=tts_model_id,
        )
        audio_base64 = base64.b64encode(audio_output).decode("utf-8")
        audio_format = "mp3"

    return VoiceChatResponse(
        success=True,
        transcript=transcript,
        response_text=response_text,
        transcription_language=transcription.get("language"),
        stt_model_id=transcription.get("model_id") or stt_model_id,
        tts_model_id=resolved_tts_model,
        text_backend=text_backend,
        model_used=result.get("model_used"),
        backend=result.get("backend"),
        talk_backend="tts_pipeline",
        audio=audio_base64,
        audio_format=audio_format,
        metadata={
            "history_turns": len(history),
        },
    )


@router.get("/models")
async def get_voice_models():
    return {
        "speech_models": list_speech_models(),
        "text_backends": [
            {
                "id": "server",
                "name": "Server Runtime",
                "description": "Current Cosmo server text runtime.",
            },
            {
                "id": "self_learner",
                "name": "Self Learner",
                "description": "Built-in Cosmo scratch transformer with server fallback.",
            },
            next(model for model in list_text_models(include_adult=True) if model["id"] == "mimo-v2-flash"),
            next(model for model in list_text_models(include_adult=True) if model["id"] == "bitnet-b1.58-2b-4t"),
        ],
    }


@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    use_local: bool = Form(default=False),
    stt_model_id: str = Form(default=DEFAULT_SPEECH_STT_MODEL_ID),
):
    try:
        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio file")

        logger.info(f"Transcribing audio: {audio.filename}, size: {len(audio_bytes)} bytes")
        result = await _transcribe_audio_bytes(
            audio_bytes=audio_bytes,
            filename=audio.filename or "audio.wav",
            stt_model_id=stt_model_id,
            use_local_override=use_local,
        )
        return TranscriptionResponse(
            success=True,
            text=result["text"],
            language=result.get("language"),
            model_id=result.get("model_id") or stt_model_id,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Transcription error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/tts")
async def text_to_speech(request: TTSRequest):
    try:
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Empty text")

        text = request.text[:5000]
        logger.info(f"TTS request: {len(text)} characters, voice: {request.voice}")
        audio_bytes, _ = await _synthesize_audio_bytes(
            text=text,
            voice=request.voice,
            speed=request.speed,
            tts_model_id=request.model_id,
        )
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "attachment; filename=speech.mp3"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"TTS error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/tts-base64")
async def text_to_speech_base64(request: TTSRequest):
    try:
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Empty text")
        text = request.text[:5000]
        audio_bytes, resolved_model = await _synthesize_audio_bytes(
            text=text,
            voice=request.voice,
            speed=request.speed,
            tts_model_id=request.model_id,
        )
        return {
            "success": True,
            "audio": base64.b64encode(audio_bytes).decode("utf-8"),
            "format": "mp3",
            "model_id": resolved_model,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"TTS error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/chat", response_model=VoiceChatResponse)
async def voice_chat(
    audio: UploadFile = File(...),
    history_json: str = Form(default="[]"),
    context: Optional[str] = Form(default=None),
    system_prompt: Optional[str] = Form(default=None),
    text_backend: str = Form(default="server"),
    stt_model_id: str = Form(default=DEFAULT_SPEECH_STT_MODEL_ID),
    tts_model_id: str = Form(default=DEFAULT_SPEECH_TTS_MODEL_ID),
    voice: str = Form(default="alloy"),
    speed: float = Form(default=1.0),
    temperature: float = Form(default=0.7),
    max_tokens: int = Form(default=256),
    top_p: float = Form(default=0.9),
    include_audio: bool = Form(default=True),
    use_local_stt: bool = Form(default=False),
):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")
    return await _run_voice_chat(
        audio_bytes=audio_bytes,
        filename=audio.filename or "audio.wav",
        history_json=history_json,
        context=context,
        system_prompt=system_prompt,
        text_backend=text_backend,
        stt_model_id=stt_model_id,
        tts_model_id=tts_model_id,
        voice=voice,
        speed=speed,
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
        include_audio=include_audio,
        use_local_stt=use_local_stt,
    )


@router.post("/talk")
async def talk_audio(
    audio: UploadFile = File(...),
    history_json: str = Form(default="[]"),
    context: Optional[str] = Form(default=None),
    system_prompt: Optional[str] = Form(default=None),
    text_backend: str = Form(default="server"),
    talk_model_id: str = Form(default=DEFAULT_SPEECH_TALK_MODEL_ID),
    stt_model_id: str = Form(default=DEFAULT_SPEECH_STT_MODEL_ID),
    tts_model_id: str = Form(default=DEFAULT_SPEECH_TTS_MODEL_ID),
    voice: str = Form(default="alloy"),
    speed: float = Form(default=1.0),
    temperature: float = Form(default=0.7),
    max_tokens: int = Form(default=256),
    top_p: float = Form(default=0.9),
    response_format: str = Form(default="binary"),
):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    selected_talk_model = get_speech_model(talk_model_id)
    if selected_talk_model is None:
        raise HTTPException(status_code=400, detail=f"Unknown talk model: {talk_model_id}")

    personaplex_adapter = resolve_local_adapter("personaplex")
    endpoint_url = str(personaplex_adapter.get("base_url") or "").strip()
    if talk_model_id == "personaplex-7b-v1" and endpoint_url:
        try:
            payload_audio, content_type, metadata = await invoke_audio_endpoint(
                url=endpoint_url,
                audio_bytes=audio_bytes,
                filename=audio.filename or "audio.wav",
                fields={
                    "model": personaplex_adapter.get("model_name") or selected_talk_model.repo_id or "personaplex-7b-v1",
                    "voice": voice,
                    "temperature": temperature,
                    "top_p": top_p,
                },
                bearer_token=personaplex_adapter.get("api_key"),
            )
            if response_format == "base64":
                return {
                    "success": True,
                    "audio": base64.b64encode(payload_audio).decode("utf-8"),
                    "format": "mp3" if "mpeg" in content_type else content_type,
                    "talk_backend": "local_endpoint:personaplex",
                    "metadata": metadata or {},
                }
            return Response(
                content=payload_audio,
                media_type=content_type or "audio/mpeg",
                headers={"Content-Disposition": "attachment; filename=talk-response.mp3"},
            )
        except LocalModelError as exc:
            logger.warning(f"PersonaPlex endpoint failed, falling back to local voice chat pipeline: {exc}")

    pipeline = await _run_voice_chat(
        audio_bytes=audio_bytes,
        filename=audio.filename or "audio.wav",
        history_json=history_json,
        context=context,
        system_prompt=system_prompt,
        text_backend=text_backend,
        stt_model_id=stt_model_id,
        tts_model_id=tts_model_id,
        voice=voice,
        speed=speed,
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
        include_audio=True,
        use_local_stt=False,
    )

    audio_payload = base64.b64decode(pipeline.audio or "")
    if response_format == "base64":
        payload = pipeline.model_dump() if hasattr(pipeline, "model_dump") else pipeline.dict()
        return {
            **payload,
            "talk_backend": pipeline.talk_backend or "tts_pipeline",
        }

    return Response(
        content=audio_payload,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": "attachment; filename=talk-response.mp3",
            "X-Cosmo-Transcript": pipeline.transcript,
            "X-Cosmo-Backend": pipeline.backend or pipeline.text_backend,
        },
    )
