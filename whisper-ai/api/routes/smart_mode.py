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
    **Pro Feature Only** - Requires Pro subscription
    Providers: Gemini, HuggingFace, AI Horde, Local LLM
    """
    from services.smart_mode_service import SmartModeService
    from services.token_service import check_and_use_tokens
    from api.routes.profile import get_supabase
    
    supabase = None

    # PRO SUBSCRIPTION CHECK - Smart Mode is Pro-only
    if request.user_id:
        try:
            supabase = get_supabase()
            
            # Check subscription tier
            profile_result = supabase.table("profiles").select("subscription_tier").eq("id", request.user_id).execute()
            
            if not profile_result.data:
                raise HTTPException(
                    status_code=404,
                    detail="User profile not found"
                )
            
            subscription_tier = profile_result.data[0].get("subscription_tier", "free")
            
            if subscription_tier != "pro":
                raise HTTPException(
                    status_code=403,
                    detail={
                        "error": "Smart Mode is a Pro feature",
                        "message": "Upgrade to Pro to access Smart Mode with multi-provider AI racing",
                        "feature": "smart_mode",
                        "required_tier": "pro",
                        "current_tier": subscription_tier
                    }
                )
            
            # Check tokens for Pro users
            token_result = await check_and_use_tokens(
                supabase=supabase,
                feature='smart_mode',
                is_local=False,
                is_smart=True,
                user_id=request.user_id
            )
            
            if not token_result['success']:
                raise HTTPException(
                    status_code=429,
                    detail=token_result.get('message', 'Insufficient tokens')
                )
        except HTTPException:
            raise
        except Exception as e:
            # If checks fail, log but continue (graceful degradation)
            print(f"Subscription/token check failed: {e}")
    
    # Initialize Smart Mode with all available keys
    gemini_key = os.getenv('GEMINI_API_KEY')
    hf_key = os.getenv('HF_TOKEN')
    horde_key = os.getenv('HORDE_API_KEY')
    
    # Get user's custom HF key if they have one
    user_hf_key = None
    if request.user_id:
        try:
            from utils.encryption import decrypt_api_key
            profile_result = supabase.table("profiles").select("hf_api_key").eq("id", request.user_id).execute()
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
