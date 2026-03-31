"""
Whisper AI - Approved model catalog API.

This is the server/mobile source of truth for text and image model selection.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from services.approved_model_catalog import (
    DEFAULT_ADULT_IMAGE_MODEL_ID,
    DEFAULT_ADULT_TEXT_MODEL_ID,
    DEFAULT_IMAGE_MODEL_ID,
    DEFAULT_TEXT_MODEL_ID,
    APPROVED_IMAGE_MODELS,
    APPROVED_TEXT_MODELS,
    get_image_model,
    get_text_model,
    list_image_models,
    list_text_models,
)
from services.catalog_bootstrap import get_catalog_bootstrap_status, resolve_bootstrap_artifact

router = APIRouter(prefix="/models", tags=["models"])


class LLMModel(BaseModel):
    id: str
    name: str
    description: str
    size_mb: int
    ram_required_gb: float
    speed: str
    repo_id: str
    filename: str
    quantization: str
    provider: str
    download_url: str
    recommended: bool = False
    adult: bool = False
    supports_local: bool = True
    supports_server: bool = True
    roles: list[str] = Field(default_factory=list)
    auto_bootstrap: bool = True
    artifact_path: str = ""
    downloaded: bool = False
    install_status: str = "pending"
    install_error: Optional[str] = None
    size_bytes: int = 0
    kind: str = "text"


class ImageModel(BaseModel):
    id: str
    name: str
    description: str
    provider: str
    repo_id: str
    generation_mode: str
    filename: str = ""
    size_mb: int = 0
    ram_required_gb: float = 0.0
    speed: str = "medium"
    quantization: str = ""
    download_url: str = ""
    downloadable: bool = False
    recommended: bool = False
    adult: bool = False
    supports_local: bool = False
    supports_server: bool = True
    supports_text_prompt: bool = True
    auto_bootstrap: bool = False
    tags: list[str] = Field(default_factory=list)
    artifact_path: str = ""
    downloaded: bool = False
    install_status: str = "pending"
    install_error: Optional[str] = None
    size_bytes: int = 0
    kind: str = "image"


def _with_bootstrap_state(item: dict[str, Any], *, kind: str) -> dict[str, Any]:
    filename = item.get("filename") or ""
    if not filename:
        item = dict(item)
        item.update(
            {
                "artifact_path": "",
                "downloaded": False,
                "install_status": "remote_only",
                "install_error": None,
                "size_bytes": 0,
            }
        )
        return item

    state = resolve_bootstrap_artifact(kind, item["id"], filename)
    item = dict(item)
    item.update(
        {
            "artifact_path": state.get("artifact_path", ""),
            "downloaded": bool(state.get("downloaded")),
            "install_status": state.get("status", "pending"),
            "install_error": state.get("error"),
            "size_bytes": int(state.get("size_bytes") or 0),
        }
    )
    return item


@router.get("/llm", response_model=list[LLMModel])
async def get_llm_models(include_adult: bool = Query(True)) -> list[LLMModel]:
    return [
        LLMModel(**_with_bootstrap_state(model, kind="text"))
        for model in list_text_models(include_adult=include_adult)
    ]


@router.get("/image", response_model=list[ImageModel])
async def get_image_models(
    include_adult: bool = Query(True),
    include_edit: bool = Query(False),
) -> list[ImageModel]:
    return [
        ImageModel(**_with_bootstrap_state(model, kind="image"))
        for model in list_image_models(include_adult=include_adult, include_edit=include_edit)
    ]


@router.get("/llm/{model_id}")
async def get_llm_model_details(model_id: str):
    model = get_text_model(model_id)
    if model is None:
        return {"error": "Model not found"}
    return _with_bootstrap_state(model.to_payload(), kind="text")


@router.get("/image/{model_id}")
async def get_image_model_details(model_id: str):
    model = get_image_model(model_id)
    if model is None:
        return {"error": "Model not found"}
    return _with_bootstrap_state(model.to_payload(), kind="image")


@router.get("/bootstrap/status")
async def get_model_bootstrap_status():
    return get_catalog_bootstrap_status()


@router.get("/server/recommended")
async def get_recommended_server_models():
    return {
        "text_default": next(
            model.to_payload() for model in APPROVED_TEXT_MODELS if model.id == DEFAULT_TEXT_MODEL_ID
        ),
        "text_adult": next(
            model.to_payload() for model in APPROVED_TEXT_MODELS if model.id == DEFAULT_ADULT_TEXT_MODEL_ID
        ),
        "image_default": next(
            model.to_payload() for model in APPROVED_IMAGE_MODELS if model.id == DEFAULT_IMAGE_MODEL_ID
        ),
        "image_adult": next(
            model.to_payload() for model in APPROVED_IMAGE_MODELS if model.id == DEFAULT_ADULT_IMAGE_MODEL_ID
        ),
    }
