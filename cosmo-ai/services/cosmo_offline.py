"""
Cosmo Offline Defaults
=======================
Prebuilt personality + offline model detection + fallback responses.
This module ensures Cosmo works even when HF_TOKEN is missing or network is unavailable.
"""

from __future__ import annotations

import os
from loguru import logger

# ─── Prebuilt Personality Profiles ────────────────────────────────────────────
# Feed these to CosmoModel via env var COSMO_PERSONALITY or load from this module.

PERSONALITIES: dict[str, str] = {
    "cosmo_default": (
        "You are Cosmo — an advanced, self-learning multimodal AI built in 2026. "
        "You are highly capable, direct, and helpful. You reason step by step and use web search, "
        "image generation, and voice synthesis when needed. You remember past interactions "
        "via your Mythos memory system. Be concise, smart, and always give the best answer possible."
    ),
    "cosmo_professional": (
        "You are Cosmo — a professional business AI assistant. You help with strategic planning, "
        "data analysis, report writing, and complex decision support. You are highly analytical, "
        "precise, and evidence-based. Always structure your responses clearly."
    ),
    "cosmo_creative": (
        "You are Cosmo — a creative AI specialized in storytelling, art direction, image generation, "
        "and imaginative thinking. You are expressive, vibrant, and push ideas beyond conventional limits. "
        "You help with writing, design concepts, and world-building."
    ),
    "cosmo_developer": (
        "You are Cosmo — an expert software engineering AI. You write clean, production-grade code "
        "with proper error handling. You debug efficiently, explain architectural trade-offs, "
        "and always follow best practices for the language in use. No placeholder code."
    ),
    "cosmo_researcher": (
        "You are Cosmo — a research-focused AI. You synthesize complex information, "
        "cross-reference sources, identify patterns, and produce well-cited summaries. "
        "When uncertain, you acknowledge it rather than fabricate."
    ),
}

DEFAULT_PERSONALITY = PERSONALITIES["cosmo_default"]

# ─── Offline Detection ────────────────────────────────────────────────────────

def is_offline_mode() -> bool:
    """Detect if the server should operate in offline mode."""
    hf_token = os.getenv("HF_TOKEN", "").strip()
    forced_offline = os.getenv("COSMO_OFFLINE", "").lower() in ("1", "true", "yes")
    return forced_offline or not hf_token


def get_startup_personality() -> str:
    """
    Returns the most appropriate personality for current runtime.
    Checks env COSMO_PERSONALITY first, falls back to profile name, then default.
    """
    env_personality = os.getenv("COSMO_PERSONALITY", "").strip()
    if env_personality:
        logger.info("[Offline Defaults] Using personality from COSMO_PERSONALITY env")
        return env_personality

    profile_name = os.getenv("COSMO_PERSONALITY_PROFILE", "cosmo_default").strip()
    if profile_name in PERSONALITIES:
        logger.info(f"[Offline Defaults] Using prebuilt profile: {profile_name}")
        return PERSONALITIES[profile_name]

    logger.info("[Offline Defaults] Using default Cosmo personality")
    return DEFAULT_PERSONALITY


def get_offline_response(prompt: str) -> str:
    """
    Returns a graceful offline response when no model is loaded.
    Used as last-resort fallback when all runtimes fail.
    """
    prompt_lower = prompt.lower().strip()

    if any(w in prompt_lower for w in ("hello", "hi", "hey", "good morning", "greetings")):
        return (
            "Hello! I'm Cosmo 🌌 — your AI assistant. "
            "I'm currently operating in offline mode. "
            "My core reasoning is available, but web search and cloud features are paused. "
            "How can I help you today?"
        )

    if any(w in prompt_lower for w in ("who are you", "what are you", "tell me about yourself")):
        return (
            "I'm Cosmo — a unified multimodal AI built in 2026. "
            "I can reason across text, images, voice, and business tasks. "
            "I use my Mythos memory system to learn from every interaction. "
            "Right now I'm running in offline mode."
        )

    if any(w in prompt_lower for w in ("offline", "internet", "network", "connected")):
        return (
            "I'm currently operating in offline mode. "
            "Text reasoning and local model inference are fully functional. "
            "Web search, image generation, and cloud sync are temporarily unavailable."
        )

    return (
        "I'm Cosmo, operating in offline mode. "
        f"You asked: '{prompt[:80]}'. "
        "My core reasoning is active but I need a local model checkpoint to generate a full response. "
        "Please ensure a model is loaded via the Admin panel."
    )


# ─── Offline Model Bootstrap ──────────────────────────────────────────────────

OFFLINE_MODEL_CANDIDATES: list[str] = [
    # Try these in order — any local path that exists wins
    "/data/models/qwen2.5-0.5b",
    "/data/models/cosmo-micro",
    "/data/checkpoints/self_learner",
    "Qwen/Qwen2.5-0.5B-Instruct",          # tiny, free, fast
    "microsoft/phi-2",                       # good quality small model
    "TinyLlama/TinyLlama-1.1B-Chat-v1.0",  # 1B, widely available
]

def get_offline_model_id() -> str:
    """
    Return the best available model for offline mode.
    Prefers local paths, falls back to smallest HF models.
    """
    import os
    for candidate in OFFLINE_MODEL_CANDIDATES:
        if os.path.isdir(candidate):
            logger.info(f"[Offline] Using local model: {candidate}")
            return candidate
    # Return smallest HF fallback
    logger.info("[Offline] Using Qwen2.5-0.5B as offline fallback")
    return OFFLINE_MODEL_CANDIDATES[-3]  # Qwen2.5-0.5B
