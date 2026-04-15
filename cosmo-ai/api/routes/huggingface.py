"""
HuggingFace API Integration
Uses HuggingFace Inference API for image generation and text generation.

Models (Free Tier Compatible):
- Image: black-forest-labs/FLUX.1-schnell (Apache 2.0, no restrictions)
- Text: mistralai/Mistral-7B-Instruct-v0.2 (Free, runs on CPU)

Fully working implementation.
"""

import os
import aiohttp
import base64
from typing import Optional, Dict, Any
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from loguru import logger


router = APIRouter()

# HuggingFace API settings
HF_API_KEY = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_API_KEY", "")
HF_API_URL = "https://api-inference.huggingface.co/models"

# Free tier models
FLUX_MODEL = "black-forest-labs/FLUX.1-schnell"
MISTRAL_MODEL = "mistralai/Mistral-7B-Instruct-v0.2"


class HFImageRequest(BaseModel):
    """HuggingFace image generation request."""
    prompt: str
    negative_prompt: Optional[str] = None
    width: int = 1024
    height: int = 1024
    num_inference_steps: int = 4  # Schnell is fast, 4 steps enough
    guidance_scale: float = 0.0  # Schnell doesn't need guidance
    

class HFTextRequest(BaseModel):
    """HuggingFace text generation request."""
    prompt: str
    max_new_tokens: int = 256
    temperature: float = 0.7
    top_p: float = 0.9
    do_sample: bool = True


async def call_hf_api(
    model: str,
    inputs: str,
    parameters: Optional[Dict[str, Any]] = None,
    api_key: Optional[str] = None
) -> bytes:
    """
    Call HuggingFace Inference API.
    
    Returns raw bytes (image) or JSON (text).
    """
    if not api_key and not HF_API_KEY:
        raise ValueError("HuggingFace API key not configured")
    
    headers = {
        "Authorization": f"Bearer {api_key or HF_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "inputs": inputs,
    }
    
    if parameters:
        payload["parameters"] = parameters
    
    url = f"{HF_API_URL}/{model}"
    
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload, headers=headers, timeout=120) as response:
            if response.status != 200:
                error_text = await response.text()
                logger.error(f"HF API error: {response.status} - {error_text}")
                raise HTTPException(status_code=response.status, detail=f"HuggingFace API error: {error_text}")
            
            return await response.read()


@router.post("/huggingface/image")
async def generate_image_hf(request: HFImageRequest):
    """
    Generate image using HuggingFace FLUX.1-schnell.
    
    FREE, no restrictions, Apache 2.0 license.
    Very fast (4 steps), high quality.
    """
    try:
        # Build parameters for FLUX
        parameters = {
            "num_inference_steps": request.num_inference_steps,
            "guidance_scale": request.guidance_scale,
        }
        
        # Schnell doesn't support size parameters in API, generates 1024x1024
        
        # Call HF API
        image_bytes = await call_hf_api(
            model=FLUX_MODEL,
            inputs=request.prompt,
            parameters=parameters
        )
        
        # Convert to base64
        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
        
        logger.info(f"Generated image with FLUX: {request.prompt[:50]}...")
        
        return {
            "success": True,
            "image": f"data:image/png;base64,{image_base64}",
            "model": FLUX_MODEL,
            "prompt": request.prompt,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"HF image generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/huggingface/text")
async def generate_text_hf(request: HFTextRequest):
    """
    Generate text using HuggingFace Mistral-7B.
    
    FREE, runs on CPU (slow but works on free tier).
    """
    try:
        # Build parameters
        parameters = {
            "max_new_tokens": request.max_new_tokens,
            "temperature": request.temperature,
            "top_p": request.top_p,
            "do_sample": request.do_sample,
            "return_full_text": False,
        }
        
        # Call HF API
        response_bytes = await call_hf_api(
            model=MISTRAL_MODEL,
            inputs=request.prompt,
            parameters=parameters
        )
        
        # Parse JSON response
        import json
        result = json.loads(response_bytes.decode('utf-8'))
        
        # Extract generated text
        if isinstance(result, list) and len(result) > 0:
            generated_text = result[0].get("generated_text", "")
        else:
            generated_text = str(result)
        
        logger.info(f"Generated text with Mistral: {len(generated_text)} chars")
        
        return {
            "success": True,
            "text": generated_text,
            "model": MISTRAL_MODEL,
            "tokens_used": request.max_new_tokens,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"HF text generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/huggingface/models")
async def get_available_models():
    """
    Get list of available HuggingFace models.
    Returns configured models and their capabilities.
    """
    return {
        "image_models": [
            {
                "id": FLUX_MODEL,
                "name": "FLUX.1 Schnell",
                "type": "text-to-image",
                "license": "Apache 2.0",
                "free": True,
                "speed": "very_fast",
                "quality": "high",
                "restrictions": "none",
                "default_steps": 4,
            }
        ],
        "text_models": [
            {
                "id": MISTRAL_MODEL,
                "name": "Mistral-7B Instruct",
                "type": "text-generation",
                "parameters": "7B",
                "license": "Apache 2.0",
                "free": True,
                "speed": "slow_on_cpu",
                "quality": "good",
            }
        ],
        "api_key_required": True,
        "api_key_configured": bool(HF_API_KEY),
    }


@router.get("/huggingface/status")
async def check_hf_status():
    """
    Check if HuggingFace API is configured and working.
    """
    if not HF_API_KEY:
        return {
            "configured": False,
            "error": "HuggingFace API key not set (HF_TOKEN or HUGGINGFACE_API_KEY env variable)"
        }
    
    try:
        # Test with a simple text generation
        test_params = {
            "max_new_tokens": 10,
            "temperature": 0.1,
        }
        
        await call_hf_api(
            model=MISTRAL_MODEL,
            inputs="Hello",
            parameters=test_params
        )
        
        return {
            "configured": True,
            "status": "working",
            "models_available": 2,
        }
        
    except Exception as e:
        return {
            "configured": True,
            "status": "error",
            "error": str(e)
        }
