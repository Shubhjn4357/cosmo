"""
Cosmo AI - Response Caching Utility
Cache expensive API responses to improve performance
"""

import hashlib
import json
import time
from typing import Any, Optional, Dict
from loguru import logger


class ResponseCache:
    """Simple in-memory cache for API responses."""
    
    def __init__(self, default_ttl: int = 300):
        self.cache: Dict[str, dict] = {}
        self.default_ttl = default_ttl  # 5 minutes default
        self.hit_count = 0
        self.miss_count = 0
    
    def _generate_key(self, *args, **kwargs) -> str:
        """Generate cache key from arguments."""
        key_data = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True)
        return hashlib.md5(key_data.encode()).hexdigest()
    
    def get(self, key: str) -> Optional[Any]:
        """Get cached value if not expired."""
        if key in self.cache:
            entry = self.cache[key]
            if time.time() < entry["expires_at"]:
                self.hit_count += 1
                logger.debug(f"Cache hit: {key}")
                return entry["value"]
            else:
                # Expired, remove it
                del self.cache[key]
        
        self.miss_count += 1
        logger.debug(f"Cache miss: {key}")
        return None
    
    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        """Set cached value with TTL."""
        ttl = ttl or self.default_ttl
        self.cache[key] = {
            "value": value,
            "expires_at": time.time() + ttl,
            "created_at": time.time()
        }
        logger.debug(f"Cache set: {key} (TTL: {ttl}s)")
    
    def invalidate(self, key: str):
        """Invalidate a cached value."""
        if key in self.cache:
            del self.cache[key]
            logger.debug(f"Cache invalidated: {key}")
    
    def clear(self):
        """Clear all cached values."""
        self.cache.clear()
        logger.info("Cache cleared")
    
    def get_stats(self) -> dict:
        """Get cache statistics."""
        total = self.hit_count + self.miss_count
        hit_rate = (self.hit_count / total * 100) if total > 0 else 0
        
        return {
            "hits": self.hit_count,
            "misses": self.miss_count,
            "hit_rate": f"{hit_rate:.2f}%",
            "cached_items": len(self.cache)
        }
    
    def cleanup_expired(self):
        """Remove expired entries."""
        now = time.time()
        expired_keys = [
            key for key, entry in self.cache.items()
            if now >= entry["expires_at"]
        ]
        
        for key in expired_keys:
            del self.cache[key]
        
        if expired_keys:
            logger.info(f"Cleaned up {len(expired_keys)} expired cache entries")


# Global cache instance
response_cache = ResponseCache(default_ttl=300)


def cache_response(ttl: int = 300):
    """
    Decorator to cache function responses
   
    Args:
        ttl: Time to live in seconds
    """
    def decorator(func):
        def wrapper(*args, **kwargs):
            # Generate cache key
            cache_key = response_cache._generate_key(func.__name__, *args, **kwargs)
            
            # Check cache
            cached_value = response_cache.get(cache_key)
            if cached_value is not None:
                return cached_value
            
            # Execute function
            result = func(*args, **kwargs)
            
            # Cache result
            response_cache.set(cache_key, result, ttl)
            
            return result
        
        return wrapper
    
    return decorator
