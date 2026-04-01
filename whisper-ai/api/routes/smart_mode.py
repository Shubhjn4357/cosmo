"""
Whisper AI - Smart Mode Chat Route
Endpoint for Smart Mode that uses multiple AI APIs
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict
import os

router = APIRouter()

class SmartChatRequest(BaseModel):
    message: str
    conversation_history: Optional[List[Dict]] = None
    user_id: Optional[str] = None
    max_tokens: int = 500

class SmartChatResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    
    response: str
    model_used: str
    response_time: float
    success: bool

@router.post("/chat/smart")
async def smart_chat(request: SmartChatRequest) -> SmartChatResponse:
    """
    Smart Mode: Races multiple AI providers and returns best response
    Providers: Gemini, HuggingFace, AI Horde, Local LLM
    """
    from services.smart_mode_service import SmartModeService
    db_client = None
    if request.user_id:
        try:
            from api.routes.profile import get_db_client

            db_client = get_db_client()
        except Exception as e:
            print(f"Profile lookup unavailable: {e}")
    
    # Initialize Smart Mode with all available keys
    gemini_key = os.getenv('GEMINI_API_KEY')
    hf_key = os.getenv('HF_TOKEN')
    horde_key = os.getenv('HORDE_API_KEY')
    
    # Get user's custom HF key if they have one
    user_hf_key = None
    if request.user_id:
        try:
            from utils.encryption import decrypt_api_key
            profile_result = db_client.table("profiles").select("hf_api_key").eq("id", request.user_id).execute()
            if profile_result.data and profile_result.data[0].get("hf_api_key"):
                encrypted_key = profile_result.data[0]["hf_api_key"]
                user_hf_key = decrypt_api_key(encrypted_key)
        except:
            pass  # Use server key if decryption fails
    
    smart_service = SmartModeService(
        gemini_key=gemini_key,
        hf_key=hf_key,
        horde_key=horde_key,
        user_hf_key=user_hf_key
    )
    
    # Generate using enhanced Smart Mode with provider racing
    result = await smart_service.generate_smart(
        prompt=request.message,
        context=request.conversation_history,
        max_tokens=request.max_tokens
    )
    
    if not result.get('success'):
        raise HTTPException(
            status_code=500,
            detail=result.get('error', 'All AI providers failed')
        )
    
    return SmartChatResponse(
        response=result['response'],
        model_used=result['model_used'],
        response_time=result.get('response_time', 0),
        success=True
    )

@router.get("/chat/smart/status")
async def get_smart_mode_status():
    """Check which AI models are currently available for Smart Mode"""
    from services.smart_mode_service import SmartModeService
    
    gemini_key = os.getenv('GEMINI_API_KEY')
    hf_key = os.getenv('HF_TOKEN')
    horde_key = os.getenv('HORDE_API_KEY')
    
    smart_service = SmartModeService(gemini_key=gemini_key, hf_key=hf_key, horde_key=horde_key)
    
    statuses = await smart_service.get_model_status()
    
    return {
        'smart_mode_available': any(statuses.values()),
        'models': statuses,
        'available_count': sum(1 for v in statuses.values() if v)
    }
