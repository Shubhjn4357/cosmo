"""
Whisper AI - Token Service
Complete token management system with pricing, guest mode, and daily refresh
"""

from __future__ import annotations

from typing import Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass

# Make Redis optional - graceful fallback if not installed
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    redis = None

from loguru import logger


@dataclass
class TokenPricing:
    """Token pricing for different features"""
    # Local models - FREE
    LOCAL = 0.0
    
    # Cloud services - Priced
    CLOUD_CHAT = 0.1
    CLOUD_IMAGE = 2.0
    CLOUD_FILE_ANALYSIS = 0.5
    CLOUD_VOICE = 0.2
    CLOUD_FACESWAP = 3.0
    CLOUD_UPSCALE = 2.0
    CLOUD_ROLEPLAY = 0.3
    
    # Smart Mode - Pro only
    SMART_CHAT = 0.5
    SMART_IMAGE = 5.0
    SMART_FILE = 1.0
    SMART_ROLEPLAY = 0.8
    
    @classmethod
    def get_cost(cls, feature: str, is_local: bool = False, is_smart: bool = False) -> float:
        """
        Get token cost for a feature
        
        Args:
            feature: Feature name (chat, image, file, etc.)
            is_local: Using local model
            is_smart: Using Smart Mode
            
        Returns:
            Token cost
        """
        return 0.0


@dataclass
class TokenLimits:
    """Token limits per tier"""
    GUEST = 5
    FREE_DAILY = 20
    PRO_DAILY = 1000
    MAX_BONUS = 100  # Max bonus tokens from referrals/achievements


class GuestTokenManager:
    """
    Manage guest user tokens (Redis-based session storage)
    Guest users get 5 free tokens without signup
    """
    
    def __init__(self, redis_client: Optional['redis.Redis'] = None):
        """
        Initialize guest token manager
        
        Args:
            redis_client: Redis client (optional, will create if not provided)
        """
        self.redis = redis_client or self._get_redis_client()
        self.guest_limit = TokenLimits.GUEST
        self.ttl = 86400  # 24 hours
    
    def _get_redis_client(self) -> Optional[redis.Redis]:
        """Get or create Redis client"""
        if not REDIS_AVAILABLE:
            logger.warning("Redis module not installed, using in-memory fallback for guest tokens")
            return None
            
        try:
            import os
            redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
            client = redis.from_url(redis_url, decode_responses=True)
            client.ping()
            return client
        except Exception as e:
            # Fallback to in-memory dict if Redis not available
            logger.warning(f"Redis not available ({e}), using in-memory storage for guest tokens")
            return None
    
    def get_tokens(self, session_id: str) -> int:
        """
        Get remaining tokens for guest session
        
        Args:
            session_id: Guest session ID
            
        Returns:
            Remaining tokens
        """
        if not self.redis:
            return self.guest_limit  # Fallback
        
        key = f"guest:tokens:{session_id}"
        tokens = self.redis.get(key)
        
        if tokens is None:
            # First time - give full allocation
            self.redis.setex(key, self.ttl, str(self.guest_limit))
            return self.guest_limit
        
        return int(tokens)
    
    def use_tokens(self, session_id: str, amount: float) -> Dict[str, Any]:
        """
        Use tokens from guest session
        
        Args:
            session_id: Guest session ID
            amount: Tokens to use
            
        Returns:
            Result dict with success, remaining, etc.
        """
        current = self.get_tokens(session_id)
        
        if current < amount:
            return {
                'success': False,
                'error': 'insufficient_tokens',
                'message': f'Not enough tokens. You have {current} but need {amount}. Sign up for more!',
                'current': current,
                'required': amount,
                'is_guest': True
            }
        
        new_balance = current - amount
        key = f"guest:tokens:{session_id}"
        
        if self.redis:
            self.redis.setex(key, self.ttl, str(new_balance))
        
        return {
            'success': True,
            'remaining': new_balance,
            'used': amount,
            'is_guest': True
        }


class TokenService:
    """
    Compatibility token service for the simplified free app.
    """
    
    def __init__(self, db_client=None):
        """
        Initialize token service
        
        Args:
            db_client: Database client for user data
        """
        self.db_client = db_client
        self.guest_manager = GuestTokenManager()
    
    async def check_and_use_tokens(
        self,
        feature: str,
        is_local: bool = False,
        is_smart: bool = False,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Check if user/guest has enough tokens and deduct if yes
        
        Args:
            feature: Feature being used
            is_local: Using local model (free)
            is_smart: Using Smart Mode
            user_id: User ID (if logged in)
            session_id: Session ID (for guests)
            
        Returns:
            Result dict with success, remaining, etc.
        """
        return {
            'success': True,
            'cost': 0,
            'remaining': float('inf'),
            'feature': feature,
            'is_local': is_local,
            'is_smart': is_smart,
            'user_id': user_id,
            'session_id': session_id,
            'message': 'Token limits disabled',
        }
    
    async def _use_user_tokens(
        self,
        user_id: str,
        cost: float,
        feature: str
    ) -> Dict[str, Any]:
        return {
            'success': True,
            'cost': 0,
            'remaining': float('inf'),
            'used_today': 0,
            'user_id': user_id,
            'feature': feature,
        }
    
    def _should_refresh_tokens(self, last_refresh: Optional[str]) -> bool:
        """
        Check if daily tokens should refresh
        
        Args:
            last_refresh: Last refresh timestamp
            
        Returns:
            True if should refresh
        """
        if not last_refresh:
            return True
        
        try:
            last = datetime.fromisoformat(last_refresh.replace('Z', '+00:00'))
            now = datetime.now(timezone.utc)
            
            # Refresh if it's a new day (UTC)
            return last.date() < now.date()
        except:
            return True
    
    async def _log_token_usage(
        self,
        user_id: str,
        tokens: float,
        feature: str,
        is_local: bool
    ):
        """
        Log token usage for analytics
        
        Args:
            user_id: User ID
            tokens: Tokens used
            feature: Feature name
            is_local: Was local model
        """
        if not self.db_client:
            return
        
        try:
            self.db_client.table("token_usage").insert({
                'user_id': user_id,
                'feature': feature,
                'tokens_used': tokens,
                'is_local': is_local,
                'created_at': datetime.now(timezone.utc).isoformat()
            }).execute()
        except Exception as e:
            logger.warning(f"Failed to log token usage: {e}")
    
    async def get_user_tokens(self, user_id: str) -> Dict[str, Any]:
        return {
            'used': 0,
            'limit': float('inf'),
            'remaining': float('inf'),
            'tier': 'unlimited',
            'last_refresh': None,
            'user_id': user_id,
        }


# Example usage convenience function
async def check_and_use_tokens(
    *,
    db_client=None,
    feature: str,
    is_local: bool = False,
    is_smart: bool = False,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    supabase=None,
) -> Dict[str, Any]:
    """
    Convenience function for checking and using tokens
    
    Args:
        db_client: Database client
        feature: Feature name
        is_local: Using local model
        is_smart: Using Smart Mode
        user_id: User ID
        session_id: Guest session ID
        
    Returns:
        Result dict
    """
    service = TokenService(db_client or supabase)
    return await service.check_and_use_tokens(
        feature=feature,
        is_local=is_local,
        is_smart=is_smart,
        user_id=user_id,
        session_id=session_id
    )
