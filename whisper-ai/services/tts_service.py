"""
Text-to-Speech Service
Provides text-to-speech conversion with voice customization.
"""

import os
import hashlib
from pathlib import Path
from typing import Optional, Literal
from loguru import logger

# Try to import TTS libraries
try:
    import pyttsx3
    PYTTSX3_AVAILABLE = True
except ImportError:
    PYTTSX3_AVAILABLE = False
    logger.warning("pyttsx3 not available. Offline TTS disabled.")

try:
    from gtts import gTTS
    GTTS_AVAILABLE = True
except ImportError:
    GTTS_AVAILABLE = False
    logger.warning("gTTS not available. Online TTS disabled.")


class TTSService:
    """Text-to-Speech service with voice customization"""
    
    def __init__(self, cache_dir: str = "data/tts_cache"):
        """Initialize TTS service"""
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        self.engine = None
        if PYTTSX3_AVAILABLE:
            try:
                self.engine = pyttsx3.init()
                logger.info("TTS engine initialized (pyttsx3)")
            except Exception as e:
                logger.error(f"Failed to initialize pyttsx3: {e}")
    
    def _get_cache_path(self, text: str, voice: str, pitch: float) -> Path:
        """Generate cache filename for text+voice+pitch combo"""
        cache_key = f"{text}_{voice}_{pitch}"
        hash_name = hashlib.md5(cache_key.encode()).hexdigest()
        return self.cache_dir / f"{hash_name}.mp3"
    
    def _configure_voice(
        self,
        voice_type: Literal["male", "female"],
        pitch: float = 1.0
    ):
        """Configure pyttsx3 voice"""
        if not self.engine:
            return
        
        try:
            voices = self.engine.getProperty('voices')
            
            # Try to find matching voice
            target_voice = None
            voice_lower = voice_type.lower()
            
            for v in voices:
                name_lower = v.name.lower()
                # Simple heuristic: female voices usually have "female" or specific names
                if voice_lower == "female" and ("female" in name_lower or "zira" in name_lower or "hazel" in name_lower):
                    target_voice = v
                    break
                elif voice_lower == "male" and ("male" in name_lower or "david" in name_lower):
                    target_voice = v
                    break
            
            if target_voice:
                self.engine.setProperty('voice', target_voice.id)
            elif voices:
                # Default to first voice
                idx = 1 if voice_lower == "female" and len(voices) > 1 else 0
                self.engine.setProperty('voice', voices[idx].id)
            
            # Set pitch (rate in pyttsx3)
            # Normal rate is ~200, we'll scale by pitch
            base_rate = 200
            new_rate = int(base_rate * pitch)
            new_rate = max(50, min(400, new_rate))  # Clamp between 50-400
            self.engine.setProperty('rate', new_rate)
            
            logger.info(f"Voice configured: {voice_type}, pitch: {pitch}, rate: {new_rate}")
            
        except Exception as e:
            logger.error(f"Failed to configure voice: {e}")
    
    async def speak(
        self,
        text: str,
        voice: Literal["male", "female"] = "female",
        pitch: float = 1.0,
        use_cache: bool = True
    ) -> Optional[str]:
        """
        Convert text to speech
        
        Args:
            text: Text to speak
            voice: Voice type (male/female)
            pitch: Pitch multiplier (0.5 - 2.0)
            use_cache: Use cached audio if available
            
        Returns:
            Path to audio file or None if failed
        """
        # Clamp pitch
        pitch = max(0.5, min(2.0, pitch))
        
        # Check cache
        cache_path = self._get_cache_path(text, voice, pitch)
        if use_cache and cache_path.exists():
            logger.info(f"Using cached TTS: {cache_path}")
            return str(cache_path)
        
        # Try pyttsx3 first (offline)
        if PYTTSX3_AVAILABLE and self.engine:
            try:
                self._configure_voice(voice, pitch)
                self.engine.save_to_file(text, str(cache_path))
                self.engine.runAndWait()
                
                if cache_path.exists():
                    logger.info(f"Generated TTS with pyttsx3: {cache_path}")
                    return str(cache_path)
            except Exception as e:
                logger.error(f"pyttsx3 TTS failed: {e}")
        
        # Fallback to gTTS (online)
        if GTTS_AVAILABLE:
            try:
                # gTTS doesn't support pitch, but we can try
                lang = 'en'
                slow = pitch < 0.8  # Slower if pitch is low
                
                tts = gTTS(text=text, lang=lang, slow=slow)
                tts.save(str(cache_path))
                
                logger.info(f"Generated TTS with gTTS: {cache_path}")
                return str(cache_path)
            except Exception as e:
                logger.error(f"gTTS failed: {e}")
        
        logger.error("All TTS methods failed")
        return None
    
    def get_available_voices(self) -> list:
        """Get list of available voices"""
        if not self.engine:
            return []
        
        try:
            voices = self.engine.getProperty('voices')
            return [
                {
                    "id": v.id,
                    "name": v.name,
                    "gender": "female" if "female" in v.name.lower() or "zira" in v.name.lower() else "male"
                }
                for v in voices
            ]
        except Exception as e:
            logger.error(f"Failed to get voices: {e}")
            return []
    
    def clear_cache(self) -> int:
        """Clear TTS cache"""
        count = 0
        try:
            for file in self.cache_dir.glob("*.mp3"):
                file.unlink()
                count += 1
            logger.info(f"Cleared {count} cached TTS files")
        except Exception as e:
            logger.error(f"Failed to clear cache: {e}")
        return count


# Singleton instance
_tts_service: Optional[TTSService] = None

def get_tts_service() -> TTSService:
    """Get or create TTS service singleton"""
    global _tts_service
    if _tts_service is None:
        _tts_service = TTSService()
    return _tts_service
