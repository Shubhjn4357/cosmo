"""
Whisper AI - Image Upscaling API Routes  
Upscale images using Replicate API, AI Horde post-processing, or local OpenCV fallback.
"""

import os
import httpx
import logging
import asyncio
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from loguru import logger as log

from services.upscale import get_upscale_service
from utils.app_paths import UPLOADS_DIR

router = APIRouter()

class UpscaleRequest(BaseModel):
    """Upscale request model."""
    model_config = ConfigDict(str_strip_whitespace=True)

    image_url: str
    scale: int = 4  # 2 or 4
    method: str = "auto"  # auto, replicate, local
    # Token system
    is_local: bool = False  # Upscale costs tokens
    user_id: Optional[str] = None
    session_id: Optional[str] = None

@router.post("/upscale")
async def upscale_image(request: UpscaleRequest):
    """
    Upscale image using multiple methods:
    1. Replicate API (Real-ESRGAN) - if token available
    2. Local OpenCV - fallback method
    
    Args:
        image_url: URL or local path to image
        scale: Upscale factor (2 or 4)
        method: auto, replicate, or local
    """
    from api.routes.profile import get_supabase
    from services.token_service import check_and_use_tokens
    
    # CHECK TOKENS - Upscale costs 2.0 tokens
    token_result = await check_and_use_tokens(
        supabase=get_supabase() if request.user_id else None,
        feature='upscale',
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
    
    replicate_token = os.environ.get("REPLICATE_API_TOKEN")
    use_replicate = (
        request.method in ["auto", "replicate"] and 
        replicate_token and
        request.image_url.startswith("http")
    )
    
    # Try Replicate first if available
    if use_replicate:
        try:
            log.info(f"🔍 Upscaling via Replicate: scale={request.scale}x")
            
            async with httpx.AsyncClient(timeout=300.0) as client:
                # Start prediction
                response = await client.post(
                    "https://api.replicate.com/v1/predictions",
                    headers={
                        "Authorization": f"Token {replicate_token}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "version": "42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
                        "input": {
                            "image": request.image_url,
                            "scale": request.scale,
                            "face_enhance": True
                        }
                    }
                )
                
                if response.status_code == 201:
                    prediction = response.json()
                    prediction_id = prediction["id"]
                    
                    # Poll for result
                    for _ in range(60):  # Max 2 minutes
                        await asyncio.sleep(2)
                        status_res = await client.get(
                            f"https://api.replicate.com/v1/predictions/{prediction_id}",
                            headers={"Authorization": f"Token {replicate_token}"}
                        )
                        
                        if status_res.status_code == 200:
                            status_data = status_res.json()
                            if status_data["status"] == "succeeded":
                                return {
                                    "success": True,
                                    "upscaled_url": status_data["output"],
                                    "scale": request.scale,
                                    "method": "replicate"
                                }
                            elif status_data["status"] == "failed":
                                log.warning("Replicate upscaling failed, trying local")
                                break
        except Exception as e:
            log.warning(f"Replicate upscaling failed: {e}, trying local fallback")
    
    # Fallback to local upscaling
    try:
        log.info(f"🔍 Upscaling locally: scale={request.scale}x")
        
        # Download image if URL
        image_path = request.image_url
        if request.image_url.startswith("http"):
            import urllib.request
            from pathlib import Path
            
            temp_dir = UPLOADS_DIR / "temp"
            temp_dir.mkdir(parents=True, exist_ok=True)
            temp_path = temp_dir / f"temp_{os.urandom(8).hex()}.png"
            
            urllib.request.urlretrieve(request.image_url, str(temp_path))
            image_path = str(temp_path)
        
        # Upscale locally
        upscale_service = get_upscale_service()
        result_path = await upscale_service.upscale_local(
            image_path,
            scale=request.scale,
            method="cubic"
        )
        
        if not result_path:
            raise HTTPException(status_code=500, detail="Local upscaling failed")
        
        # Convert to URL
        from pathlib import Path
        relative_path = str(Path(result_path).relative_to(UPLOADS_DIR))
        upscaled_url = f"/static/{relative_path}"
        
        return {
            "success": True,
            "upscaled_url": upscaled_url,
            "scale": request.scale,
            "method": "local"
        }
        
    except Exception as e:
        log.error(f"Upscaling error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

