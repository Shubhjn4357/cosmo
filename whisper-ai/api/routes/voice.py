"""
Whisper AI - Voice Routes
Speech-to-text and text-to-speech endpoints
"""

import os
import io
import tempfile
import base64
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel
from loguru import logger

router = APIRouter(prefix="/voice", tags=["voice"])

# Configuration
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
USE_LOCAL_WHISPER = os.environ.get("USE_LOCAL_WHISPER", "false").lower() == "true"


class TTSRequest(BaseModel):
    text: str
    voice: str = "alloy"  # alloy, echo, fable, onyx, nova, shimmer
    speed: float = 1.0


class TranscriptionResponse(BaseModel):
    success: bool
    text: str
    language: Optional[str] = None


# Local Whisper model (lazy load)
_whisper_model = None

def get_whisper_model():
    """Lazy load Whisper model."""
    global _whisper_model
    if _whisper_model is None and USE_LOCAL_WHISPER:
        try:
            import whisper
            logger.info("Loading Whisper model...")
            _whisper_model = whisper.load_model("base")
            logger.info("Whisper model loaded")
        except Exception as e:
            logger.error(f"Failed to load Whisper: {e}")
    return _whisper_model


async def transcribe_with_openai(audio_bytes: bytes, filename: str) -> dict:
    """Transcribe audio using OpenAI Whisper API."""
    import httpx
    
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    
    try:
        async with httpx.AsyncClient() as client:
            files = {
                "file": (filename, audio_bytes, "audio/wav"),
                "model": (None, "whisper-1"),
            }
            
            response = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                files=files,
                timeout=60.0
            )
            
            if response.status_code == 200:
                data = response.json()
                return {"text": data.get("text", ""), "language": data.get("language")}
            else:
                logger.error(f"OpenAI transcription failed: {response.text}")
                raise HTTPException(status_code=500, detail="Transcription failed")
                
    except httpx.RequestError as e:
        logger.error(f"OpenAI request error: {e}")
        raise HTTPException(status_code=500, detail="Transcription service error")


def transcribe_with_local_whisper(audio_bytes: bytes) -> dict:
    """Transcribe audio using local Whisper model."""
    model = get_whisper_model()
    if model is None:
        raise HTTPException(status_code=500, detail="Local Whisper not available")
    
    try:
        # Save to temp file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            temp_path = f.name
        
        # Transcribe
        result = model.transcribe(temp_path)
        
        # Cleanup
        os.unlink(temp_path)
        
        return {
            "text": result.get("text", "").strip(),
            "language": result.get("language"),
        }
        
    except Exception as e:
        logger.error(f"Local Whisper error: {e}")
        raise HTTPException(status_code=500, detail="Transcription failed")


async def synthesize_with_openai(text: str, voice: str, speed: float) -> bytes:
    """Generate speech using OpenAI TTS API."""
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
                    "model": "tts-1",
                    "input": text,
                    "voice": voice,
                    "speed": speed,
                },
                timeout=60.0
            )
            
            if response.status_code == 200:
                return response.content
            else:
                logger.error(f"OpenAI TTS failed: {response.text}")
                raise HTTPException(status_code=500, detail="TTS failed")
                
    except httpx.RequestError as e:
        logger.error(f"OpenAI TTS request error: {e}")
        raise HTTPException(status_code=500, detail="TTS service error")


def synthesize_with_local_tts(text: str) -> bytes:
    """Generate speech using local TTS (pyttsx3 or edge-tts)."""
    try:
        import pyttsx3
        
        engine = pyttsx3.init()
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            temp_path = f.name
        
        engine.save_to_file(text, temp_path)
        engine.runAndWait()
        
        # Read audio
        with open(temp_path, "rb") as f:
            audio_bytes = f.read()
        
        # Cleanup
        os.unlink(temp_path)
        
        return audio_bytes
        
    except ImportError:
        # Try edge-tts as fallback
        try:
            import asyncio
            import edge_tts
            
            async def generate():
                communicate = edge_tts.Communicate(text, "en-US-AriaNeural")
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
                    temp_path = f.name
                await communicate.save(temp_path)
                with open(temp_path, "rb") as f:
                    audio = f.read()
                os.unlink(temp_path)
                return audio
            
            return asyncio.run(generate())
            
        except Exception as e:
            logger.error(f"Local TTS error: {e}")
            raise HTTPException(status_code=500, detail="TTS not available")


@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    use_local: bool = Form(default=False),
):
    """
    Transcribe audio to text.
    
    Accepts audio files (WAV, MP3, M4A, etc.)
    Returns transcribed text.
    """
    try:
        audio_bytes = await audio.read()
        
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio file")
        
        logger.info(f"Transcribing audio: {audio.filename}, size: {len(audio_bytes)} bytes")
        
        if use_local or USE_LOCAL_WHISPER:
            result = transcribe_with_local_whisper(audio_bytes)
        else:
            result = await transcribe_with_openai(audio_bytes, audio.filename or "audio.wav")
        
        return TranscriptionResponse(
            success=True,
            text=result["text"],
            language=result.get("language"),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tts")
async def text_to_speech(request: TTSRequest):
    """
    Convert text to speech.
    
    Returns audio as MP3.
    """
    try:
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Empty text")
        
        # Limit text length
        text = request.text[:5000]
        
        logger.info(f"TTS request: {len(text)} characters, voice: {request.voice}")
        
        # Try OpenAI first, fallback to local
        try:
            audio_bytes = await synthesize_with_openai(text, request.voice, request.speed)
        except HTTPException:
            logger.warning("OpenAI TTS failed, trying local")
            audio_bytes = synthesize_with_local_tts(text)
        
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": "attachment; filename=speech.mp3"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tts-base64")
async def text_to_speech_base64(request: TTSRequest):
    """
    Convert text to speech and return as base64.
    
    Useful for mobile apps that can't handle binary responses.
    """
    try:
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Empty text")
        
        text = request.text[:5000]
        
        try:
            audio_bytes = await synthesize_with_openai(text, request.voice, request.speed)
        except HTTPException:
            audio_bytes = synthesize_with_local_tts(text)
        
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
        
        return {
            "success": True,
            "audio": audio_base64,
            "format": "mp3",
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
