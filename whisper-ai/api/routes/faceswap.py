"""
Whisper AI - Face Swap API Routes
Face swap using Replicate API (yan-ops/face_swap).
"""

import os
import httpx
import logging
import asyncio
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

class FaceSwapRequest(BaseModel):
    """Face swap request model."""
    source_image: str  # URL of face source
    target_image: str  # URL of target image
    # Token system
    is_local: bool = False  # Faceswap costs tokens
    user_id: Optional[str] = None
    session_id: Optional[str] = None

@router.post("/faceswap")
async def face_swap(request: FaceSwapRequest):
    """
    Swap face using Replicate API.
    
    Requires REPLICATE_API_TOKEN env var.
    """
    from api.routes.profile import get_db_client
    from services.token_service import check_and_use_tokens
    
    # CHECK TOKENS - Faceswap costs 3.0 tokens
    token_result = await check_and_use_tokens(
        db_client=get_db_client() if request.user_id else None,
        feature='faceswap',
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
    if not replicate_token:
        raise HTTPException(status_code=503, detail="REPLICATE_API_TOKEN is not configured")
    
    logger.info("🎭 Starting face swap...")
    
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            # Start prediction
            response = await client.post(
                "https://api.replicate.com/v1/predictions",
                headers={
                    "Authorization": f"Token {replicate_token}",
                    "Content-Type": "application/json"
                },
                json={
                    "version": "278a81e7ebb22db98bcba54de985d22cc1abeead2754eb1f2af717247be69b34",  # lucataco/faceswap (working)
                    "input": {
                        "swap_image": request.source_image,
                        "input_image": request.target_image
                    }
                }
            )
            
            if response.status_code != 201:
                logger.error(f"Replicate API error: {response.text}")
                raise HTTPException(status_code=500, detail="Face swap failed to start")
            
            prediction = response.json()
            prediction_id = prediction["id"]
            
            # Poll for result
            for _ in range(60):  # Max 5 minutes
                await asyncio.sleep(3)
                status_res = await client.get(
                    f"https://api.replicate.com/v1/predictions/{prediction_id}",
                    headers={"Authorization": f"Token {replicate_token}"}
                )
                
                if status_res.status_code != 200:
                    continue
                    
                status_data = status_res.json()
                if status_data["status"] == "succeeded":
                    return {
                        "result_url": status_data["output"],
                        "message": "Success"
                    }
                elif status_data["status"] == "failed":
                    error_msg = status_data.get("error", "Unknown error")
                    logger.error(f"Face swap failed: {error_msg}")
                    raise HTTPException(status_code=500, detail=f"Face swap failed: {error_msg}")
                    
            raise HTTPException(status_code=408, detail="Face swap timed out")
            
    except Exception as e:
        logger.error(f"Face swap error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
