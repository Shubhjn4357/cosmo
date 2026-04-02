from __future__ import annotations

from utils.system_tuning import env_flag_enabled


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
