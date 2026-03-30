"""
Whisper AI - Image Generation API Routes
Text-to-image generation using HuggingFace Inference API (FREE, no GPU needed).

Optimized for deployment on 16GB basic CPU servers (HuggingFace Spaces free tier).
Uses HF Inference API by default - no local GPU required!
"""

import os
import uuid
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from loguru import logger
from services.admin_state import get_model_enabled
from utils.app_paths import UPLOADS_DIR


router = APIRouter()

# === SERVER CONFIGURATION ===
# Default model for server - FLUX.1-schnell is the only FREE model on HF Inference API!
# Other models (dreamshaper, sdxl-turbo, etc.) return 404 on free tier
DEFAULT_SERVER_MODEL = os.environ.get("DEFAULT_IMAGE_MODEL", "flux-schnell")
USE_HF_API_ONLY = os.environ.get("USE_HF_API_ONLY", "true").lower() == "true"  # For 16GB CPU servers
TEST_MODE = os.environ.get("WHISPER_TEST_MODE", "false").lower() == "true"


class ImageGenerationRequest(BaseModel):
    """Image generation request model."""
    model_config = {"protected_namespaces": ()}
    
    prompt: str
    negative_prompt: Optional[str] = None
    width: int = 512
    height: int = 512
    num_steps: int = 4  # FLUX-schnell uses few steps
    guidance_scale: float = 0.0  # FLUX models don't need guidance
    model_id: str = "flux-schnell"  # Default: FLUX.1-schnell (only free model that works!)
    # Token system parameters
    is_local: bool = False  # Cloud by default (images cost tokens)
    user_id: Optional[str] = None
    session_id: Optional[str] = None


# HuggingFace Inference API - Only these models work on FREE tier!
# All other SD models return 404 on the free serverless API
IMAGE_MODEL_IDS = {
    # === FREE TIER MODELS (Actually work on HF Inference API) ===
    "flux-schnell": "black-forest-labs/FLUX.1-schnell",  # ✅ WORKS - Only free model!
    "flux-dev": "black-forest-labs/FLUX.1-dev",  # May work with token
    
    # === LEGACY MAPPINGS (All redirect to flux-schnell since they don't work) ===
    # These are kept for backwards compatibility but will use flux-schnell
    "dreamshaper-8": "black-forest-labs/FLUX.1-schnell",  # Redirect - SD not on free tier
    "dreamshaper": "black-forest-labs/FLUX.1-schnell",
    "sdxl-turbo": "black-forest-labs/FLUX.1-schnell",  # Redirect - not on free tier
    "sd-turbo": "black-forest-labs/FLUX.1-schnell",
    "sd-1.5": "black-forest-labs/FLUX.1-schnell",
    "absolutereality": "black-forest-labs/FLUX.1-schnell",
    "realistic-vision": "black-forest-labs/FLUX.1-schnell",
    "rev-animated": "black-forest-labs/FLUX.1-schnell",
    "anything-v5": "black-forest-labs/FLUX.1-schnell",
    "openjourney": "black-forest-labs/FLUX.1-schnell",
    "deliberate-v3": "black-forest-labs/FLUX.1-schnell",
    "lyriel": "black-forest-labs/FLUX.1-schnell",
    "protogen-x34": "black-forest-labs/FLUX.1-schnell",
    "epicrealism": "black-forest-labs/FLUX.1-schnell",
    "counterfeit-v3": "black-forest-labs/FLUX.1-schnell",
    "meinamix-v11": "black-forest-labs/FLUX.1-schnell",
    "chilloutmix": "black-forest-labs/FLUX.1-schnell",
    "juggernaut-xl": "black-forest-labs/FLUX.1-schnell",
    "playground-v2": "black-forest-labs/FLUX.1-schnell",
    "ssd-1b": "black-forest-labs/FLUX.1-schnell",
    "pixart-sigma": "black-forest-labs/FLUX.1-schnell",
}

IMAGE_MODEL_CATALOG = [
    {
        "id": "flux-schnell",
        "name": "FLUX.1 Schnell",
        "description": "Best default for free-tier Hugging Face inference",
        "style": "fast",
        "provider": "hf_api",
        "supported": True,
        "recommended": True,
        "hf_repo": IMAGE_MODEL_IDS["flux-schnell"],
    },
    {
        "id": "flux-dev",
        "name": "FLUX.1 Dev",
        "description": "Higher-quality FLUX profile when token-backed routing is available",
        "style": "quality",
        "provider": "hf_api",
        "supported": True,
        "recommended": False,
        "hf_repo": IMAGE_MODEL_IDS["flux-dev"],
    },
    {
        "id": "sdxl-turbo",
        "name": "SDXL Turbo",
        "description": "Legacy preset routed to FLUX.1 Schnell on this deployment",
        "style": "fast",
        "provider": "hf_api_alias",
        "supported": True,
        "recommended": False,
        "alias_for": "flux-schnell",
        "hf_repo": IMAGE_MODEL_IDS["sdxl-turbo"],
    },
    {
        "id": "dreamshaper-8",
        "name": "DreamShaper 8",
        "description": "Legacy artistic preset routed to FLUX.1 Schnell",
        "style": "artistic",
        "provider": "hf_api_alias",
        "supported": True,
        "recommended": False,
        "alias_for": "flux-schnell",
        "hf_repo": IMAGE_MODEL_IDS["dreamshaper-8"],
    },
    {
        "id": "epicrealism",
        "name": "epiCRealism",
        "description": "Legacy realism preset routed to FLUX.1 Schnell",
        "style": "realistic",
        "provider": "hf_api_alias",
        "supported": True,
        "recommended": False,
        "alias_for": "flux-schnell",
        "hf_repo": IMAGE_MODEL_IDS["epicrealism"],
    },
    {
        "id": "deliberate-v3",
        "name": "Deliberate v3",
        "description": "Legacy artistic preset routed to FLUX.1 Schnell",
        "style": "artistic",
        "provider": "hf_api_alias",
        "supported": True,
        "recommended": False,
        "alias_for": "flux-schnell",
        "hf_repo": IMAGE_MODEL_IDS["deliberate-v3"],
    },
]


class ImageGenerationResponse(BaseModel):
    """Image generation response model."""
    image_url: str
    seed: int
    prompt: str


# Lazy load image generator (for local mode only)
_image_generator = None
_current_server_model = DEFAULT_SERVER_MODEL if DEFAULT_SERVER_MODEL in IMAGE_MODEL_IDS else "flux-schnell"


def _enabled_image_catalog() -> list[dict]:
    return [
        model
        for model in IMAGE_MODEL_CATALOG
        if get_model_enabled(f"image.{model['id']}", True)
    ]


def _active_image_model() -> Optional[str]:
    enabled_models = _enabled_image_catalog()
    enabled_ids = {model["id"] for model in enabled_models}
    if _current_server_model in enabled_ids:
        return _current_server_model
    if DEFAULT_SERVER_MODEL in enabled_ids:
        return DEFAULT_SERVER_MODEL
    return enabled_models[0]["id"] if enabled_models else None


def _generate_test_image(filepath, prompt: str, width: int, height: int):
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (width, height), color=(15, 23, 42))
    draw = ImageDraw.Draw(image)
    draw.rectangle((24, 24, width - 24, height - 24), outline=(20, 184, 166), width=4)
    draw.text((32, 32), prompt[:80], fill=(229, 231, 235))
    image.save(filepath, format="PNG")


async def generate_via_hf_api(prompt: str, width: int = 512, height: int = 512, model_id: str = "sdxl-turbo") -> bytes:
    """
    Generate image using HuggingFace Inference API.
    
    Uses httpx for async HTTP requests (InferenceClient has issues with asyncio).
    FREE, NO GPU NEEDED - Perfect for 16GB basic CPU servers!
    
    Args:
        prompt: Text description of the image to generate
        width: Image width (max 1024)
        height: Image height (max 1024)
        model_id: Model to use (default: sdxl-turbo for speed)
    
    Returns:
        Image bytes (PNG format)
    """
    import httpx
    
    # Get HF model ID from our mapping (all map to flux-schnell on free tier)
    hf_model = IMAGE_MODEL_IDS.get(model_id, "black-forest-labs/FLUX.1-schnell")
    
    # HuggingFace Inference API endpoint
    # Note: router.huggingface.co requires HF_TOKEN
    # Fallback to api-inference if no token (public models only)
    hf_token = os.environ.get("HF_TOKEN")
    
    if hf_token:
        # New HF Router endpoint (requires token)
        API_URL = f"https://router.huggingface.co/hf-inference/models/{hf_model}"
    else:
        # Old endpoint for public models (no token needed, but rate-limited)
        API_URL = f"https://api-inference.huggingface.co/models/{hf_model}"
    
    headers = {"Content-Type": "application/json"}
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"
    
    logger.info(f"🖼️ Generating image with HF API: model={hf_model}, prompt={prompt[:50]}...")
    logger.info(f"🔗 Using endpoint: {API_URL[:60]}... (token: {'yes' if hf_token else 'no'})")
    
    async with httpx.AsyncClient(timeout=180.0) as client:
        # Try up to 3 times (models may need to warm up on free tier)
        for attempt in range(3):
            try:
                response = await client.post(
                    API_URL,
                    headers=headers,
                    json={
                        "inputs": prompt,
                        "parameters": {
                            "width": min(width, 1024),
                            "height": min(height, 1024),
                        }
                    }
                )
                
                if response.status_code == 200:
                    logger.info(f"✅ Image generated successfully with {model_id}")
                    return response.content
                elif response.status_code == 503:
                    # Model loading - wait and retry
                    logger.warning(f"Model loading... Attempt {attempt + 1}/3")
                    import asyncio
                    await asyncio.sleep(10)
                    continue
                elif response.status_code == 404:
                    # Model not found - this shouldn't happen with flux-schnell
                    logger.error(f"Model {hf_model} not found (404)")
                    logger.error(f"Response: {response.text[:500]}")
                    raise Exception(f"HF API model not found: {hf_model}")
                else:
                    logger.error(f"HF API error: {response.status_code} - {response.text[:200]}")
                    raise Exception(f"HF API failed: {response.status_code}")
            except httpx.TimeoutException:
                if attempt == 2:
                    raise Exception("HF API timeout after 3 attempts")
                logger.warning(f"Timeout, retrying... Attempt {attempt + 1}/3")
                continue
            except Exception as e:
                if attempt == 2:
                    raise
                logger.warning(f"Attempt {attempt + 1} failed: {e}")
                continue
        
        raise Exception("HF API failed after 3 attempts")


def get_image_generator():
    """Get or create image generator - runs locally without external APIs."""
    global _image_generator, _use_api
    
    if _image_generator is None:
        try:
            import torch
            from diffusers import StableDiffusionPipeline
            
            # Allow model configuration via env var
            model_id = os.environ.get("IMAGE_MODEL_ID", "runwayml/stable-diffusion-v1-5")
            
            logger.info(f"Loading image model: {model_id}...")
            logger.info("Note: This runs on CPU and will be slow (5-10 mins per image)")
            
            _image_generator = StableDiffusionPipeline.from_pretrained(
                model_id,
                torch_dtype=torch.float32,  # Use float32 for CPU
                safety_checker=None,  # Disable for speed
                requires_safety_checker=False
            )
            
            # Check if GPU available
            if torch.cuda.is_available():
                _image_generator.to("cuda")
                _image_generator.enable_attention_slicing()  # Save VRAM
                logger.info("Image generator loaded on GPU")
            else:
                _image_generator.to("cpu")
                _image_generator.enable_attention_slicing()  # Reduce memory
                logger.info("Image generator loaded on CPU (slow mode)")
            
            _use_api = False
        
        except ImportError:
            logger.warning("diffusers not installed. Install with: pip install diffusers transformers accelerate")
            _use_api = False
            return None
        except Exception as e:
            logger.error(f"Failed to load image generator: {e}")
            _use_api = False
            return None
    
    return _image_generator


@router.post("/image/generate")
async def generate_image(request: ImageGenerationRequest) -> ImageGenerationResponse:
    """
    Generate an image from text prompt.
    
    Args:
        request: Image generation parameters
    
    Returns:
        URL to generated image
    """
    import random
    from api.routes.profile import get_supabase
    from services.token_service import check_and_use_tokens

    async def _log_generated_image(image_url: str):
        try:
            get_supabase().table("generated_images").insert(
                {
                    "user_id": request.user_id,
                    "session_id": request.session_id,
                    "prompt": request.prompt,
                    "model_id": selected_model,
                    "image_url": image_url,
                    "is_local": request.is_local,
                }
            ).execute()
        except Exception as log_exc:
            logger.warning(f"Failed to log generated image: {log_exc}")
    
    # CHECK TOKENS - Image generation costs more
    token_result = await check_and_use_tokens(
        supabase=get_supabase() if request.user_id else None,
        feature='image',
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
    
    # Validate dimensions
    max_dim = 1024
    if request.width > max_dim or request.height > max_dim:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum dimension is {max_dim}x{max_dim}"
        )
    
    # Setup output
    output_dir = UPLOADS_DIR / "generated"
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.png"
    filepath = output_dir / filename
    seed = random.randint(0, 2**32 - 1)
    selected_model = request.model_id or _active_image_model()

    if not selected_model:
        raise HTTPException(status_code=503, detail="No image models are currently enabled")

    enabled_ids = {model["id"] for model in _enabled_image_catalog()}
    if selected_model not in IMAGE_MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model_id. Available: {[model['id'] for model in _enabled_image_catalog()]}",
        )
    if selected_model not in enabled_ids:
        raise HTTPException(status_code=400, detail=f"Model '{selected_model}' is disabled by admin")

    if TEST_MODE:
        _generate_test_image(filepath, request.prompt, request.width, request.height)
        await _log_generated_image(f"/static/generated/{filename}")
        return ImageGenerationResponse(
            image_url=f"/static/generated/{filename}",
            seed=seed,
            prompt=request.prompt,
        )

    # Try HF API if model is supported (allows model switching)
    if selected_model in IMAGE_MODEL_IDS:
        try:
            logger.info(f"Generating with HF API Model: {selected_model}")
            image_bytes = await generate_via_hf_api(
                prompt=request.prompt, 
                width=request.width, 
                height=request.height, 
                model_id=selected_model
            )
            
            with open(filepath, "wb") as f:
                f.write(image_bytes)
            await _log_generated_image(f"/static/generated/{filename}")
                
            return ImageGenerationResponse(
                image_url=f"/static/generated/{filename}",
                seed=seed,
                prompt=request.prompt
            )
        except Exception as e:
            logger.error(f"HF API failed, falling back to local: {e}")
            # Fallthrough to local generator
    
    generator = get_image_generator()
    if generator is not None:
        try:
            import torch
            
            # Generate image
            generator_torch = torch.Generator().manual_seed(seed)
            
            image = generator(
                prompt=request.prompt,
                negative_prompt=request.negative_prompt,
                width=request.width,
                height=request.height,
                num_inference_steps=request.num_steps,
                guidance_scale=request.guidance_scale,
                generator=generator_torch
            ).images[0]
            
            # Save image
            filename = f"{uuid.uuid4().hex}.png"
            filepath = output_dir / filename
            image.save(filepath)
            await _log_generated_image(f"/static/generated/{filename}")
            
            return ImageGenerationResponse(
                image_url=f"/static/generated/{filename}",
                seed=seed,
                prompt=request.prompt
            )
        
        except Exception as e:
            logger.error(f"Image generation failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    raise HTTPException(
        status_code=503,
        detail="Image generation is unavailable. Configure HF_TOKEN for supported models or install a local diffusers pipeline."
    )


@router.get("/image/models")
async def list_models():
    """List available image generation models - FREE ONLY (no login required)."""
    models = _enabled_image_catalog()
    active_model = _active_image_model()
    return {
        "models": models,
        "current_model": active_model,
        "status": "hf_api" if USE_HF_API_ONLY else ("local" if get_image_generator() else "api"),
        "mode": "HuggingFace Inference API (FREE, no GPU)" if USE_HF_API_ONLY else "Local/Hybrid",
        "default_model": DEFAULT_SERVER_MODEL,
    }
    return {
        "models": [
            # FLUX GGUF (free, city96)
            {"id": "flux-schnell-q4", "name": "FLUX.1 Schnell Q4", "description": "⚡ Best quality/size balance", "style": "fast"},
            {"id": "flux-schnell-q2", "name": "FLUX.1 Schnell Q2", "description": "⚡ Compact version", "style": "fast"},
            # SD 1.5 (free)
            {"id": "dreamshaper-8", "name": "DreamShaper 8", "description": "🎨 Artistic, detailed", "style": "artistic"},
            {"id": "epicrealism", "name": "epiCRealism", "description": "📷 Photorealistic", "style": "realistic"},
            {"id": "deliberate-v3", "name": "Deliberate v3", "description": "🎭 Versatile artistic", "style": "artistic"},
            # SDXL (free)
            {"id": "sdxl-turbo", "name": "SDXL Turbo", "description": "🚀 Extremely fast", "style": "fast"},
            {"id": "juggernaut-xl-lightning", "name": "Juggernaut XL", "description": "👑 Top-tier realism", "style": "realistic"},
            
            # === UNCENSORED MODELS ===
            {"id": "pony-diffusion-v6", "name": "🔓 Pony V6 XL", "description": "🔥 Uncensored SDXL", "style": "uncensored"},
            {"id": "autismmix-sdxl", "name": "🔓 AutismMix SDXL", "description": "🎨 Best anime uncensored", "style": "uncensored"},
            {"id": "hassaku-xl", "name": "🔓 Hassaku XL", "description": "🇯🇵 Japanese anime", "style": "uncensored"},
            {"id": "cyberrealistic-v4", "name": "🔓 CyberRealistic", "description": "📷 Ultra-realistic", "style": "uncensored"},
            {"id": "meinamix-v11", "name": "🔓 MeinaMix v11", "description": "🎌 Top anime SD1.5", "style": "uncensored"},
            {"id": "absolutereality-v1", "name": "🔓 AbsoluteReality", "description": "📸 Photorealistic", "style": "uncensored"},
            {"id": "counterfeit-v3", "name": "🔓 Counterfeit V3", "description": "🎨 Vibrant anime", "style": "uncensored"},
            {"id": "anything-v5", "name": "🔓 Anything V5", "description": "🌸 Classic anime", "style": "uncensored"},
            {"id": "chilloutmix", "name": "🔓 ChilloutMix", "description": "📷 Asian-style", "style": "uncensored"},
            {"id": "rev-animated", "name": "🔓 ReV Animated", "description": "🎭 Semi-realistic", "style": "uncensored"},
        ],
        "current_model": _current_server_model,
        "status": "hf_api" if USE_HF_API_ONLY else ("local" if get_image_generator() else "api"),
        "mode": "HuggingFace Inference API (FREE, no GPU)" if USE_HF_API_ONLY else "Local/Hybrid"
    }


@router.get("/image/server/config")
async def get_server_config():
    """
    Get current server image generation configuration.
    
    Returns server mode, default model, and available models for switching.
    """
    active_model = _active_image_model()
    models = _enabled_image_catalog()
    return {
        "default_model": active_model,
        "use_hf_api_only": USE_HF_API_ONLY,
        "mode": "HuggingFace Inference API (FREE)" if USE_HF_API_ONLY else "Local + API Fallback",
        "deployment_info": {
            "optimized_for": "16GB CPU Server (HuggingFace Spaces Free Tier)",
            "gpu_required": False,
            "api_cost": "FREE (with optional HF_TOKEN for higher rate limits)"
        },
        "available_models": [model["id"] for model in models],
        "recommended_models": [
            {"id": model["id"], "reason": model["description"]}
            for model in models
            if model.get("recommended")
        ]
    }
    return {
        "default_model": _current_server_model,
        "use_hf_api_only": USE_HF_API_ONLY,
        "mode": "HuggingFace Inference API (FREE)" if USE_HF_API_ONLY else "Local + API Fallback",
        "deployment_info": {
            "optimized_for": "16GB CPU Server (HuggingFace Spaces Free Tier)",
            "gpu_required": False,
            "api_cost": "FREE (with optional HF_TOKEN for higher rate limits)"
        },
        "available_models": list(IMAGE_MODEL_IDS.keys()),
        "recommended_models": [
            {"id": "sdxl-turbo", "reason": "🚀 Fastest, best for free tier"},
            {"id": "dreamshaper-8", "reason": "🎨 Best artistic quality"},
            {"id": "epicrealism", "reason": "📷 Best photorealistic"},
            {"id": "pony-diffusion-v6", "reason": "🔓 Best uncensored SDXL"},
            {"id": "meinamix-v11", "reason": "🔓 Best uncensored anime (low RAM)"},
        ]
    }


@router.post("/image/server/model")
async def set_server_model(model_id: str):
    """
    Set the default server model for image generation.
    
    Users can switch models from the app - this sets the server default.
    
    Args:
        model_id: Model ID to use as default (must be in IMAGE_MODEL_IDS)
    
    Returns:
        Confirmation of model change
    """
    global _current_server_model
    
    if model_id not in IMAGE_MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model_id. Available: {list(IMAGE_MODEL_IDS.keys())}"
        )
    if not get_model_enabled(f"image.{model_id}", True):
        raise HTTPException(status_code=400, detail=f"Model '{model_id}' is disabled by admin")
    
    old_model = _current_server_model
    _current_server_model = model_id
    
    logger.info(f"🔄 Server default model changed: {old_model} → {model_id}")
    
    return {
        "status": "success",
        "message": f"Default model changed to {model_id}",
        "old_model": old_model,
        "new_model": model_id,
        "hf_repo": IMAGE_MODEL_IDS[model_id]
    }


@router.get("/image/server/info")
async def get_server_info():
    """
    Get server deployment information.
    
    Shows current configuration optimized for 16GB CPU free tier.
    """
    return {
        "server": "Whisper AI Image Generation",
        "version": "2.0.0",
        "deployment": {
            "target": "HuggingFace Spaces Free Tier",
            "ram": "16GB CPU",
            "gpu": "Not required",
            "cost": "FREE"
        },
        "api_mode": {
            "type": "HuggingFace Inference API",
            "benefits": [
                "No GPU needed",
                "No model downloads on server",
                "Instant model switching",
                "Free tier available",
                "All models accessible"
            ]
        },
        "current_config": {
            "default_model": _active_image_model(),
            "hf_api_only": USE_HF_API_ONLY,
            "total_models": len(_enabled_image_catalog())
        }
    }
