"""
HuggingFace Server Keepalive Service
Automatically pings HuggingFace models to prevent cold starts
"""

import asyncio
import os
import httpx
from loguru import logger
from datetime import datetime, timezone

class HuggingFaceKeepalive:
    def __init__(self, api_key: str = None, interval_minutes: int = 30):
        """
        Initialize HuggingFace keepalive service.
        
        Args:
            api_key: HuggingFace API key
            interval_minutes: How often to ping (default: 30 minutes)
        """
        self.api_key = api_key
        self.interval = interval_minutes * 60  # Convert to seconds
        self.running = False
        self.task = None
        
        # Models to keep alive - Updated with current working models
        self.models = [
            # "meta-llama/Llama-3.2-3B-Instruct",         # Returns 410 on free inference
        ]
        
    async def ping_model(self, model_id: str) -> bool:
        """Ping a single HuggingFace model."""
        try:
            url = f"https://api-inference.huggingface.co/models/{model_id}"
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Simple GET request to wake up the model
                response = await client.get(url, headers=headers)
                
                if response.status_code in [200, 503]:  # 503 = model loading
                    logger.info(f"✅ Pinged {model_id}: {response.status_code}")
                    return True
                else:
                    logger.warning(f"⚠️ Ping {model_id} returned: {response.status_code}")
                    return False
                    
        except Exception as e:
            logger.error(f"❌ Failed to ping {model_id}: {str(e)}")
            return False
    
    async def ping_all_models(self):
        """Ping all configured models."""
        logger.info(f"[Keepalive] Pinging {len(self.models)} HuggingFace models...")
        
        tasks = [self.ping_model(model) for model in self.models]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        success_count = sum(1 for r in results if r is True)
        logger.info(f"[Keepalive] Pinged {success_count}/{len(self.models)} models successfully")
        
    async def run(self):
        """Main keepalive loop."""
        self.running = True
        logger.info(f"[Keepalive] Started with {self.interval/60}min interval")
        
        while self.running:
            try:
                await self.ping_all_models()
                await asyncio.sleep(self.interval)
            except Exception as e:
                logger.error(f"[Keepalive] Error in loop: {str(e)}")
                await asyncio.sleep(60)  # Wait 1 minute before retry
    
    def start(self):
        """Start the keepalive service."""
        if not keepalive_enabled():
            logger.info("[Keepalive] Disabled by configuration")
            return
        if not self.models:
            logger.info("[Keepalive] No models configured, skipping keepalive loop")
            return
        if not self.running:
            self.task = asyncio.create_task(self.run())
            logger.info("[Keepalive] Service started")
    
    def stop(self):
        """Stop the keepalive service."""
        self.running = False
        if self.task:
            self.task.cancel()
        logger.info("[Keepalive] Service stopped")


# Global keepalive instance
_keepalive_instance = None


def keepalive_enabled() -> bool:
    return os.getenv("WHISPER_HF_KEEPALIVE_ENABLED", "false").lower() == "true"

def get_keepalive(api_key: str = None, interval_minutes: int = 30) -> HuggingFaceKeepalive:
    """Get or create global keepalive instance."""
    global _keepalive_instance
    if _keepalive_instance is None:
        _keepalive_instance = HuggingFaceKeepalive(api_key, interval_minutes)
    return _keepalive_instance
