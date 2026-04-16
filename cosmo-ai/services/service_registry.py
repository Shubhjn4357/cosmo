from loguru import logger
from typing import Dict, List, Any

class ServiceRegistry:
    """
    Central registry for managing the lifecycle of background services.
    Ensures that services are initialized and shut down in the correct order.
    """
    def __init__(self):
        self._services = {}
        self._initialized = False

    def register(self, name: str, service_instance: Any):
        """Registers a service instance."""
        self._services[name] = service_instance
        logger.debug(f"Service registered: {name}")

    async def start_all(self, app_state: Any):
        """Starts all registered services that have a start() method."""
        if self._initialized:
            return
            
        logger.info("Initializing background services...")
        for name, service in self._services.items():
            if hasattr(service, 'start'):
                try:
                    logger.info(f"Starting service: {name}")
                    # Check if service.start is a coroutine
                    import inspect
                    if inspect.iscoroutinefunction(service.start):
                        await service.start(app_state)
                    else:
                        service.start(app_state)
                except Exception as e:
                    logger.error(f"Failed to start service {name}: {e}")
        
        self._initialized = True
        logger.info("All services started.")

    async def stop_all(self):
        """Stops all registered services that have a stop() method."""
        logger.info("Shutting down background services...")
        for name, service in reversed(list(self._services.items())):
            if hasattr(service, 'stop'):
                try:
                    logger.info(f"Stopping service: {name}")
                    import inspect
                    if inspect.iscoroutinefunction(service.stop):
                        await service.stop()
                    else:
                        service.stop()
                except Exception as e:
                    logger.error(f"Error stopping service {name}: {e}")
        
        self._initialized = False
        logger.info("All services shut down.")

# Singleton instance
service_registry = ServiceRegistry()
