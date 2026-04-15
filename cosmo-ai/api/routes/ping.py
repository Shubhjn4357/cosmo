"""
Server Keepalive Endpoint
Lightweight endpoint to prevent HuggingFace from sleeping
"""

from fastapi import APIRouter
from datetime import datetime, timezone

router = APIRouter()

@router.get("/ping")
async def ping():
    """
    Lightweight ping endpoint to keep server awake.
    
    Returns server status and timestamp.
    """
    return {
        "status": "alive",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": "Server is active"
    }

@router.get("/healthcheck")
async def healthcheck():
    """
    More detailed health check with system info.
    """
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "server": "Cosmo AI",
        "version": "1.0.0"
    }
