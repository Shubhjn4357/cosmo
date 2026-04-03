"""
Whisper AI - Entry Point
Main script to run the API server.
"""

import os

import uvicorn
from loguru import logger
from utils.app_paths import DATA_ROOT, HF_HOME_DIR, HUGGINGFACE_HUB_CACHE_DIR, MODELS_DIR, PYTHON_USER_BASE, UPLOADS_DIR, ensure_app_dirs
logger.info("Importing API routes...")
if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "7860"))
    ensure_app_dirs()
    logger.info("Starting Whisper AI server...")
    logger.info(f"Server starting on http://{host}:{port}")
    logger.info(f"Storage root: {DATA_ROOT}")
    logger.info(f"Models dir: {MODELS_DIR}")
    logger.info(f"Uploads dir: {UPLOADS_DIR}")
    logger.info(f"HF cache: {HUGGINGFACE_HUB_CACHE_DIR}")
    logger.info(f"HF home: {HF_HOME_DIR}")
    logger.info(f"Python user base: {PYTHON_USER_BASE}")
    
    uvicorn.run(
        "api.route:app",
        host=host,
        port=port,
        log_level="info"
    )
