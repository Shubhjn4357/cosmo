"""
Whisper AI - Image generation routes.

Prioritizes fast remote inference so low-memory CPU deployments start quickly.
Downloadable image artifacts are prepared in the background after startup, but
remote inference stays the default execution path for responsiveness.
"""

from __future__ import annotations

import os
import random
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from services.admin_state import get_model_enabled
from services.approved_model_catalog import (
    DEFAULT_IMAGE_MODEL_ID,
    get_image_model,
    list_image_models,
)
from services.catalog_bootstrap import resolve_bootstrap_artifact
from utils.app_paths import UPLOADS_DIR

router = APIRouter()

TEST_MODE = os.environ.get("WHISPER_TEST_MODE", "false").lower() == "true"
USE_HF_API_ONLY = os.environ.get("USE_HF_API_ONLY", "true").lower() == "true"
DEFAULT_SERVER_MODEL = os.environ.get("DEFAULT_IMAGE_MODEL", DEFAULT_IMAGE_MODEL_ID)
_current_server_model = DEFAULT_SERVER_MODEL if get_image_model(DEFAULT_SERVER_MODEL) else DEFAULT_IMAGE_MODEL_ID


class ImageGenerationRequest(BaseModel):
    model_config = {"protected_namespaces": ()}

    prompt: str
    negative_prompt: Optional[str] = None
    width: int = 512
    height: int = 512
    num_steps: int = 4
    guidance_scale: float = 0.0
    model_id: str = DEFAULT_IMAGE_MODEL_ID
    is_local: bool = False
    user_id: Optional[str] = None
    session_id: Optional[str] = None


class ImageGenerationResponse(BaseModel):
    image_url: str
    seed: int
    prompt: str


def _enabled_image_catalog(include_edit: bool = False) -> list[dict]:
    items = []
    for model in list_image_models(include_adult=True, include_edit=include_edit):
        if not get_model_enabled(f"image.{model['id']}", True):
            continue
        state = resolve_bootstrap_artifact("image", model["id"], model.get("filename") or "")
        model = dict(model)
        model.update(
            {
                "artifact_path": state.get("artifact_path", ""),
                "downloaded": bool(state.get("downloaded")),
                "install_status": state.get("status", "remote_only" if not model.get("filename") else "pending"),
                "install_error": state.get("error"),
            }
        )
        items.append(model)
    return items


def _text_to_image_catalog() -> list[dict]:
    return [model for model in _enabled_image_catalog(include_edit=False) if model.get("supports_text_prompt", True)]


def _active_image_model() -> Optional[str]:
    enabled = {model["id"] for model in _text_to_image_catalog()}
    if _current_server_model in enabled:
        return _current_server_model
    if DEFAULT_SERVER_MODEL in enabled:
        return DEFAULT_SERVER_MODEL
    return next(iter(enabled), None)


def _generate_test_image(filepath, prompt: str, width: int, height: int):
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (width, height), color=(15, 23, 42))
    draw = ImageDraw.Draw(image)
    draw.rectangle((24, 24, width - 24, height - 24), outline=(20, 184, 166), width=4)
    draw.text((32, 32), prompt[:80], fill=(229, 231, 235))
    image.save(filepath, format="PNG")


async def _generate_via_hf_api(
    *,
    prompt: str,
    negative_prompt: Optional[str],
    width: int,
    height: int,
    num_steps: int,
    guidance_scale: float,
    repo_id: str,
) -> bytes:
    hf_token = os.environ.get("HF_TOKEN")
    if hf_token:
        api_url = f"https://router.huggingface.co/hf-inference/models/{repo_id}"
    else:
        api_url = f"https://api-inference.huggingface.co/models/{repo_id}"

    headers = {"Content-Type": "application/json"}
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"

    payload = {
        "inputs": prompt,
        "parameters": {
            "width": min(width, 1024),
            "height": min(height, 1024),
            "num_inference_steps": max(1, min(num_steps, 30)),
            "guidance_scale": guidance_scale,
        },
    }
    if negative_prompt:
        payload["parameters"]["negative_prompt"] = negative_prompt

    async with httpx.AsyncClient(timeout=180.0) as client:
        for attempt in range(3):
            response = await client.post(api_url, headers=headers, json=payload)
            if response.status_code == 200:
                return response.content
            if response.status_code == 503 and attempt < 2:
                logger.info("HF image model loading for {}. Retrying ({}/3)...", repo_id, attempt + 2)
                continue
            message = response.text[:400]
            raise RuntimeError(f"Hugging Face image inference failed for {repo_id}: {response.status_code} {message}")

    raise RuntimeError(f"Hugging Face image inference failed for {repo_id}")


def _get_local_generator():
    if USE_HF_API_ONLY:
        return None

    try:
        import torch
        from diffusers import StableDiffusionPipeline

        model_id = os.environ.get("IMAGE_MODEL_ID", "runwayml/stable-diffusion-v1-5")
        logger.info("Loading local diffusers fallback model: {}", model_id)
        pipeline = StableDiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.float32,
            safety_checker=None,
            requires_safety_checker=False,
        )
        pipeline.to("cpu")
        pipeline.enable_attention_slicing()
        return pipeline
    except Exception as exc:
        logger.warning(f"Local diffusers fallback unavailable: {exc}")
        return None


@router.post("/image/generate")
async def generate_image(request: ImageGenerationRequest) -> ImageGenerationResponse:
    from api.routes.profile import get_supabase
    from services.token_service import check_and_use_tokens

    async def _log_generated_image(image_url: str, selected_model: str):
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

    token_result = await check_and_use_tokens(
        supabase=get_supabase() if request.user_id else None,
        feature="image",
        is_local=request.is_local,
        is_smart=False,
        user_id=request.user_id,
        session_id=request.session_id,
    )
    if not token_result.get("success"):
        raise HTTPException(
            status_code=403 if "insufficient" in token_result.get("error", "") else 401,
            detail=token_result,
        )

    enabled_models = {model["id"]: model for model in _text_to_image_catalog()}
    selected_model = request.model_id or _active_image_model()
    if not selected_model:
        raise HTTPException(status_code=503, detail="No image models are currently enabled")
    if selected_model not in enabled_models:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid or disabled model_id. Available: {sorted(enabled_models)}",
        )

    model = enabled_models[selected_model]
    output_dir = UPLOADS_DIR / "generated"
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.png"
    filepath = output_dir / filename
    seed = random.randint(0, 2**32 - 1)

    if TEST_MODE:
        _generate_test_image(filepath, request.prompt, request.width, request.height)
        await _log_generated_image(f"/static/generated/{filename}", selected_model)
        return ImageGenerationResponse(
            image_url=f"/static/generated/{filename}",
            seed=seed,
            prompt=request.prompt,
        )

    try:
        image_bytes = await _generate_via_hf_api(
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            width=request.width,
            height=request.height,
            num_steps=request.num_steps,
            guidance_scale=request.guidance_scale,
            repo_id=model["repo_id"],
        )
        filepath.write_bytes(image_bytes)
        await _log_generated_image(f"/static/generated/{filename}", selected_model)
        return ImageGenerationResponse(
            image_url=f"/static/generated/{filename}",
            seed=seed,
            prompt=request.prompt,
        )
    except Exception as exc:
        logger.warning(f"Remote image generation failed for {selected_model}: {exc}")

    generator = _get_local_generator()
    if generator is None:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Image model '{selected_model}' is available in the approved catalog, "
                "but this deployment could not execute it remotely and has no local image runtime enabled."
            ),
        )

    try:
        import torch

        image = generator(
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            width=request.width,
            height=request.height,
            num_inference_steps=max(1, min(request.num_steps, 30)),
            guidance_scale=request.guidance_scale,
            generator=torch.Generator().manual_seed(seed),
        ).images[0]
        image.save(filepath)
        await _log_generated_image(f"/static/generated/{filename}", selected_model)
        return ImageGenerationResponse(
            image_url=f"/static/generated/{filename}",
            seed=seed,
            prompt=request.prompt,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/image/models")
async def list_models():
    active_model = _active_image_model()
    return {
        "models": _text_to_image_catalog(),
        "current_model": active_model,
        "status": "hf_api" if USE_HF_API_ONLY else "hybrid",
        "mode": "Remote inference first, background-downloaded artifacts second",
        "default_model": DEFAULT_SERVER_MODEL,
    }


@router.get("/image/server/config")
async def get_server_config():
    models = _text_to_image_catalog()
    return {
        "default_model": _active_image_model(),
        "use_hf_api_only": USE_HF_API_ONLY,
        "mode": "Hugging Face inference first" if USE_HF_API_ONLY else "Hybrid remote/local",
        "deployment_info": {
            "optimized_for": "Low-memory CPU server start with background model preparation",
            "gpu_required": False,
            "api_cost": "Depends on HF routing and token availability",
        },
        "available_models": [model["id"] for model in models],
        "recommended_models": [
            {"id": model["id"], "reason": model["description"]}
            for model in models
            if model.get("recommended")
        ],
    }


@router.post("/image/server/model")
async def set_server_model(model_id: str):
    global _current_server_model

    enabled_ids = {model["id"] for model in _text_to_image_catalog()}
    if model_id not in enabled_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model_id. Available: {sorted(enabled_ids)}",
        )

    old_model = _current_server_model
    _current_server_model = model_id
    logger.info("Image server model changed: {} -> {}", old_model, model_id)
    return {
        "status": "success",
        "message": f"Default image model changed to {model_id}",
        "old_model": old_model,
        "new_model": model_id,
    }


@router.get("/image/server/info")
async def get_server_info():
    return {
        "server": "Whisper AI Image Generation",
        "version": "3.0.0",
        "deployment": {
            "target": "Low-memory CPU space with background artifact preparation",
            "ram": os.environ.get("WHISPER_SERVER_RAM_LABEL", "2GB CPU"),
            "gpu": "Not required for startup",
        },
        "current_config": {
            "default_model": _active_image_model(),
            "hf_api_only": USE_HF_API_ONLY,
            "total_models": len(_text_to_image_catalog()),
        },
    }
