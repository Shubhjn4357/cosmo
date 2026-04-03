"""
Lightweight process-level tuning for CPU-first Whisper deployments.
"""

from __future__ import annotations

import os
import threading
from typing import Literal

from loguru import logger

PowerProfile = Literal["low-power", "balanced", "performance"]

_CONFIGURED = False
_LOCK = threading.Lock()


def get_power_profile(default: str = "balanced") -> PowerProfile:
    value = os.getenv("WHISPER_POWER_PROFILE", default).strip().lower()
    if value not in {"low-power", "balanced", "performance"}:
        return "balanced"
    return value  # type: ignore[return-value]


def env_flag_enabled(
    name: str,
    default: bool,
    *,
    disable_in_low_power: bool = False,
) -> bool:
    configured = os.getenv(name)
    if configured is not None:
        return configured.strip().lower() == "true"
    if disable_in_low_power and get_power_profile() == "low-power":
        return False
    return default


def recommended_thread_count(profile: PowerProfile | None = None, cpu_count: int | None = None) -> int:
    profile = profile or get_power_profile()
    cpu_count = max(1, cpu_count or (os.cpu_count() or 1))

    if profile == "low-power":
        return max(1, min(2, cpu_count))
    if profile == "performance":
        return max(1, min(8, cpu_count))
    return max(1, min(4, cpu_count))


def apply_process_tuning(*, force: bool = False) -> dict[str, int | str]:
    global _CONFIGURED

    with _LOCK:
        if _CONFIGURED and not force:
            profile = get_power_profile()
            threads = recommended_thread_count(profile)
            return {"profile": profile, "threads": threads}

        profile = get_power_profile()
        threads = recommended_thread_count(profile)

        for env_name in (
            "OMP_NUM_THREADS",
            "OPENBLAS_NUM_THREADS",
            "MKL_NUM_THREADS",
            "NUMEXPR_NUM_THREADS",
            "VECLIB_MAXIMUM_THREADS",
        ):
            os.environ.setdefault(env_name, str(threads))

        os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

        _CONFIGURED = True
        logger.info("Applied process tuning: profile={} threads={}", profile, threads)
        return {"profile": profile, "threads": threads}


def configure_torch_threads(*, force: bool = False) -> dict[str, int | str]:
    tuning = apply_process_tuning(force=force)
    threads = int(tuning["threads"])

    try:
        import torch

        torch.set_num_threads(threads)
        try:
            torch.set_num_interop_threads(max(1, min(2, threads)))
        except RuntimeError:
            pass
    except Exception:
        pass

    return tuning
