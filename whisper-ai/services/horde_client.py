"""
AI Horde Client Service
Handles all interactions with the AI Horde API for image generation, text chat, and model management.
"""

import os
import time
import asyncio
import aiohttp
import requests
from typing import Optional, Dict, List, Any
from loguru import logger


class HordeClient:
    """Client for interacting with AI Horde API"""
    
    BASE_URL = "https://stablehorde.net/api/v2"
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Horde client
        
        Args:
            api_key: AI Horde API key. If None, uses env var or falls back to anonymous
        """
        self.api_key = api_key or os.getenv("HORDE_API_KEY", "0000000000")
        self.headers = {
            "apikey": self.api_key,
            "Client-Agent": "WhisperAI:v3.4.5:contact@whisper.ai",
            "Content-Type": "application/json"
        }
        
        # Default negative prompt
        self.default_negative = (
            "full body, worst quality, low quality, illustration, 3d, 2d, painting, "
            "cartoons, sketch, text, watermark, blurry, ugly nails, ugly fingers, "
            "fused fingers, missing finger, extra fingers, bad anatomy"
        )
        
        # Model cache (5-minute TTL)
        self._models_cache = {}
        self._cache_timestamp = {}
    
    def get_models(self, model_type: str = "image", force_refresh: bool = False) -> List[Dict[str, Any]]:
        """
        Get list of active models (count > 0) from AI Horde API
        Cached for 5 minutes to reduce API calls
        
        Args:
            model_type: "image" or "text"
            force_refresh: Skip cache and fetch fresh data
            
        Returns:
            List of active model dictionaries
        """
        # Check cache
        cache_key = f"{model_type}_models"
        current_time = time.time()
        
        if not force_refresh and cache_key in self._models_cache:
            cache_age = current_time - self._cache_timestamp.get(cache_key, 0)
            if cache_age < 300:  # 5 minutes
                logger.debug(f"Returning cached {model_type} models (age: {cache_age:.0f}s)")
                return self._models_cache[cache_key]
        
        try:
            # Fetch from AI Horde API
            logger.info(f"Fetching {model_type} models from AI Horde API...")
            response = requests.get(
                f"{self.BASE_URL}/status/models",
                timeout=10
            )
            response.raise_for_status()
            
            models = response.json()
            
            # Filter active models (count > 0) of the requested type
            active = [
                m for m in models 
                if m.get("count", 0) > 0 and m.get("type") == model_type
            ]
            
            # Sort by performance (descending) then by ETA (ascending)
            active.sort(
                key=lambda x: (
                    -x.get("performance", 0),  # Higher performance first
                    x.get("eta", 999999)        # Lower ETA first
                ),
            )
            
            # Update cache
            self._models_cache[cache_key] = active
            self._cache_timestamp[cache_key] = current_time
            
            logger.info(f"Found {len(active)} active {model_type} models")
            return active
            
        except Exception as e:
            logger.error(f"Failed to get models from AI Horde: {e}")
            # Return cached data if available
            if cache_key in self._models_cache:
                logger.warning("Returning stale cached data due to API error")
                return self._models_cache[cache_key]
            return []
    
    def get_default_model(self, category: str = "realism") -> str:
        """
        Get default model name for a category
        
        Args:
            category: "realism", "anime", "flux", "furry"
            
        Returns:
            Model name
        """
        defaults = {
            "realism": "CyberRealistic Pony",
            "anime": "WAI-NSFW-illustrious-SDXL",
            "flux": "Flux.1-Schnell fp8 (Compact)",
            "furry": "White Pony Diffusion 4",
            "chat": "MythoMax-L2-13b"
        }
        return defaults.get(category, "stable_diffusion")
    
    async def generate_image(
        self,
        prompt: str,
        negative_prompt: Optional[str] = None,
        model: Optional[str] = None,
        width: int = 1024,
        height: int = 1024,
        steps: int = 25,
        cfg_scale: float = 7.0,
        sampler: str = "k_euler_a",
        temperature: float = 1.0,
        seed: int = -1,
        nsfw: bool = True,
        timeout: int = 300
    ) -> Dict[str, Any]:
        """
        Generate an image using AI Horde
        
        Args:
            prompt: Text prompt
            negative_prompt: Negative prompt (optional)
            model: Model name (uses default if None)
            width: Image width
            height: Image height
            steps: Number of steps
            cfg_scale: CFG scale
            sampler: Sampler name
            temperature: Temperature (0.1-2.0)
            seed: Random seed (-1 for random)
            nsfw: Allow NSFW content
            timeout: Max wait time in seconds
            
        Returns:
            Dict with image_url, seed, and metadata
        """
        if model is None:
            model = self.get_default_model("anime")
        
        # Combine negative prompts
        full_negative = negative_prompt or ""
        if full_negative and self.default_negative:
            full_negative = f"{full_negative}, {self.default_negative}"
        elif not full_negative:
            full_negative = self.default_negative
        
        payload = {
            "prompt": prompt,
            "params": {
                "sampler_name": sampler,
                "cfg_scale": cfg_scale,
                "steps": steps,
                "width": width,
                "height": height,
                "seed": str(seed) if seed != -1 else "",
                "karras": False,
                "tiling": False,
                "hires_fix": False,
                "post_processing": [],
            },
            "nsfw": nsfw,
            "censor_nsfw": False if nsfw else True,
            "trusted_workers": False,
            "models": [model],
            "r2": True  # Return URL instead of base64
        }
        
        # Add negative prompt if provided
        if full_negative:
            payload["params"]["negative_prompt"] = full_negative
        
        try:
            # Submit request
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.BASE_URL}/generate/async",
                    json=payload,
                    headers=self.headers
                ) as resp:
                    if resp.status != 202:
                        error = await resp.json()
                        raise Exception(f"Horde request failed: {error}")
                    
                    data = await resp.json()
                    request_id = data["id"]
                    logger.info(f"Image generation started: {request_id}")
                
                # Poll for completion
                start_time = time.time()
                check_interval = 3
                
                while time.time() - start_time < timeout:
                    await asyncio.sleep(check_interval)
                    
                    # Check status
                    async with session.get(
                        f"{self.BASE_URL}/generate/check/{request_id}"
                    ) as check_resp:
                        check_data = await check_resp.json()
                        
                        if check_data.get("done", False):
                            # Get final result
                            async with session.get(
                                f"{self.BASE_URL}/generate/status/{request_id}"
                            ) as status_resp:
                                result = await status_resp.json()
                                
                                generations = result.get("generations", [])
                                if generations:
                                    gen = generations[0]
                                    return {
                                        "image_url": gen["img"],
                                        "seed": gen.get("seed", "unknown"),
                                        "model": gen.get("model", model),
                                        "worker_id": gen.get("worker_id", "unknown"),
                                        "worker_name": gen.get("worker_name", "unknown")
                                    }
                                else:
                                    raise Exception("No image generated")
                        
                        # Log progress
                        queue_pos = check_data.get("queue_position", 0)
                        wait_time = check_data.get("wait_time", 0)
                        logger.info(f"Queue position: {queue_pos}, ETA: {wait_time}s")
                
                raise Exception("Generation timeout")
                
        except Exception as e:
            logger.error(f"Image generation failed: {e}")
            raise
    
    async def chat(
        self,
        prompt: str,
        model: Optional[str] = None,
        max_tokens: int = 256,
        temperature: float = 0.8,
        conversation_history: Optional[List[Dict[str, str]]] = None
    ) -> Dict[str, Any]:
        """
        Chat using AI Horde text models
        
        Args:
            prompt: User message
            model: Model name (uses default if None)
            max_tokens: Max tokens to generate
            temperature: Temperature
            conversation_history: Previous messages
            
        Returns:
            Dict with response text
        """
        if model is None:
            model = self.get_default_model("chat")
        
        # Format conversation
        full_prompt = prompt
        if conversation_history:
            # Build context
            context = "\n".join([
                f"{msg['role']}: {msg['content']}" 
                for msg in conversation_history[-10:]  # Last 10 messages
            ])
            full_prompt = f"{context}\nUser: {prompt}\nAssistant:"
        
        payload = {
            "prompt": full_prompt,
            "params": {
                "max_length": max_tokens,
                "max_context_length": 2048,
                "temperature": temperature,
                "top_p": 0.9,
                "top_k": 40,
                "repetition_penalty": 1.1
            },
            "models": [model],
            "trusted_workers": False
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                # Submit request
                async with session.post(
                    f"{self.BASE_URL}/generate/text/async",
                    json=payload,
                    headers=self.headers
                ) as resp:
                    if resp.status != 202:
                        error = await resp.json()
                        raise Exception(f"Chat request failed: {error}")
                    
                    data = await resp.json()
                    request_id = data["id"]
                    logger.info(f"Chat request started: {request_id}")
                
                # Poll for completion
                timeout = 120
                start_time = time.time()
                check_interval = 2
                
                while time.time() - start_time < timeout:
                    await asyncio.sleep(check_interval)
                    
                    async with session.get(
                        f"{self.BASE_URL}/generate/text/status/{request_id}"
                    ) as status_resp:
                        result = await status_resp.json()
                        
                        if result.get("done", False):
                            generations = result.get("generations", [])
                            if generations:
                                return {
                                    "response": generations[0].get("text", ""),
                                    "model": model,
                                    "tokens_used": len(generations[0].get("text", "").split())
                                }
                            else:
                                raise Exception("No response generated")
                
                raise Exception("Chat timeout")
                
        except Exception as e:
            logger.error(f"Chat failed: {e}")
            raise
    
    async def upscale_image(
        self,
        image_url: str,
        scale: int = 4
    ) -> Dict[str, Any]:
        """
        Upscale image using AI Horde post-processing
        
        Args:
            image_url: URL of image to upscale
            scale: Upscale factor (2 or 4)
            
        Returns:
            Dict with upscaled image URL
        """
        # Note: AI Horde upscaling is done via post_processing in generate request
        # For standalone upscaling, we'd need to re-generate with post_processing
        # This is a simplified version - fallback to local upscaling is handled separately
        
        raise NotImplementedError(
            "AI Horde standalone upscaling requires re-generation. Use local upscaling service."
        )


# Singleton instance
_horde_client: Optional[HordeClient] = None

def get_horde_client() -> HordeClient:
    """Get or create Horde client singleton"""
    global _horde_client
    if _horde_client is None:
        _horde_client = HordeClient()
    return _horde_client
