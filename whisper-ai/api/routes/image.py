"""
Whisper AI - Local-only image generation routes.

The server exposes only approved image checkpoints that can be downloaded and
run locally. Paid remote inference APIs are intentionally not used here.
"""

from __future__ import annotations

import asyncio
import os
import random
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from services.admin_state import get_model_enabled, get_selected_image_model, set_selected_image_model
from services.approved_model_catalog import (
    DEFAULT_ADULT_IMAGE_MODEL_ID,
    DEFAULT_IMAGE_MODEL_ID,
    get_image_model,
    list_image_models,
)
from services.catalog_bootstrap import resolve_bootstrap_artifact
from services.image_prompt_library import image_prompt_library
from services.local_image_runtime import local_image_runtime, supports_single_file_runtime
from utils.app_paths import UPLOADS_DIR

router = APIRouter()

TEST_MODE = os.environ.get("WHISPER_TEST_MODE", "false").lower() == "true"


class ImageGenerationRequest(BaseModel):
    model_config = {"protected_namespaces": ()}

    prompt: str
    negative_prompt: Optional[str] = None
    width: int = 512
    height: int = 512
    num_steps: int = 20
    guidance_scale: float = 7.5
    model_id: str = DEFAULT_IMAGE_MODEL_ID
    is_local: bool = True
    user_id: Optional[str] = None
    session_id: Optional[str] = None


class ImageGenerationResponse(BaseModel):
    image_url: str
    seed: int
    prompt: str


def _supports_local_server_runtime(model: dict) -> bool:
    return (
        bool(model.get("downloadable"))
        and model.get("supports_server", True)
        and model.get("supports_text_prompt", True)
        and model.get("generation_mode") == "image"
        and supports_single_file_runtime(model.get("filename") or "")
    )


IMAGE_MODEL_CATALOG = [
    model
    for model in list_image_models(include_adult=True, include_edit=False)
    if _supports_local_server_runtime(model)
]
IMAGE_MODEL_IDS = {model["id"] for model in IMAGE_MODEL_CATALOG}


def _resolve_default_server_model() -> str | None:
    configured = os.environ.get("DEFAULT_IMAGE_MODEL", DEFAULT_IMAGE_MODEL_ID)
    for candidate in (configured, DEFAULT_IMAGE_MODEL_ID, DEFAULT_ADULT_IMAGE_MODEL_ID):
        if candidate in IMAGE_MODEL_IDS:
            return candidate
    return next(iter(IMAGE_MODEL_IDS), None)


DEFAULT_SERVER_MODEL = _resolve_default_server_model()
_current_server_model = get_selected_image_model(DEFAULT_SERVER_MODEL)


def _enabled_image_catalog() -> list[dict]:
    items = []
    for model in IMAGE_MODEL_CATALOG:
        if not get_model_enabled(f"image.{model['id']}", True):
            continue
        state = resolve_bootstrap_artifact("image", model["id"], model.get("filename") or "")
        hydrated = dict(model)
        hydrated.update(
            {
                "artifact_path": state.get("artifact_path", ""),
                "downloaded": bool(state.get("downloaded")),
                "install_status": state.get("status", "pending"),
                "install_error": state.get("error"),
                "size_bytes": int(state.get("size_bytes") or 0),
            }
        )
        items.append(hydrated)
    return items


def _active_image_model() -> Optional[str]:
    enabled = {model["id"] for model in _enabled_image_catalog()}
    if _current_server_model in enabled:
        return _current_server_model
    if DEFAULT_SERVER_MODEL in enabled:
        return DEFAULT_SERVER_MODEL
    return next(iter(enabled), None)


def _generate_test_image(filepath: Path, prompt: str, width: int, height: int):
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (width, height), color=(15, 23, 42))
    draw = ImageDraw.Draw(image)
    draw.rectangle((24, 24, width - 24, height - 24), outline=(20, 184, 166), width=4)
    draw.text((32, 32), prompt[:80], fill=(229, 231, 235))
    image.save(filepath, format="PNG")


@router.post("/image/generate")
async def generate_image(request: ImageGenerationRequest) -> ImageGenerationResponse:
    from api.routes.profile import get_db_client
    from services.token_service import check_and_use_tokens

    async def _log_generated_image(image_url: str, selected_model: str, used_prompt: str):
        try:
            get_db_client().table("generated_images").insert(
                {
                    "user_id": request.user_id,
                    "session_id": request.session_id,
                    "prompt": used_prompt,
                    "model_id": selected_model,
                    "image_url": image_url,
                    "is_local": True,
                }
            ).execute()
        except Exception as log_exc:
            logger.warning(f"Failed to log generated image: {log_exc}")

    token_result = await check_and_use_tokens(
        db_client=get_db_client() if request.user_id else None,
        feature="image",
        is_local=True,
        is_smart=False,
        user_id=request.user_id,
        session_id=request.session_id,
    )
    if not token_result.get("success"):
        raise HTTPException(
            status_code=403 if "insufficient" in token_result.get("error", "") else 401,
            detail=token_result,
        )

    enabled_models = {model["id"]: model for model in _enabled_image_catalog()}
    selected_model = request.model_id or _active_image_model()
    if not selected_model:
        raise HTTPException(status_code=503, detail="No local image models are currently enabled")
    if selected_model not in IMAGE_MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model_id. Available: {sorted(IMAGE_MODEL_IDS)}",
        )
    if selected_model not in enabled_models:
        raise HTTPException(
            status_code=400,
            detail=f"Image model '{selected_model}' is currently disabled by admin",
        )

    model = enabled_models[selected_model]
    output_dir = UPLOADS_DIR / "generated"
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.png"
    filepath = output_dir / filename
    seed = random.randint(0, 2**32 - 1)
    effective_prompt = image_prompt_library.enrich_prompt(request.prompt)

    if effective_prompt != request.prompt:
        logger.info("Applied image prompt prior for model {}", selected_model)

    if TEST_MODE:
        _generate_test_image(filepath, effective_prompt, request.width, request.height)
        await _log_generated_image(f"/static/generated/{filename}", selected_model, effective_prompt)
        return ImageGenerationResponse(
            image_url=f"/static/generated/{filename}",
            seed=seed,
            prompt=effective_prompt,
        )

    spec = get_image_model(selected_model)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"Image model '{selected_model}' was not found")

    artifact = resolve_bootstrap_artifact("image", spec.id, spec.filename)

    artifact_path = artifact.get("artifact_path") or ""
    if not artifact.get("downloaded") or not artifact_path:
        raise HTTPException(
            status_code=503,
            detail={
                "message": f"Image model '{selected_model}' is still preparing in background bootstrap",
                "model_id": selected_model,
                "install_status": artifact.get("status", "pending"),
                "artifact_path": artifact_path,
            },
        )

    try:
        image = await asyncio.to_thread(
            local_image_runtime.generate,
            model=model,
            artifact_path=artifact_path,
            prompt=effective_prompt,
            negative_prompt=request.negative_prompt,
            width=request.width,
            height=request.height,
            num_steps=request.num_steps,
            guidance_scale=request.guidance_scale,
            seed=seed,
        )
        image.save(filepath)
        await _log_generated_image(f"/static/generated/{filename}", selected_model, effective_prompt)
        return ImageGenerationResponse(
            image_url=f"/static/generated/{filename}",
            seed=seed,
            prompt=effective_prompt,
        )
    except Exception as exc:
        logger.error("Local image generation failed for {}: {}", selected_model, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/image/models")
async def list_models():
    active_model = _active_image_model()
    return {
        "models": _enabled_image_catalog(),
        "current_model": active_model,
        "status": "local_only",
        "mode": "Downloaded checkpoints running on the Whisper server",
        "default_model": DEFAULT_SERVER_MODEL,
    }


@router.get("/image/server/config")
async def get_server_config():
    models = _enabled_image_catalog()
    return {
        "default_model": _active_image_model(),
        "local_only": True,
        "mode": "Local downloaded checkpoint runtime",
        "deployment_info": {
            "optimized_for": "Downloaded single-file checkpoints hosted on the server",
            "gpu_required": False,
            "api_cost": "None. No remote inference API is used.",
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

    enabled_ids = {model["id"] for model in _enabled_image_catalog()}
    if model_id not in enabled_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model_id. Available: {sorted(enabled_ids)}",
        )

    old_model = _current_server_model
    _current_server_model = model_id
    set_selected_image_model(model_id)
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
        "version": "3.1.0",
        "deployment": {
            "target": "Local checkpoint runtime",
            "ram": os.environ.get("WHISPER_SERVER_RAM_LABEL", "CPU"),
            "gpu": "Optional but not required",
        },
        "current_config": {
            "default_model": _active_image_model(),
            "local_only": True,
            "total_models": len(_enabled_image_catalog()),
        },
    }
