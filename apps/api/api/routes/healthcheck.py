"""
Healthcheck API Routes
"""

from fastapi import APIRouter

router = APIRouter()

@router.get("/healthcheck")
async def healthcheck():
    """API healthcheck endpoint"""
    return {
        "success": True,
        "message": "API is operational",
        "version": "1.0.0"
    }

@router.get("/status")
async def status():
    """System status endpoint"""
    return {
        "status": "healthy",
        "service": "cosmo-ai",
        "endpoints": ["chat", "image", "healthcheck"]
    }
