"""
Whisper AI - Approved model catalog API.

This is the server/mobile source of truth for text, image, OCR, and speech
model selection.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from services.ai_stack_status import get_ai_stack_status
from services.approved_model_catalog import (
    APPROVED_IMAGE_MODELS,
    APPROVED_OCR_MODELS,
    APPROVED_SPEECH_MODELS,
    APPROVED_TEXT_MODELS,
    DEFAULT_ADULT_IMAGE_MODEL_ID,
    DEFAULT_ADULT_TEXT_MODEL_ID,
    DEFAULT_FALLBACK_OCR_MODEL_ID,
    DEFAULT_IMAGE_MODEL_ID,
    DEFAULT_OCR_MODEL_ID,
    DEFAULT_SPEECH_STT_MODEL_ID,
    DEFAULT_SPEECH_TALK_MODEL_ID,
    DEFAULT_SPEECH_TTS_MODEL_ID,
    DEFAULT_TEXT_MODEL_ID,
    get_image_model,
    get_ocr_model,
    get_speech_model,
    get_text_model,
    list_image_models,
    list_ocr_models,
    list_speech_models,
    list_text_models,
)
from services.catalog_bootstrap import get_catalog_bootstrap_status, resolve_bootstrap_artifact
from services.local_model_service import local_endpoint_status, resolve_local_adapter

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
    downloadable: bool = False
    recommended: bool = False
    adult: bool = False
    supports_local: bool = True
    supports_server: bool = True
    roles: list[str] = Field(default_factory=list)
    auto_bootstrap: bool = True
    runtime_backend: str = ""
    endpoint_env: str = ""
    resolved_endpoint: str = ""
    endpoint_available: bool = False
    endpoint_reachable: bool = False
    endpoint_config_source: str = "none"
    artifact_path: str = ""
    downloaded: bool = False
    install_status: str = "pending"
    install_error: Optional[str] = None
    size_bytes: int = 0
    kind: str = "text"
    tags: list[str] = Field(default_factory=list)


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


class OCRModel(BaseModel):
    id: str
    name: str
    description: str
    provider: str
    repo_id: str = ""
    filename: str = ""
    size_mb: int = 0
    speed: str = "medium"
    download_url: str = ""
    recommended: bool = False
    supports_local: bool = False
    supports_server: bool = True
    auto_bootstrap: bool = False
    gated: bool = False
    endpoint_env: str = ""
    resolved_endpoint: str = ""
    endpoint_available: bool = False
    endpoint_reachable: bool = False
    endpoint_config_source: str = "none"
    tags: list[str] = Field(default_factory=list)
    artifact_path: str = ""
    downloaded: bool = False
    install_status: str = "pending"
    install_error: Optional[str] = None
    size_bytes: int = 0
    kind: str = "ocr"


class SpeechModel(BaseModel):
    id: str
    name: str
    description: str
    provider: str
    repo_id: str = ""
    capabilities: list[str] = Field(default_factory=list)
    filename: str = ""
    size_mb: int = 0
    speed: str = "medium"
    download_url: str = ""
    recommended: bool = False
    supports_local: bool = False
    supports_server: bool = True
    auto_bootstrap: bool = False
    gated: bool = False
    endpoint_env: str = ""
    resolved_endpoint: str = ""
    endpoint_available: bool = False
    endpoint_reachable: bool = False
    endpoint_config_source: str = "none"
    voice_family: str = ""
    tags: list[str] = Field(default_factory=list)
    artifact_path: str = ""
    downloaded: bool = False
    install_status: str = "pending"
    install_error: Optional[str] = None
    size_bytes: int = 0
    kind: str = "speech"


def _no_artifact_status(item: dict[str, Any]) -> str:
    provider = str(item.get("provider") or "").strip()
    if provider == "builtin":
        return "builtin"
    if provider == "external_endpoint":
        return "local_endpoint"
    return "remote_only"


def _adapter_id_for_item(item: dict[str, Any]) -> str | None:
    mapping = {
        "mimo-v2-flash": "mimo",
        "glm-ocr": "glm_ocr",
        "personaplex-7b-v1": "personaplex",
    }
    return mapping.get(str(item.get("id") or "").strip())


def _with_local_adapter_state(item: dict[str, Any]) -> dict[str, Any]:
    adapter_id = _adapter_id_for_item(item)
    if adapter_id is None or str(item.get("provider") or "") != "external_endpoint":
        enriched = dict(item)
        enriched.setdefault("resolved_endpoint", "")
        enriched.setdefault("endpoint_available", False)
        enriched.setdefault("endpoint_reachable", False)
        enriched.setdefault("endpoint_config_source", "none")
        return enriched

    adapter_status = local_endpoint_status(resolved=resolve_local_adapter(adapter_id))
    enriched = dict(item)
    enriched.update(
        {
            "resolved_endpoint": adapter_status.get("base_url", ""),
            "endpoint_available": bool(adapter_status.get("available")),
            "endpoint_reachable": bool(adapter_status.get("reachable")),
            "endpoint_config_source": adapter_status.get("config_source", "none"),
        }
    )
    return enriched


def _with_bootstrap_state(item: dict[str, Any], *, kind: str) -> dict[str, Any]:
    item = _with_local_adapter_state(item)
    filename = item.get("filename") or ""
    if not filename:
        item = dict(item)
        item.update(
            {
                "artifact_path": "",
                "downloaded": False,
                "install_status": _no_artifact_status(item),
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


@router.get("/ocr", response_model=list[OCRModel])
async def get_ocr_models() -> list[OCRModel]:
    return [
        OCRModel(**_with_bootstrap_state(model, kind="ocr"))
        for model in list_ocr_models()
    ]


@router.get("/speech", response_model=list[SpeechModel])
async def get_speech_models() -> list[SpeechModel]:
    return [
        SpeechModel(**_with_bootstrap_state(model, kind="speech"))
        for model in list_speech_models()
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


@router.get("/ocr/{model_id}")
async def get_ocr_model_details(model_id: str):
    model = get_ocr_model(model_id)
    if model is None:
        return {"error": "Model not found"}
    return _with_bootstrap_state(model.to_payload(), kind="ocr")


@router.get("/speech/{model_id}")
async def get_speech_model_details(model_id: str):
    model = get_speech_model(model_id)
    if model is None:
        return {"error": "Model not found"}
    return _with_bootstrap_state(model.to_payload(), kind="speech")


@router.get("/bootstrap/status")
async def get_model_bootstrap_status():
    return get_catalog_bootstrap_status()


@router.get("/stack/status")
async def get_stack_status():
    return get_ai_stack_status()


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
        "ocr_default": next(
            model.to_payload() for model in APPROVED_OCR_MODELS if model.id == DEFAULT_OCR_MODEL_ID
        ),
        "ocr_fallback": next(
            model.to_payload() for model in APPROVED_OCR_MODELS if model.id == DEFAULT_FALLBACK_OCR_MODEL_ID
        ),
        "speech_stt": next(
            model.to_payload() for model in APPROVED_SPEECH_MODELS if model.id == DEFAULT_SPEECH_STT_MODEL_ID
        ),
        "speech_tts": next(
            model.to_payload() for model in APPROVED_SPEECH_MODELS if model.id == DEFAULT_SPEECH_TTS_MODEL_ID
        ),
        "speech_talk": next(
            model.to_payload() for model in APPROVED_SPEECH_MODELS if model.id == DEFAULT_SPEECH_TALK_MODEL_ID
        ),
    }
