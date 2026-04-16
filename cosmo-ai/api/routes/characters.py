"""
Character/Roleplay API Routes
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict
from loguru import logger

from services.characters import get_character_manager

router = APIRouter(prefix="/characters")


class CreateCharacterRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    name: str
    description: str
    personality: str
    system_prompt: str
    avatar: str = "default.png"
    tags: Optional[List[str]] = None
    nsfw: bool = False


@router.get("/")
async def list_characters(
    include_nsfw: bool = True,
    tags: Optional[str] = None
):
    """
    List available roleplay characters
    
    Args:
        include_nsfw: Include NSFW characters
        tags: Comma-separated tags to filter by
    """
    try:
        manager = get_character_manager()
        
        tag_list = tags.split(",") if tags else None
        characters = manager.list_characters(include_nsfw, tag_list)
        
        # Format response
        formatted = [
            {
                "id": char.id,
                "name": char.name,
               "avatar": char.avatar,
                "description": char.description,
                "personality": char.personality,
                "tags": char.tags,
                "nsfw": char.nsfw,
                "premium": char.premium
            }
            for char in characters
        ]
        
        return {
            "success": True,
            "characters": formatted,
            "total": len(formatted)
        }
        
    except Exception as e:
        logger.error(f"List characters failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{character_id}")
async def get_character(character_id: str):
    """Get a specific character"""
    try:
        manager = get_character_manager()
        char = manager.get_character(character_id)
        
        if not char:
            raise HTTPException(status_code=404, detail="Character not found")
        
        return {
            "success": True,
            "character": {
                "id": char.id,
                "name": char.name,
                "avatar": char.avatar,
                "description": char.description,
                "personality": char.personality,
                "system_prompt": char.system_prompt,
                "tags": char.tags,
                "nsfw": char.nsfw,
                "premium": char.premium
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get character failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/custom")
async def create_custom_character(request: CreateCharacterRequest):
    """Create a custom character"""
    try:
        manager = get_character_manager()
        
        char = manager.create_custom_character(
            name=request.name,
            description=request.description,
            personality=request.personality,
            system_prompt=request.system_prompt,
            avatar=request.avatar,
            tags=request.tags,
            nsfw=request.nsfw
        )
        
        return {
            "success": True,
            "character": {
                "id": char.id,
                "name": char.name,
                "avatar": char.avatar
            }
        }
        
    except Exception as e:
        logger.error(f"Create character failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
