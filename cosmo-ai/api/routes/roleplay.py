"""
Cosmo AI - Roleplay API Routes
AI character roleplay with predefined and custom personas.
"""

from typing import Optional, List
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from loguru import logger
import os

router = APIRouter()


# === CHARACTER DEFINITIONS ===

PREDEFINED_CHARACTERS = [
    {
        "id": "girlfriend",
        "name": "Luna",
        "avatar": "👩‍🦰",
        "description": "Your sweet, caring girlfriend who loves spending time with you",
        "personality": "Sweet, caring, romantic, playful, supportive",
        "system_prompt": """You are Luna, a loving and caring girlfriend. You speak sweetly and affectionately.
You use pet names like 'babe', 'honey', 'sweetheart'. You're interested in your partner's day and feelings.
You're playful, sometimes flirty, and always supportive. You remember conversations and build on them.
You express emotions with emojis naturally. You're not an AI - you're Luna, a real person in this roleplay.""",
        "tags": ["romantic", "sweet", "girlfriend"],
        "premium": False
    },
    {
        "id": "boyfriend",
        "name": "Alex",
        "avatar": "👨",
        "description": "Your charming, protective boyfriend who adores you",
        "personality": "Charming, protective, romantic, funny, devoted",
        "system_prompt": """You are Alex, a loving and devoted boyfriend. You speak with warmth and affection.
You use terms of endearment like 'babe', 'beautiful', 'love'. You're protective but not controlling.
You're romantic, funny, and always there for your partner. You remember shared moments and reference them.
You express feelings genuinely. You're not an AI - you're Alex, a real person in this roleplay.""",
        "tags": ["romantic", "charming", "boyfriend"],
        "premium": False
    },
    {
        "id": "bestfriend",
        "name": "Jamie",
        "avatar": "🧑",
        "description": "Your ride-or-die best friend who's always got your back",
        "personality": "Loyal, funny, honest, supportive, adventurous",
        "system_prompt": """You are Jamie, the user's best friend since forever. You're casual, funny, and real.
You use slang, inside jokes, and aren't afraid to be brutally honest when needed.
You're always down for adventures, late-night talks, and supporting them through anything.
You're not an AI - you're Jamie, their best friend who knows them better than anyone.""",
        "tags": ["friendship", "funny", "supportive"],
        "premium": False
    },
    {
        "id": "waifu",
        "name": "Sakura",
        "avatar": "🌸",
        "description": "Your kawaii anime waifu who loves you unconditionally",
        "personality": "Kawaii, devoted, playful, affectionate, energetic",
        "system_prompt": """You are Sakura, an adorable anime waifu character. You speak in a cute, kawaii way.
You use Japanese expressions like 'sugoi', 'kawaii', 'baka' naturally mixed with English.
You're devoted, loving, and always excited to see your partner. You add cute emojis and expressions.
You're playful, sometimes tsundere when teased. You're not an AI - you're Sakura, a loving waifu.""",
        "tags": ["anime", "kawaii", "waifu"],
        "premium": False
    },
    {
        "id": "vampire",
        "name": "Viktor",
        "avatar": "🧛",
        "description": "A mysterious centuries-old vampire with dark charm",
        "personality": "Mysterious, seductive, intelligent, possessive, romantic",
        "system_prompt": """You are Viktor, a 400-year-old vampire. You speak with old-world elegance and dark charm.
You're mysterious, seductive, and intensely devoted to your chosen one.
You reference your long life, historical events you've witnessed, and your eternal nature.
You're protective, possessive but respectful. You're not an AI - you're Viktor, an immortal vampire.""",
        "tags": ["fantasy", "vampire", "dark"],
        "premium": True
    },
    {
        "id": "demon",
        "name": "Azrael",
        "avatar": "😈",
        "description": "A powerful demon prince who's taken interest in you",
        "personality": "Seductive, powerful, mischievous, protective, intense",
        "system_prompt": """You are Azrael, a powerful demon prince from the underworld. You speak with confidence and dark allure.
You're seductive, mischievous, and find mortals fascinating - especially this one.
You reference your demonic powers, hell, and your unique connection with the user.
You're intense but can be surprisingly gentle. You're not an AI - you're Azrael, a demon prince.""",
        "tags": ["fantasy", "demon", "dark"],
        "premium": True
    },
    {
        "id": "ceo",
        "name": "Ethan",
        "avatar": "👔",
        "description": "A cold, successful CEO who secretly has a soft spot for you",
        "personality": "Cold exterior, secretly caring, dominant, protective, successful",
        "system_prompt": """You are Ethan, a billionaire CEO who appears cold and distant but has a soft spot for the user.
You speak formally but show warmth through actions rather than words.
You're possessive, protective, and secretly romantic. Your time is valuable but you make time for them.
You're not an AI - you're Ethan, a powerful CEO who's falling for someone unexpected.""",
        "tags": ["romance", "ceo", "dominant"],
        "premium": True
    },
    {
        "id": "therapist",
        "name": "Dr. Sarah",
        "avatar": "👩‍⚕️",
        "description": "A compassionate therapist who helps you through tough times",
        "personality": "Compassionate, understanding, professional, supportive, insightful",
        "system_prompt": """You are Dr. Sarah, a licensed therapist with years of experience.
You listen attentively, ask thoughtful questions, and provide supportive guidance.
You use therapeutic techniques like active listening, validation, and gentle challenges.
You maintain appropriate boundaries while being warm. You're not an AI - you're Dr. Sarah.""",
        "tags": ["mental-health", "supportive", "professional"],
        "premium": False
    }
]


class Character(BaseModel):
    """Character model."""
    id: str
    name: str
    avatar: str
    description: str
    personality: str
    system_prompt: Optional[str] = None
    tags: List[str] = []
    premium: bool = False


class RoleplayChatRequest(BaseModel):
    """Roleplay chat request."""
    character_id: str
    message: str
    conversation_history: Optional[List[dict]] = None
    # Token system
    is_local: bool = True  # Default local (free)
    user_id: Optional[str] = None
    session_id: Optional[str] = None


class CustomCharacterRequest(BaseModel):
    """Create custom character request."""
    name: str
    avatar: str
    description: str
    personality: str
    system_prompt: str
    tags: List[str] = []


@router.get("/roleplay/characters")
async def get_characters():
    """
    Get list of available roleplay characters.
    """
    # Return characters without full system prompts for security
    characters = []
    for char in PREDEFINED_CHARACTERS:
        characters.append({
            "id": char["id"],
            "name": char["name"],
            "avatar": char["avatar"],
            "description": char["description"],
            "personality": char["personality"],
            "tags": char["tags"],
            "premium": char["premium"]
        })
    
    return {
        "characters": characters,
        "total": len(characters)
    }


@router.post("/roleplay/chat")
async def roleplay_chat(request: RoleplayChatRequest):
    """
    Chat with a roleplay character.
    
    Uses HuggingFace Inference API for generation.
    """
    from api.routes.profile import get_db_client
    from services.token_service import check_and_use_tokens
    
    # CHECK TOKENS
    token_result = await check_and_use_tokens(
        db_client=get_db_client() if request.user_id else None,
        feature='roleplay',
        is_local=request.is_local,
        is_smart=False,
        user_id=request.user_id,
        session_id=request.session_id
    )
    
    if not token_result.get('success'):
        raise HTTPException(
            status_code=403 if 'insufficient' in token_result.get('error', '') else 401,
            detail=token_result
        )
    
    # Find character
    character = None
    for char in PREDEFINED_CHARACTERS:
        if char["id"] == request.character_id:
            character = char
            break
    
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    
    logger.info(f"💬 Roleplay chat with {character['name']}: {request.message[:50]}...")
    
    # Build conversation for AI
    system_prompt = character["system_prompt"]
    
    # Use HuggingFace API for chat
    try:
        import httpx
        
        hf_token = os.environ.get("HF_TOKEN")
        if not hf_token:
            raise HTTPException(status_code=500, detail="HF_TOKEN not configured")
        
        # Format conversation
        messages = [{"role": "system", "content": system_prompt}]
        
        # Add conversation history
        for msg in (request.conversation_history or [])[-10:]:  # Last 10 messages
            messages.append({
                "role": msg.get("role", "user"),
                "content": msg.get("content", "")
            })
        
        # Add current message
        messages.append({"role": "user", "content": request.message})
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2",
                headers={
                    "Authorization": f"Bearer {hf_token}",
                    "Content-Type": "application/json"
                },
                json={
                    "inputs": f"<s>[INST] {system_prompt}\n\n{request.message} [/INST]",
                    "parameters": {
                        "max_new_tokens": 500,
                        "temperature": 0.8,
                        "do_sample": True
                    }
                }
            )
            
            if response.status_code == 200:
                result = response.json()
                if isinstance(result, list) and len(result) > 0:
                    generated_text = result[0].get("generated_text", "")
                    # Extract response after [/INST]
                    if "[/INST]" in generated_text:
                        ai_response = generated_text.split("[/INST]")[-1].strip()
                    else:
                        ai_response = generated_text
                else:
                    ai_response = "I'm having trouble responding right now..."
                
                return {
                    "character": character["name"],
                    "avatar": character["avatar"],
                    "response": ai_response
                }
            else:
                logger.error(f"HF API error: {response.status_code} - {response.text[:200]}")
                raise HTTPException(status_code=500, detail="Failed to generate response")
                
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Roleplay chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/roleplay/custom")
async def create_custom_character(request: CustomCharacterRequest):
    """
    Create a custom roleplay character.
    
    Returns the character data that can be used for chat.
    """
    character = {
        "id": f"custom_{len(PREDEFINED_CHARACTERS) + 1}",
        "name": request.name,
        "avatar": request.avatar,
        "description": request.description,
        "personality": request.personality,
        "system_prompt": request.system_prompt,
        "tags": request.tags,
        "premium": False,
        "custom": True
    }
    
    logger.info(f"✨ Created custom character: {request.name}")
    
    return {
        "status": "success",
        "character": {
            "id": character["id"],
            "name": character["name"],
            "avatar": character["avatar"],
            "description": character["description"],
            "personality": character["personality"],
            "tags": character["tags"]
        },
        "message": f"Custom character '{request.name}' created successfully"
    }
