from __future__ import annotations

import sys

from utils.system_tuning import apply_process_tuning, env_flag_enabled


def test_env_flag_enabled_uses_default_when_not_configured(monkeypatch):
    monkeypatch.delenv("WHISPER_TEST_FLAG", raising=False)
    monkeypatch.setenv("WHISPER_POWER_PROFILE", "balanced")

    assert env_flag_enabled("WHISPER_TEST_FLAG", True) is True
    assert env_flag_enabled("WHISPER_TEST_FLAG", False) is False


def test_env_flag_enabled_disables_feature_by_default_in_low_power(monkeypatch):
    monkeypatch.delenv("WHISPER_TEST_FLAG", raising=False)
    monkeypatch.setenv("WHISPER_POWER_PROFILE", "low-power")

    assert env_flag_enabled("WHISPER_TEST_FLAG", True, disable_in_low_power=True) is False


def test_env_flag_enabled_respects_explicit_override_in_low_power(monkeypatch):
    monkeypatch.setenv("WHISPER_POWER_PROFILE", "low-power")
    monkeypatch.setenv("WHISPER_TEST_FLAG", "true")
    assert env_flag_enabled("WHISPER_TEST_FLAG", False, disable_in_low_power=True) is True

    monkeypatch.setenv("WHISPER_TEST_FLAG", "false")
    assert env_flag_enabled("WHISPER_TEST_FLAG", True, disable_in_low_power=True) is False


def test_apply_process_tuning_does_not_import_torch(monkeypatch):
    monkeypatch.setenv("WHISPER_POWER_PROFILE", "low-power")
    sys.modules.pop("torch", None)

    apply_process_tuning(force=True)

    assert "torch" not in sys.modules
