from __future__ import annotations

from services.local_model_service import local_endpoint_status, resolve_local_adapter


def test_resolve_mimo_adapter_auto_detects_default_port(monkeypatch):
    monkeypatch.delenv("LOCAL_MIMO_BASE_URL", raising=False)
    monkeypatch.delenv("LOCAL_MIMO_COMMAND_TEMPLATE", raising=False)
    monkeypatch.delenv("LOCAL_MIMO_COMMAND_CWD", raising=False)
    monkeypatch.setattr(
        "services.local_model_service._endpoint_reachable",
        lambda url: url == "http://127.0.0.1:8001",
    )

    resolved = resolve_local_adapter("mimo")

    assert resolved["base_url"] == "http://127.0.0.1:8001"
    assert resolved["config_source"] == "auto_default_port"
    assert resolved["available"] is True
    assert resolved["reachable"] is True


def test_resolve_glm_ocr_adapter_reports_env_override_when_unreachable(monkeypatch):
    monkeypatch.setenv("LOCAL_GLM_OCR_BASE_URL", "http://127.0.0.1:9912")
    monkeypatch.delenv("LOCAL_GLM_OCR_COMMAND_TEMPLATE", raising=False)
    monkeypatch.setattr("services.local_model_service._endpoint_reachable", lambda url: False)

    resolved = resolve_local_adapter("glm_ocr")
    status = local_endpoint_status(resolved=resolved)

    assert resolved["base_url"] == "http://127.0.0.1:9912"
    assert resolved["config_source"] == "env"
    assert resolved["configured"] is True
    assert resolved["available"] is False
    assert status["reachable"] is False
    assert status["config_source"] == "env"
