"""
Prompt Enhancement Service
Uses AI to improve and enhance user's image generation prompts.
"""

import os
from typing import Optional
from loguru import logger

# Try to import Gemini API
try:
    from google import genai  # type: ignore
    from google.genai import types  # type: ignore
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    logger.warning("Google Gemini API not available. Prompt enhancement disabled.")


class PromptEnhancer:
    """Enhances image generation prompts using AI"""
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize prompt enhancer"""
        self.enabled = os.getenv("PROMPT_ENHANCEMENT_ENABLED", "true").lower() == "true"
        self.client = None
        
        if GEMINI_AVAILABLE and self.enabled:
            api_key = api_key or os.getenv("GEMINI_API_KEY")
            if api_key:
                self.client = genai.Client(api_key=api_key)
                logger.info("Prompt enhancement enabled with Gemini")
            else:
                self.enabled = False
                logger.warning("GEMINI_API_KEY not set. Prompt enhancement disabled.")
        else:
            self.enabled = False
    
    async def enhance_prompt(
        self,
        user_prompt: str,
        style: str = "realistic"
    ) -> str:
        """
        Enhance a user's prompt with quality keywords and details
        
        Args:
            user_prompt: Basic prompt from user
            style: Image style (realistic, anime, artistic, etc.)
            
        Returns:
            Enhanced prompt
        """
        if not self.enabled or not self.client:
            return user_prompt
        
        # Style-specific enhancements
        style_keywords = {
            "realistic": "professional photography, 8k uhd, high quality, sharp focus, natural lighting, detailed textures",
            "anime": "anime style, detailed anime art, vibrant colors, clean lines, high quality illustration",
            "artistic": "artistic masterpiece, detailed artwork, professional quality, beautiful composition",
            "photographic": "professional photo, DSLR, bokeh, high resolution, perfect lighting"
        }
        
        enhancement_instruction = f"""You are an expert at writing image generation prompts. 
Take the user's basic prompt and enhance it with quality keywords, artistic details, and technical specifications.

Style: {style}
User's prompt: {user_prompt}

Rules:
1. Keep the core concept from the user's prompt
2. Add quality keywords like "detailed", "high quality", "professional"
3. Add technical specs like "8k", "sharp focus", "perfect lighting"
4. Add relevant artistic descriptors for the style
5. Make it concise but detailed (under 200 words)
6. Do NOT add negative prompts
7. Return ONLY the enhanced prompt, no explanations

Enhanced prompt:"""

        try:
            # New SDK Usage
            response = self.client.models.generate_content(
                model='gemini-1.5-flash',
                contents=enhancement_instruction,
                config=types.GenerateContentConfig(
                    temperature=0,
                    top_p=0.95,
                    top_k=20,
                ),
            )
            enhanced = response.text.strip()
            
            # Fallback enhancement if API fails
            if not enhanced or len(enhanced) < len(user_prompt):
                enhanced = self._fallback_enhancement(user_prompt, style)
            
            logger.info(f"Enhanced prompt: '{user_prompt}' -> '{enhanced}'")
            return enhanced
            
        except Exception as e:
            logger.error(f"Prompt enhancement failed: {e}")
            return self._fallback_enhancement(user_prompt, style)
    
    def _fallback_enhancement(self, user_prompt: str, style: str) -> str:
        """Simple keyword-based enhancement as fallback"""
        style_keywords = {
            "realistic": "professional photography, 8k uhd, high quality, sharp focus, detailed, natural lighting",
            "anime": "anime style, detailed illustration, vibrant colors, high quality, clean lines",
            "artistic": "artistic masterpiece, detailed artwork, beautiful composition, professional quality",
            "photographic": "professional photo, DSLR quality, bokeh, high resolution"
        }
        
        keywords = style_keywords.get(style, "high quality, detailed, professional")
        return f"{user_prompt}, {keywords}"
    
    def is_enabled(self) -> bool:
        """Check if enhancement is enabled"""
        return self.enabled


# Singleton instance
_prompt_enhancer: Optional[PromptEnhancer] = None

def get_prompt_enhancer() -> PromptEnhancer:
    """Get or create prompt enhancer singleton"""
    global _prompt_enhancer
    if _prompt_enhancer is None:
        _prompt_enhancer = PromptEnhancer()
    return _prompt_enhancer
