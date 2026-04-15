from __future__ import annotations

import os
from typing import Any

from services import hf_dataset_sync
from services.approved_model_catalog import (
    DEFAULT_FALLBACK_OCR_MODEL_ID,
    DEFAULT_OCR_MODEL_ID,
    DEFAULT_SPEECH_STT_MODEL_ID,
    DEFAULT_SPEECH_TALK_MODEL_ID,
    DEFAULT_SPEECH_TTS_MODEL_ID,
    get_ocr_model,
    get_speech_model,
    get_text_model,
)
from services.local_model_service import (
    local_endpoint_status,
    resolve_local_adapter,
)
from services.model_manager import runtime_profiles_payload
from services.turso_db import validate_database_connection


TURBOQUANT_SOURCE = "https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/"
GOOGLE_GENAI_SOURCE = "https://github.com/GoogleCloudPlatform/generative-ai"
BITNET_SOURCE = "https://github.com/microsoft/BitNet"


def _runtime_profile(profile_id: str) -> dict[str, Any] | None:
    payload = runtime_profiles_payload(selected_profile=None)
    for profile in payload["profiles"]:
        if profile["id"] == profile_id:
            return profile
    return None


def get_ai_stack_status() -> dict[str, Any]:
    mimo_model = get_text_model("mimo-v2-flash")
    glm_model = get_ocr_model(DEFAULT_OCR_MODEL_ID)
    talk_model = get_speech_model(DEFAULT_SPEECH_TALK_MODEL_ID)
    bitnet_profile = _runtime_profile("bitnet-cpu")
    mimo_runtime = resolve_local_adapter("mimo")
    glm_runtime = resolve_local_adapter("glm_ocr")
    personaplex_runtime = resolve_local_adapter("personaplex")

    return {
        "database": validate_database_connection(),
        "huggingface_storage": {
            "repo_id": hf_dataset_sync.get_repo_id(),
            "token_configured": bool(hf_dataset_sync.get_hf_token()),
            "read_configured": hf_dataset_sync.can_read(),
            "write_configured": hf_dataset_sync.can_write(),
            "mode": "artifact-storage-only",
        },
        "google_management": {
            "mode": "reference-only",
            "source": GOOGLE_GENAI_SOURCE,
            "project_configured": bool(os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()),
            "api_key_configured": bool(os.getenv("GEMINI_API_KEY", "").strip() or os.getenv("GOOGLE_API_KEY", "").strip()),
            "summary": "GoogleCloudPlatform/generative-ai is tracked as an architecture reference, not as an embedded runtime in this repo.",
        },
        "turboquant": {
            "implemented": False,
            "status": "research-only",
            "source": TURBOQUANT_SOURCE,
            "summary": "TurboQuant is published research here, but this repo does not ship a public TurboQuant runtime package.",
        },
        "bitnet": {
            "source": BITNET_SOURCE,
            "profile": bitnet_profile,
            "implemented": bitnet_profile is not None,
        },
        "local_endpoints": {
            "mimo_v2_flash": local_endpoint_status(resolved=mimo_runtime),
            "glm_ocr": local_endpoint_status(resolved=glm_runtime),
            "personaplex": local_endpoint_status(resolved=personaplex_runtime),
        },
        "defaults": {
            "ocr": {
                "default_model": glm_model.to_payload() if glm_model is not None else None,
                "fallback_model": (
                    get_ocr_model(DEFAULT_FALLBACK_OCR_MODEL_ID).to_payload()
                    if get_ocr_model(DEFAULT_FALLBACK_OCR_MODEL_ID) is not None
                    else None
                ),
            },
            "speech": {
                "stt_model": (
                    get_speech_model(DEFAULT_SPEECH_STT_MODEL_ID).to_payload()
                    if get_speech_model(DEFAULT_SPEECH_STT_MODEL_ID) is not None
                    else None
                ),
                "tts_model": (
                    get_speech_model(DEFAULT_SPEECH_TTS_MODEL_ID).to_payload()
                    if get_speech_model(DEFAULT_SPEECH_TTS_MODEL_ID) is not None
                    else None
                ),
                "talk_model": talk_model.to_payload() if talk_model is not None else None,
            },
            "mimo": mimo_model.to_payload() if mimo_model is not None else None,
        },
    }
