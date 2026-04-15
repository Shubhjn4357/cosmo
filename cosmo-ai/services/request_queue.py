"""
Request Queue and Rate Limiter for HuggingFace API
Handles 50-100 concurrent users on free tier without crashing
"""

import asyncio
from typing import Optional, Callable, Any, Dict
from datetime import datetime, timedelta
from loguru import logger
from collections import deque
import hashlib
import json

class RequestQueue:
    """
    Smart request queue with rate limiting and caching for HuggingFace API.
    
    Free Tier Limits:
    - ~30 requests/minute per model
    - Cold start: 20+ seconds
    - Timeout: 60 seconds
    """
    
    def __init__(
        self,
        max_concurrent: int = 10,  # Max concurrent requests
        requests_per_minute: int = 25,  # Below HF limit for safety
        cache_ttl_seconds: int = 300,  # 5 minute cache
    ):
        self.max_concurrent = max_concurrent
        self.requests_per_minute = requests_per_minute
        self.cache_ttl = cache_ttl_seconds
        
        # Queue management
        self.queue: deque = deque()
        self.active_requests = 0
        self.semaphore = asyncio.Semaphore(max_concurrent)
        
        # Rate limiting
        self.request_times: deque = deque()
        self.rate_limit_lock = asyncio.Lock()
        
        # Response cache (in-memory)
        self.cache: Dict[str, tuple[Any, datetime]] = {}
        self.cache_lock = asyncio.Lock()
        
        # Statistics
        self.total_requests = 0
        self.cache_hits = 0
        self.queue_timeouts = 0
        
    def _generate_cache_key(self, func_name: str, args: tuple, kwargs: dict) -> str:
        """Generate cache key from function and arguments."""
        key_data = {
            'func': func_name,
            'args': str(args),
            'kwargs': str(sorted(kwargs.items()))
        }
        return hashlib.md5(json.dumps(key_data, sort_keys=True).encode()).hexdigest()
    
    async def _check_cache(self, cache_key: str) -> Optional[Any]:
        """Check if valid cached response exists."""
        async with self.cache_lock:
            if cache_key in self.cache:
                result, timestamp = self.cache[cache_key]
                age = (datetime.now() - timestamp).total_seconds()
                
                if age < self.cache_ttl:
                    self.cache_hits += 1
                    logger.info(f"✅ Cache HIT (age: {age:.1f}s)")
                    return result
                else:
                    # Expired
                    del self.cache[cache_key]
            
            return None
    
    async def _store_cache(self, cache_key: str, result: Any):
        """Store result in cache."""
        async with self.cache_lock:
            self.cache[cache_key] = (result, datetime.now())
            
            # Limit cache size (keep last 1000 items)
            if len(self.cache) > 1000:
                oldest_key = next(iter(self.cache))
                del self.cache[oldest_key]
    
    async def _wait_for_rate_limit(self):
        """Wait if we've exceeded rate limit."""
        async with self.rate_limit_lock:
            now = datetime.now()
            
            # Remove requests older than 1 minute
            while self.request_times and (now - self.request_times[0]) > timedelta(minutes=1):
                self.request_times.popleft()
            
            # If at limit, wait
            if len(self.request_times) >= self.requests_per_minute:
                oldest = self.request_times[0]
                wait_time = 60 - (now - oldest).total_seconds()
                
                if wait_time > 0:
                    logger.warning(f"⏳ Rate limit reached. Waiting {wait_time:.1f}s")
                    await asyncio.sleep(wait_time)
            
            # Record this request
            self.request_times.append(now)
    
    async def enqueue(
        self,
        func: Callable,
        *args,
        cache_enabled: bool = True,
        timeout: float = 60.0,
        **kwargs
    ) -> Any:
        """
        Enqueue a request with rate limiting and caching.
        
        Args:
            func: Async function to call
            *args: Function arguments
            cache_enabled: Enable response caching
            timeout: Request timeout in seconds
            **kwargs: Function keyword arguments
            
        Returns:
            Function result
        """
        self.total_requests += 1
        func_name = func.__name__
        
        # Check cache first
        if cache_enabled:
            cache_key = self._generate_cache_key(func_name, args, kwargs)
            cached = await self._check_cache(cache_key)
            if cached is not None:
                return cached
        
        # Wait for rate limit
        await self._wait_for_rate_limit()
        
        # Wait for available slot
        async with self.semaphore:
            self.active_requests += 1
            logger.debug(f"🔄 Processing {func_name} (active: {self.active_requests}/{self.max_concurrent})")
            
            try:
                # Execute with timeout
                result = await asyncio.wait_for(
                    func(*args, **kwargs),
                    timeout=timeout
                )
                
                # Cache result
                if cache_enabled:
                    await self._store_cache(cache_key, result)
                
                return result
                
            except asyncio.TimeoutError:
                self.queue_timeouts += 1
                logger.error(f"⏰ {func_name} timed out after {timeout}s")
                raise
                
            finally:
                self.active_requests -= 1
    
    def get_stats(self) -> dict:
        """Get queue statistics."""
        return {
            "total_requests": self.total_requests,
            "active_requests": self.active_requests,
            "cache_hits": self.cache_hits,
            "cache_hit_rate": f"{(self.cache_hits / max(1, self.total_requests)) * 100:.1f}%",
            "queue_timeouts": self.queue_timeouts,
            "cached_items": len(self.cache),
            "recent_requests": len(self.request_times)
        }


# Global queue instance
_request_queue: Optional[RequestQueue] = None

def get_request_queue(
    max_concurrent: int = 10,
    requests_per_minute: int = 25,
) -> RequestQueue:
    """Get or create global request queue."""
    global _request_queue
    if _request_queue is None:
        _request_queue = RequestQueue(
            max_concurrent=max_concurrent,
            requests_per_minute=requests_per_minute,
        )
        logger.info(f"✅ Request queue initialized (max_concurrent={max_concurrent}, rpm={requests_per_minute})")
    return _request_queue
