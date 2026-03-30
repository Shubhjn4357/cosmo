"""
Whisper AI - Entry Point
Main script to run the API server.
"""

import os

import uvicorn
from loguru import logger

if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "7860"))
    logger.info("Starting Whisper AI server...")
    logger.info(f"Server starting on http://{host}:{port}")
    
    uvicorn.run(
        "api.route:app",
        host=host,
        port=port,
        log_level="info"
    )
