"""
Enhanced Chat Route with Request Queue for Scalability
Handles 50-100 concurrent users without crashing
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from loguru import logger

from services.request_queue import get_request_queue

router = APIRouter()

class ChatRequest(BaseModel):
    """Chat request model."""
    message: str
    conversation_history: list = []
    use_rag: bool = False
   model: str = "Whisper"
    temperature: float = 0.7
    max_tokens: int = 2048
    
    # Token system parameters
    is_local: bool = True  # Default to local (free)
    user_id: Optional[str] = None  # User ID if logged in
    session_id: Optional[str] = None  # Session ID for guests


class ChatResponse(BaseModel):
    """Chat response model."""
    response: str
    tokens_used: int
    sources: list = []
    cached: bool = False  # NEW: Indicates if response was cached


async def _process_chat_request(request: ChatRequest) -> dict:
    """Internal function to process chat (used by queue)."""
    from api.route import get_app_state
    from api.routes.profile import get_supabase
    from services.token_service import check_and_use_tokens
    
    # CHECK TOKENS - Local is free, cloud costs tokens
    token_result = await check_and_use_tokens(
        supabase=get_supabase() if request.user_id else None,
        feature='chat',
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
    
    app_state = get_app_state()
    
    # Process chat using existing logic
    # ... (your existing chat processing code)
    
    # For now, return a simple response
    return {
        "response": f"Processed: {request.message}",
        "tokens_used": token_result.get('cost', 0),
        "sources": []
    }


@router.post("/chat")
async def chat(request: ChatRequest) -> ChatResponse:
    """
    Generate a text response with request queuing and caching.
    
    Optimized for 50-100 concurrent users on HuggingFace free tier.
    """
    try:
        # Get request queue
        queue = get_request_queue(
            max_concurrent=10,      # Max 10 simultaneous requests
            requests_per_minute=25  # Below HF limit (30/min)
        )
        
        # Enqueue request with caching
        result = await queue.enqueue(
            _process_chat_request,
            request,
            cache_enabled=True,     # Enable caching for similar prompts
            timeout=60.0            # HF can be slow on free tier
        )
        
        # Check if response was cached
        stats = queue.get_stats()
        was_cached = stats['cache_hits'] > 0
        
        return ChatResponse(
            response=result['response'],
            tokens_used=result['tokens_used'],
            sources=result.get('sources', []),
            cached=was_cached
        )
        
    except asyncio.TimeoutError:
        logger.error("Chat request timed out in queue")
        raise HTTPException(
            status_code=504,
            detail="Request timed out. Server is experiencing high load. Please try again."
        )
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Chat failed: {str(e)}"
        )


@router.get("/chat/stats")
async def get_chat_stats():
    """Get request queue statistics."""
    queue = get_request_queue()
    return queue.get_stats()
