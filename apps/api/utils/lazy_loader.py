"""
Lazy Loader Utility
Defers expensive initialization until first access
"""

from typing import Callable, TypeVar, Optional
from loguru import logger
import threading

T = TypeVar('T')


class LazyLoader:
    """
    Lazy loader for expensive models/components.
    Only initializes when first accessed, not during construction.
    Thread-safe to prevent multiple simultaneous loads.
    """
    
    def __init__(self, loader_func: Callable[[], T], name: str = "component"):
        """
        Args:
            loader_func: Function that returns the loaded component
            name: Name for logging
        """
        self._loader_func = loader_func
        self._name = name
        self._instance: Optional[T] = None
        self._loading = False
        self._lock = threading.Lock()
    
    def get(self) -> Optional[T]:
        """
        Get instance, loading if necessary.
        Thread-safe - only one thread will perform the load.
        
        Returns:
            Loaded instance, or None if loading failed
        """
        if self._instance is not None:
            return self._instance  # type: ignore
        
        with self._lock:
            # Double-check after acquiring lock
            if self._instance is not None:
                return self._instance
            
            if self._loading:
                logger.warning(f"⏳ {self._name} is already loading...")
                return None
            
            try:
                self._loading = True
                logger.info(f"⏳ Loading {self._name}...")
                self._instance = self._loader_func()
                logger.info(f"✅ {self._name} loaded successfully")
                return self._instance  # type: ignore
            except Exception as e:
                logger.error(f"❌ Failed to load {self._name}: {e}")
                return None
            finally:
                self._loading = False
    
    def is_loaded(self) -> bool:
        """Check if component is already loaded"""
        return self._instance is not None
    
    def unload(self):
        """Unload the component (free memory)"""
        if self._instance is not None:
            logger.info(f"🗑️ Unloading {self._name}")
            self._instance = None
