from __future__ import annotations

import subprocess

from services.runtime_manager import ChatRuntimeManager, RuntimeConfig


def test_bitnet_runtime_uses_local_runner(monkeypatch, tmp_path):
    repo_dir = tmp_path / "bitnet.cpp"
    repo_dir.mkdir(parents=True, exist_ok=True)
    runner_script = repo_dir / "run_inference.py"
    runner_script.write_text("print('ok')", encoding="utf-8")

    model_path = tmp_path / "ggml-model-i2_s.gguf"
    model_path.write_bytes(b"fake-bitnet")

    calls: dict[str, object] = {}

    def fake_subprocess_run(command, **kwargs):
        calls["command"] = command
        calls["kwargs"] = kwargs
        return subprocess.CompletedProcess(command, 0, stdout="prompt bitnet reply", stderr="")

    monkeypatch.setattr("services.runtime_manager.subprocess.run", fake_subprocess_run)

    manager = ChatRuntimeManager(
        config=RuntimeConfig(
            backend="bitnet_cpp",
            model_id="microsoft/BitNet-b1.58-2B-4T-gguf",
            bitnet_model_path=str(model_path),
            bitnet_repo_path=str(repo_dir),
            max_context_tokens=2048,
            max_new_tokens=128,
            n_threads=1,
        )
    )

    readiness = manager.readiness()
    assert readiness["backend"] == "bitnet_cpp"
    assert readiness["artifact_exists"] is True
    assert readiness["can_load"] is True
    assert "BitNet runner available" in " ".join(readiness["messages"])

    assert manager.ensure_loaded() is True
    result = manager.generate("prompt", 32, 0.2, 0.9)
    assert result["backend"] == "bitnet_cpp"
    assert result["text"] == "bitnet reply"

    command = calls["command"]
    assert isinstance(command, list)
    assert str(runner_script) in command
    assert str(model_path) in command
