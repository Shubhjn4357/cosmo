from __future__ import annotations

import requests


def test_models_api_exposes_ocr_and_speech_catalogs(server):
    ocr_response = requests.get(f"{server.base_url}/api/models/ocr", timeout=60)
    assert ocr_response.status_code == 200
    ocr_payload = ocr_response.json()
    ocr_ids = {item["id"] for item in ocr_payload}
    assert {"tesseract-local", "glm-ocr"} <= ocr_ids
    glm = next(item for item in ocr_payload if item["id"] == "glm-ocr")
    assert "resolved_endpoint" in glm
    assert "endpoint_config_source" in glm

    speech_response = requests.get(f"{server.base_url}/api/models/speech", timeout=60)
    assert speech_response.status_code == 200
    speech_payload = speech_response.json()
    speech_ids = {item["id"] for item in speech_payload}
    assert {"openai-cosmo-1", "local-tts", "personaplex-7b-v1"} <= speech_ids
    personaplex = next(item for item in speech_payload if item["id"] == "personaplex-7b-v1")
    assert "resolved_endpoint" in personaplex
    assert "endpoint_config_source" in personaplex


def test_models_api_reports_local_stack_status(server):
    response = requests.get(f"{server.base_url}/api/models/stack/status", timeout=60)
    assert response.status_code == 200
    payload = response.json()
    assert payload["turboquant"]["status"] == "research-only"
    assert payload["google_management"]["mode"] == "reference-only"
    assert "database" in payload
    assert "bitnet" in payload
    assert "config_source" in payload["local_endpoints"]["mimo_v2_flash"]
    assert "available" in payload["local_endpoints"]["glm_ocr"]
