from __future__ import annotations

import requests


def test_smart_mode_status_prefers_local_only_when_no_real_provider_keys(server):
    response = requests.get(f"{server.base_url}/api/chat/smart/status", timeout=60)
    assert response.status_code == 200
    payload = response.json()
    assert payload["models"]["local"] is True
    assert payload["models"]["horde"] is False


def test_smart_mode_chat_uses_local_stub_runtime_without_external_keys(server):
    response = requests.post(
        f"{server.base_url}/api/chat/smart",
        json={
            "message": "Return one short test sentence.",
            "conversation_history": [{"role": "user", "content": "Earlier context"}],
            "max_tokens": 48,
        },
        timeout=60,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["model_used"] == "stub-model"
    assert payload["response"].startswith("stub response:")
