from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from loguru import logger

from services.horde_client import get_horde_client
from services.prompt_enhancer import get_prompt_enhancer
from services.characters import get_character_manager
from services.task_persistence import get_task_service, TaskType

router = APIRouter(prefix="/horde")


# Request/Response models
class ImageGenerateRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = None
    model: Optional[str] = None
    category: Optional[str] = "anime"  # realism, anime, flux, furry
    width: int = 1024
    height: int = 1024
    steps: int = 25
    cfg_scale: float = 7.0
    sampler: str = "k_euler_a"
    temperature: float = 1.0
    seed: int = -1
    nsfw: bool = True
    enhance_prompt: bool = False
    user_id: str  # Required for task tracking


class ChatRequest(BaseModel):
    prompt: str
    model: Optional[str] = None
    max_tokens: int = 256
    temperature: float = 0.8
    character_id: Optional[str] = None
    conversation_history: Optional[List[Dict[str, str]]] = None
    user_id: str  # Required for task tracking


@router.post("/image/generate")
async def generate_image(request: ImageGenerateRequest):
    """
    Generate an image using AI Horde (background task)
    
    Returns task_id immediately for client to poll status
    """
    try:
        horde = get_horde_client()
        task_service = get_task_service()
        
        # Enhance prompt if requested
        prompt = request.prompt
        if request.enhance_prompt:
            enhancer = get_prompt_enhancer()
            if enhancer.is_enabled():
                style = "realistic" if request.category == "realism" else request.category
                prompt = await enhancer.enhance_prompt(request.prompt, style)
                logger.info(f"Enhanced prompt: {request.prompt} -> {prompt}")
        
        # Use default model if none specified
        model = request.model
        if not model:
            model = horde.get_default_model(request.category)
        
        # Start image generation (async - returns request ID)
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{horde.BASE_URL}/generate/async",
                json={
                    "prompt": prompt,
                    "params": {
                        "sampler_name": request.sampler,
                        "cfg_scale": request.cfg_scale,
                        "steps": request.steps,
                        "width": request.width,
                        "height": request.height,
                        "seed": str(request.seed) if request.seed != -1 else "",
                        "negative_prompt": request.negative_prompt or horde.default_negative,
                    },
                    "nsfw": request.nsfw,
                    "censor_nsfw": False if request.nsfw else True,
                    "models": [model],
                    "r2": True
                },
                headers=horde.headers
            ) as resp:
                if resp.status != 202:
                    error = await resp.json()
                    raise Exception(f"Horde request failed: {error}")
                
                data = await resp.json()
                horde_request_id = data["id"]
                logger.info(f"Started AI Horde image generation: {horde_request_id}")
        
        # Create background task
        task_id = task_service.create_task(
            user_id=request.user_id,
            task_type=TaskType.IMAGE_GENERATION,
            horde_request_id=horde_request_id,
            prompt=prompt,
            parameters={
                "model": model,
                "width": request.width,
                "height": request.height,
                "steps": request.steps,
                "enhanced_prompt": prompt if request.enhance_prompt else None,
                "original_prompt": request.prompt if request.enhance_prompt else None
            }
        )
        
        return {
            "success": True,
            "task_id": task_id,
            "horde_request_id": horde_request_id,
            "message": "Image generation started in background"
        }
        
    except Exception as e:
        logger.error(f"Image generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat")
async def chat(request: ChatRequest):
    """
    Chat using AI Horde text models (background task)
    
    Returns task_id immediately for client to poll status
    """
    try:
        horde = get_horde_client()
        task_service = get_task_service()
        char_manager = get_character_manager()
        
        # Build prompt
        prompt = request.prompt
        history = request.conversation_history or []
        
        # If character selected, use character prompt
        if request.character_id:
            prompt = char_manager.get_character_prompt(
                request.character_id,
                request.prompt,
                history
            )
            logger.info(f"Using character: {request.character_id}")
        
        # Determine model
        model = request.model
        if not model:
            # Get optimal text model (prefer Mystral or fastest)
            text_models = horde.get_models("text")
            if text_models:
                # Prefer Mystral if available
                mystral = next((m for m in text_models if "mystral" in m["name"].lower()), None)
                if mystral:
                    model = mystral["name"]
                else:
                    # Use fastest model
                    model = text_models[0]["name"]
            else:
                model = horde.get_default_model("chat")
        
        # Format conversation for payload
        full_prompt = prompt
        if history and not request.character_id:
            context = "\n".join([
                f"{msg['role']}: {msg['content']}" 
                for msg in history[-10:]
            ])
            full_prompt = f"{context}\nUser: {prompt}\nAssistant:"
        
        # Start chat request (async)
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{horde.BASE_URL}/generate/text/async",
                json={
                    "prompt": full_prompt,
                    "params": {
                        "max_length": request.max_tokens,
                        "max_context_length": 2048,
                        "temperature": request.temperature,
                        "top_p": 0.9,
                        "top_k": 40,
                        "repetition_penalty": 1.1
                    },
                    "models": [model]
                },
                headers=horde.headers
            ) as resp:
                if resp.status != 202:
                    error = await resp.json()
                    raise Exception(f"Chat request failed: {error}")
                
                data = await resp.json()
                horde_request_id = data["id"]
                logger.info(f"Started AI Horde chat: {horde_request_id}")
        
        # Create background task
        task_type = TaskType.ROLEPLAY_RESPONSE if request.character_id else TaskType.CHAT_RESPONSE
        task_id = task_service.create_task(
            user_id=request.user_id,
            task_type=task_type,
            horde_request_id=horde_request_id,
            prompt=request.prompt,
            parameters={
                "model": model,
                "character_id": request.character_id
            }
        )
        
        return {
            "success": True,
            "task_id": task_id,
            "horde_request_id": horde_request_id,
            "message": "Chat request started in background"
        }
        
    except Exception as e:
        logger.error(f"Chat failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))




@router.get("/models")
async def get_models(model_type: str = "image"):
    """
    Get list of active AI Horde models (count > 0)
    
    Args:
        model_type: "image" or "text"
    """
    try:
        horde = get_horde_client()
        models = horde.get_models(model_type)
        
        # Format for frontend
        formatted = []
        for m in models[:50]:  # Limit to top 50
            formatted.append({
                "name": m["name"],
                "type": m["type"],
                "count": m["count"],
                "performance": m.get("performance", 0),
                "queued": m.get("queued", 0),
                "eta": m.get("eta", 0)
            })
        
        # Add default recommendations
        defaults = {
            "realism": horde.get_default_model("realism"),
            "anime": horde.get_default_model("anime"),
            "flux": horde.get_default_model("flux"),
            "furry": horde.get_default_model("furry"),
            "chat": horde.get_default_model("chat")
        }
        
        return {
            "success": True,
            "models": formatted,
            "defaults": defaults,
            "total": len(models)
        }
        
    except Exception as e:
        logger.error(f"Get models failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str):
    """
    Get status of a background task (image, chat, or roleplay)
    
    Args:
        task_id: Task ID returned from generation/chat endpoints
    
    Returns:
        Task status and result if completed
    """
    try:
        task_service = get_task_service()
        task = task_service.get_task(task_id)
        
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        response = {
            "success": True,
            "task_id": task["task_id"],
            "status": task["status"],
            "task_type": task["task_type"],
            "created_at": task["created_at"]
        }
        
        # Include result if completed
        if task["status"] == "completed" and task.get("result"):
            response["result"] = task["result"]
            response["error"] = task["error_message"]
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get task status failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tasks/user/{user_id}")
async def get_user_tasks(
    user_id: str,
    status: Optional[str] = None,
    limit: int = 20
):
    """
    Get all tasks for a user
    
    Args:
        user_id: User ID
        status: Optional status filter (queued, processing, completed, failed)
        limit: Max number of tasks to return
    """
    try:
        from services.task_persistence import TaskStatus
        task_service = get_task_service()
        
        status_enum = None
        if status:
            try:
                status_enum = TaskStatus(status)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
        
        tasks = task_service.get_user_tasks(user_id, status_enum, limit)
        
        return {
            "success": True,
            "tasks": tasks,
            "total": len(tasks)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get user tasks failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prompt/enhance")
async def enhance_prompt(
    prompt: str,
    style: str = "realistic"
):
    """
    Enhance a prompt using AI
    
    Args:
        prompt: Basic prompt
        style: Image style (realistic, anime, artistic)
    """
    try:
        enhancer = get_prompt_enhancer()
        
        if not enhancer.is_enabled():
            return {
                "success": False,
                "error": "Prompt enhancement is disabled",
                "enhanced_prompt": prompt
            }
        
        enhanced = await enhancer.enhance_prompt(prompt, style)
        
        return {
            "success": True,
            "original_prompt": prompt,
            "enhanced_prompt": enhanced,
            "style": style
        }
        
    except Exception as e:
        logger.error(f"Prompt enhancement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
