"""
TTS (Text-to-Speech) API Routes
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Literal
from loguru import logger

from services.tts_service import get_tts_service

router = APIRouter(prefix="/tts")


class TTSRequest(BaseModel):
    text: str
    voice: Literal["male", "female"] = "female"
    pitch: float = 1.0


@router.post("/speak")
async def text_to_speech(request: TTSRequest):
    """
    Convert text to speech with voice customization
    
    Args:
        text: Text to speak
        voice: Male or female voice
        pitch: Pitch multiplier (0.5 - 2.0)
    """
    try:
        tts = get_tts_service()
        
        # Generate speech
        audio_path = await tts.speak(
            text=request.text,
            voice=request.voice,
            pitch=request.pitch
        )
        
        if not audio_path:
            raise HTTPException(status_code=500, detail="TTS generation failed")
        
        # Return audio file
        return FileResponse(
            audio_path,
            media_type="audio/mpeg",
            filename="speech.mp3"
        )
        
    except Exception as e:
        logger.error(f"TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/voices")
async def get_voices():
    """Get list of available TTS voices"""
    try:
        tts = get_tts_service()
        voices = tts.get_available_voices()
        
        return {
            "success": True,
            "voices": voices
        }
        
    except Exception as e:
        logger.error(f"Get voices failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clear-cache")
async def clear_cache():
    """Clear TTS cache"""
    try:
        tts = get_tts_service()
        count = tts.clear_cache()
        
        return {
            "success": True,
            "files_cleared": count
        }
        
    except Exception as e:
        logger.error(f"Clear cache failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
