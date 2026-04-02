from __future__ import annotations

from pathlib import Path

from services import hf_dataset_sync


class _FakeApi:
    uploaded_paths: list[str] = []
    remote_files: list[str] = []

    def __init__(self, token: str | None = None):
        self.token = token

    def create_repo(self, **kwargs):
        return None

    def upload_file(self, *, path_in_repo: str, **kwargs):
        if path_in_repo not in self.remote_files:
            self.remote_files.append(path_in_repo)
        self.uploaded_paths.append(path_in_repo)

    def list_repo_files(self, **kwargs):
        return list(self.remote_files)


def test_hf_sync_service_uses_consistent_remote_paths(tmp_path, monkeypatch):
    state_path = tmp_path / "hf_sync_state.json"
    monkeypatch.setenv("HF_DATASET_REPO", "demo/repo")
    monkeypatch.setenv("HF_TOKEN", "demo-token")
    monkeypatch.setattr(hf_dataset_sync, "SYNC_STATE_PATH", state_path)
    monkeypatch.setattr(hf_dataset_sync, "HF_HUB_AVAILABLE", True)
    monkeypatch.setattr(hf_dataset_sync, "HfApi", _FakeApi)

    _FakeApi.remote_files = []
    _FakeApi.uploaded_paths = []

    training_path = tmp_path / "training_pairs.jsonl"
    training_path.write_text('{"input":"a","output":"b"}\n', encoding="utf-8")
    dataset_path = tmp_path / "sample.jsonl"
    dataset_path.write_text('{"input":"x","output":"y"}\n', encoding="utf-8")

    training_result = hf_dataset_sync.sync_path(training_path)
    dataset_result = hf_dataset_sync.sync_path(dataset_path)

    assert training_result["remote_path"] == "training_pairs.jsonl"
    assert dataset_result["remote_path"] == "datasets/sample.jsonl"
    assert _FakeApi.uploaded_paths == ["training_pairs.jsonl", "datasets/sample.jsonl"]
    assert hf_dataset_sync.status()["last_action"] == "upload"


def test_hf_sync_service_download_supports_root_and_dataset_paths(tmp_path, monkeypatch):
    state_path = tmp_path / "hf_sync_state.json"
    monkeypatch.setenv("HF_DATASET_REPO", "demo/repo")
    monkeypatch.setenv("HF_TOKEN", "demo-token")
    monkeypatch.setattr(hf_dataset_sync, "SYNC_STATE_PATH", state_path)
    monkeypatch.setattr(hf_dataset_sync, "HF_HUB_AVAILABLE", True)
    monkeypatch.setattr(hf_dataset_sync, "HfApi", _FakeApi)

    _FakeApi.remote_files = ["training_pairs.jsonl", "datasets/sample.jsonl"]
    _FakeApi.uploaded_paths = []

    def fake_download(*, filename: str, **kwargs):
        cache_dir = tmp_path / "hf-cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        target = cache_dir / Path(filename).name
        target.write_text(f"remote:{filename}", encoding="utf-8")
        return str(target)

    monkeypatch.setattr(hf_dataset_sync, "hf_hub_download", fake_download)

    training_target = tmp_path / "training_pairs.jsonl"
    dataset_target = tmp_path / "sample.jsonl"

    training_result = hf_dataset_sync.download_to_path(training_target)
    dataset_result = hf_dataset_sync.download_to_path(dataset_target)

    assert training_result["remote_path"] == "training_pairs.jsonl"
    assert dataset_result["remote_path"] == "datasets/sample.jsonl"
    assert training_target.read_text(encoding="utf-8") == "remote:training_pairs.jsonl"
    assert dataset_target.read_text(encoding="utf-8") == "remote:datasets/sample.jsonl"


def test_hf_sync_service_can_sync_and_restore_directories(tmp_path, monkeypatch):
    state_path = tmp_path / "hf_sync_state.json"
    monkeypatch.setenv("HF_DATASET_REPO", "demo/repo")
    monkeypatch.setenv("HF_TOKEN", "demo-token")
    monkeypatch.setattr(hf_dataset_sync, "SYNC_STATE_PATH", state_path)
    monkeypatch.setattr(hf_dataset_sync, "HF_HUB_AVAILABLE", True)
    monkeypatch.setattr(hf_dataset_sync, "HfApi", _FakeApi)

    _FakeApi.remote_files = []
    _FakeApi.uploaded_paths = []

    models_dir = tmp_path / "models"
    (models_dir / "catalog" / "text").mkdir(parents=True, exist_ok=True)
    (models_dir / "catalog" / "text" / "model.gguf").write_text("gguf", encoding="utf-8")
    (models_dir / "catalog" / "text" / "tokenizer.json").write_text("{}", encoding="utf-8")

    upload_result = hf_dataset_sync.sync_directory(models_dir)

    assert upload_result["remote_prefix"] == "models"
    assert upload_result["file_count"] == 2
    assert sorted(_FakeApi.uploaded_paths) == [
        "models/catalog/text/model.gguf",
        "models/catalog/text/tokenizer.json",
    ]

    def fake_download(*, filename: str, **kwargs):
        cache_dir = tmp_path / "hf-cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        target = cache_dir / Path(filename).name
        target.write_text(f"remote:{filename}", encoding="utf-8")
        return str(target)

    monkeypatch.setattr(hf_dataset_sync, "hf_hub_download", fake_download)

    restore_dir = tmp_path / "restore-models"
    download_result = hf_dataset_sync.download_directory(restore_dir, remote_prefix="models")

    assert download_result["file_count"] == 2
    assert (restore_dir / "catalog" / "text" / "model.gguf").read_text(encoding="utf-8") == "remote:models/catalog/text/model.gguf"
    assert (restore_dir / "catalog" / "text" / "tokenizer.json").read_text(encoding="utf-8") == "remote:models/catalog/text/tokenizer.json"
