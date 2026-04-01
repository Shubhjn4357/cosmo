from __future__ import annotations

import requests


def test_chat_endpoint_uses_stub_runtime(server):
    response = requests.post(
        f"{server.base_url}/api/chat",
        json={
            "message": "Return a test response",
            "session_id": "pytest-chat-session",
            "is_local": True,
            "max_tokens": 48,
            "temperature": 0.0,
        },
        timeout=60,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["backend"] == "stub"
    assert payload["model_used"] == "stub-model"
    assert payload["response"].startswith("stub response:")


def test_image_catalog_and_generation(server):
    models = requests.get(f"{server.base_url}/api/image/models", timeout=60)
    assert models.status_code == 200
    payload = models.json()
    model_ids = {model["id"] for model in payload["models"]}
    assert "cyberrealistic-v9" in model_ids
    assert "flux-schnell" not in model_ids

    image = requests.post(
        f"{server.base_url}/api/image/generate",
        json={
            "prompt": "pytest test image",
            "model_id": payload["current_model"],
            "width": 256,
            "height": 256,
            "session_id": "pytest-image-session",
            "is_local": True,
        },
        timeout=60,
    )
    assert image.status_code == 200
    image_payload = image.json()
    assert image_payload["image_url"].startswith("/static/generated/")

    asset = requests.get(f"{server.base_url}{image_payload['image_url']}", timeout=60)
    assert asset.status_code == 200
    assert asset.headers["content-type"].startswith("image/")
