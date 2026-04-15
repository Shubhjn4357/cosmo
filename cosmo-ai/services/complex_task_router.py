"""
Server-side complex task routing.

Complex prompts are upgraded to a dedicated coding model without mutating the
global runtime selected for the rest of the app.
"""

from __future__ import annotations

import os
import re
from typing import Any

from services.runtime_manager import ChatRuntimeManager, RuntimeConfig


COMPLEX_PROFILE_ID = "complex-coder-next"
_complex_runtime_manager: ChatRuntimeManager | None = None


def _env_flag(name: str, default: str = "true") -> bool:
    return os.getenv(name, default).lower() == "true"


def complex_task_config() -> RuntimeConfig:
    return RuntimeConfig(
        backend="transformers",
        model_id=os.getenv("COSMO_COMPLEX_TASK_MODEL_ID", "Qwen/Qwen3-Coder-Next"),
        max_context_tokens=int(os.getenv("COSMO_COMPLEX_TASK_MAX_CONTEXT_TOKENS", "16384")),
        max_new_tokens=int(os.getenv("COSMO_COMPLEX_TASK_MAX_NEW_TOKENS", "1024")),
        device=os.getenv("COSMO_COMPLEX_TASK_DEVICE", os.getenv("LOCAL_MODEL_DEVICE", "cpu")),
        allow_remote_code=_env_flag("COSMO_COMPLEX_TASK_TRUST_REMOTE_CODE", "true"),
        n_threads=int(os.getenv("COSMO_COMPLEX_TASK_THREADS", os.getenv("LOCAL_MODEL_THREADS", "2"))),
    )


def get_complex_task_runtime_manager() -> ChatRuntimeManager:
    global _complex_runtime_manager
    if _complex_runtime_manager is None:
        _complex_runtime_manager = ChatRuntimeManager(config=complex_task_config())
        _complex_runtime_manager._selected_profile = COMPLEX_PROFILE_ID
    return _complex_runtime_manager


def prompt_complexity_score(message: str, *, history: list[dict[str, str]] | None = None) -> float:
    prompt = str(message or "").strip()
    lowered = prompt.lower()
    score = 0.0

    if len(prompt) >= 600:
        score += 0.45
    elif len(prompt) >= 280:
        score += 0.3
    elif len(prompt) >= 140:
        score += 0.18

    if len(re.findall(r"\n\s*[-*0-9]", prompt)) >= 3:
        score += 0.2

    if len(re.findall(r"```|def |class |function |import |export |interface |const |let |async |await |objc |jni |jsi |cpp|pytest|traceback|stack", lowered)) >= 2:
        score += 0.32  # Native/Modern code gets higher priority

    complex_terms = (
        "architecture", "refactor", "multi-file", "deep dive", "debug", "investigate",
        "agent", "plan", "implement", "optimize", "migration", "dataset", "training",
        "fine-tune", "pipeline", "evaluate", "benchmark", "reasoning", "jsi", "bitnet",
        "native", "bridge", "consensus", "quorum", "multimodal", "vision", "ternary",
    )
    score += sum(0.08 for term in complex_terms if term in lowered) # Slightly higher weight per term

    if history and len(history) >= 8:
        score += 0.08

    return min(score, 1.0)


def should_use_complex_runtime(message: str, *, history: list[dict[str, str]] | None = None) -> bool:
    if not _env_flag("COSMO_COMPLEX_TASK_ROUTING", "true"):
        return False
    return prompt_complexity_score(message, history=history) >= float(
        os.getenv("COSMO_COMPLEX_TASK_THRESHOLD", "0.55")
    )


def generate_server_response(
    *,
    prompt: str,
    history: list[dict[str, str]] | None,
    fallback_runtime: ChatRuntimeManager,
    max_new_tokens: int,
    temperature: float,
    top_p: float,
    prefer_airllm: bool = False,
) -> dict[str, Any]:
    # Routing logic: If complexity high OR prefer_airllm is true, use complex runtime
    if prefer_airllm or should_use_complex_runtime(prompt, history=history):
        complex_runtime = get_complex_task_runtime_manager()
        try:
            # If AirLLM is requested, we could potentially switch to a specific profile here
            # For now, we reuse the complex-coder-next profile which is most capable
            result = complex_runtime.generate(
                prompt,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                top_p=top_p,
            )
            result = dict(result)
            result["complex_route_used"] = True
            result["airllm_optimization"] = prefer_airllm
            result["selected_profile"] = COMPLEX_PROFILE_ID
            return result
        except Exception:
            # Fall through to the currently selected runtime.
            pass

    result = fallback_runtime.generate(
        prompt,
        max_new_tokens=max_new_tokens,
        temperature=temperature,
        top_p=top_p,
    )
    result = dict(result)
    result.setdefault("complex_route_used", False)
    result.setdefault("airllm_optimization", False)
    return result
