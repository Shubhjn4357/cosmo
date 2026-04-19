"""
Cosmo AI - Dashboard Stats Endpoint
Provides aggregated statistics for admin dashboard
"""

from fastapi import APIRouter, Depends
from datetime import datetime, timedelta
from loguru import logger
from .auth import verify_admin_token
from .profile import get_db_client

# Create router
dashboard_router = APIRouter()
@dashboard_router.get("/stats")
async def get_dashboard_stats(payload: dict = Depends(verify_admin_token)):
    """Get dashboard statistics"""
    db_client = get_db_client()
    
    stats = {
        "total_users": 0,
        "total_chats": 0,
        "total_images": 0,
        "blocked_ips": 0,
        "active_users_24h": 0
    }
    
    if not db_client:
        logger.warning("Database not available, returning zero stats")
        return {"success": True, "stats": stats}
    
    try:
        # Total users
        users_result = db_client.table("profiles").select("*", count="exact").execute()
        stats["total_users"] = users_result.count or 0
        
        # Active users in last 24h
        yesterday = (datetime.now() - timedelta(days=1)).isoformat()
        active_result = db_client.table("profiles").select(
            "*", count="exact"
        ).gte("last_active", yesterday).execute()
        stats["active_users_24h"] = active_result.count or 0
        
        # Total chats (if chats table exists)
        try:
            chats_result = db_client.table("chats").select("*", count="exact").execute()
            stats["total_chats"] = chats_result.count or 0
        except:
            logger.debug("Chats table not available")
        
        # Total images (if images table exists)
        try:
            images_result = db_client.table("generated_images").select("*", count="exact").execute()
            stats["total_images"] = images_result.count or 0
        except:
            logger.debug("Images table not available")
        
        # Blocked IPs - from in-memory storage for now
        from .admin import blocked_ips_storage  # type: ignore
        stats["blocked_ips"] = len(blocked_ips_storage)
        
        logger.info(f"Dashboard stats: {stats}")
        return {"success": True, "stats": stats}
        
    except Exception as e:
        logger.error(f"Failed to fetch dashboard stats: {e}")
        return {"success": False, "error": str(e), "stats": stats}
