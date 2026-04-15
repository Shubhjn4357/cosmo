from __future__ import annotations

import importlib

from services import hf_dataset_sync
from utils import persistence


def test_hf_dataset_repo_requires_explicit_configuration(monkeypatch):
    monkeypatch.delenv("HF_DATASET_REPO", raising=False)
    monkeypatch.delenv("COSMO_DEFAULT_HF_DATASET_REPO", raising=False)

    assert hf_dataset_sync.get_repo_id() is None
    assert hf_dataset_sync.can_read() is False
    assert hf_dataset_sync.can_write() is False


def test_model_directory_persistence_disabled_by_default_in_low_power(monkeypatch):
    monkeypatch.delenv("COSMO_PERSIST_MODELS_DIR", raising=False)
    monkeypatch.setenv("COSMO_POWER_PROFILE", "low-power")

    importlib.reload(persistence)

    try:
        assert persistence.persist_models_dir_enabled() is False
        assert persistence.get_persist_directories() == []
    finally:
        importlib.reload(persistence)


def test_model_directory_persistence_respects_explicit_override(monkeypatch):
    monkeypatch.setenv("COSMO_PERSIST_MODELS_DIR", "true")
    monkeypatch.setenv("COSMO_POWER_PROFILE", "low-power")

    importlib.reload(persistence)

    try:
        assert persistence.persist_models_dir_enabled() is True
        assert persistence.get_persist_directories() == [str(persistence.MODELS_DIR)]
    finally:
        importlib.reload(persistence)
