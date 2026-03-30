from __future__ import annotations

import sys
import types

from services.runtime_manager import ChatRuntimeManager, RuntimeConfig, airllm_import_diagnostics


def test_airllm_runtime_prefers_local_snapshot(monkeypatch, tmp_path):
    snapshot_dir = tmp_path / "heavy-airllm"
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    (snapshot_dir / "config.json").write_text("{}", encoding="utf-8")

    loaded_sources: list[str] = []

    class FakeModel:
        def __init__(self):
            self.tokenizer = object()

        @classmethod
        def from_pretrained(cls, source: str):
            loaded_sources.append(source)
            return cls()

    fake_module = types.ModuleType("airllm")
    fake_module.AutoModel = FakeModel

    monkeypatch.setitem(sys.modules, "airllm", fake_module)
    monkeypatch.setattr("services.runtime_manager._AIRLLM_IMPORT_CACHE", None)
    monkeypatch.setattr(
        "services.runtime_manager._package_available",
        lambda module_name: module_name == "airllm",
    )

    manager = ChatRuntimeManager(
        config=RuntimeConfig(
            backend="airllm",
            model_id="Qwen/Qwen2.5-Coder-7B-Instruct",
            airllm_model_id="Qwen/Qwen2.5-Coder-7B-Instruct",
            airllm_model_path=str(snapshot_dir),
            max_context_tokens=2048,
            max_new_tokens=128,
        )
    )

    assert manager.readiness()["artifact_exists"] is True
    assert manager.ensure_loaded() is True
    assert loaded_sources == [str(snapshot_dir.resolve())]
    assert manager.status()["active_backend"] == "airllm"


def test_airllm_readiness_reports_missing_local_snapshot(monkeypatch, tmp_path):
    missing_path = tmp_path / "missing-airllm"

    monkeypatch.setattr("services.runtime_manager._AIRLLM_IMPORT_CACHE", None)
    monkeypatch.setattr(
        "services.runtime_manager._package_available",
        lambda module_name: False if module_name == "airllm" else True,
    )

    manager = ChatRuntimeManager(
        config=RuntimeConfig(
            backend="airllm",
            model_id="Qwen/Qwen2.5-Coder-7B-Instruct",
            airllm_model_id="Qwen/Qwen2.5-Coder-7B-Instruct",
            airllm_model_path=str(missing_path),
        )
    )

    readiness = manager.readiness()
    assert readiness["artifact_path"] == str(missing_path)
    assert readiness["artifact_exists"] is False
    assert readiness["can_load"] is False
    assert "airllm is not installed" in readiness["summary"]


def test_airllm_import_diagnostics_can_shim_bettertransformer(monkeypatch):
    monkeypatch.setattr("services.runtime_manager._AIRLLM_IMPORT_CACHE", None)

    shimmed_module = types.ModuleType("airllm")
    shimmed_module.AutoModel = object()
    calls = {"count": 0}

    def fake_import_module(name: str):
        if name == "airllm":
            calls["count"] += 1
            if calls["count"] == 1:
                raise RuntimeError("BetterTransformer requires transformers<4.49 but found 4.57.3.")
            return shimmed_module
        raise ImportError(name)

    monkeypatch.setattr(
        "services.runtime_manager._package_available",
        lambda module_name: module_name == "airllm",
    )
    monkeypatch.setattr("services.runtime_manager.importlib.import_module", fake_import_module)

    diagnostics = airllm_import_diagnostics(reset_cache=True)
    assert diagnostics["available"] is True
    assert diagnostics["shimmed"] is True
    assert diagnostics["module"] is shimmed_module
