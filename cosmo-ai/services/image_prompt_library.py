"""
Image prompt prior powered by imported curated prompt corpora.

This is not a pixel-model trainer. It uses imported prompt datasets as a local
prior to expand terse prompts into better descriptive prompts before image
generation.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from services.curated_training_import import CURATED_IMAGE_PROMPT_DIR, keyword_set


class ImagePromptLibrary:
    def __init__(self):
        self._cache_mtime = 0.0
        self._prompts: list[str] = []

    def _current_mtime(self) -> float:
        latest = 0.0
        for path in CURATED_IMAGE_PROMPT_DIR.glob("*.jsonl"):
            try:
                latest = max(latest, path.stat().st_mtime)
            except Exception:
                continue
        return latest

    def _load_prompts(self) -> list[str]:
        enabled = os.getenv("COSMO_IMAGE_PROMPT_PRIOR_ENABLED", "true").lower() == "true"
        if not enabled:
            self._prompts = []
            self._cache_mtime = 0.0
            return []

        max_prompts = max(100, int(os.getenv("COSMO_IMAGE_PROMPT_PRIOR_MAX_PROMPTS", "2000")))
        current_mtime = self._current_mtime()
        if self._prompts and current_mtime <= self._cache_mtime:
            return self._prompts

        prompts: list[str] = []
        for path in sorted(CURATED_IMAGE_PROMPT_DIR.glob("*.jsonl")):
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if len(prompts) >= max_prompts:
                        break
                    if not line.strip():
                        continue
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    prompt = str(payload.get("prompt") or "").strip()
                    if len(prompt) >= 12:
                        prompts.append(prompt)
            if len(prompts) >= max_prompts:
                break

        self._prompts = prompts
        self._cache_mtime = current_mtime
        return prompts

    def _best_match(self, prompt: str) -> str | None:
        prompts = self._load_prompts()
        if not prompts:
            return None

        target_keywords = keyword_set(prompt)
        if not target_keywords:
            return None

        best_prompt = None
        best_score = 0

        for candidate in prompts:
            candidate_keywords = keyword_set(candidate)
            overlap = len(target_keywords & candidate_keywords)
            if overlap <= 0:
                continue
            score = overlap * 10 - abs(len(candidate) - len(prompt)) // 20
            if score > best_score:
                best_score = score
                best_prompt = candidate

        return best_prompt if best_score >= 10 else None

    def enrich_prompt(self, prompt: str) -> str:
        normalized = str(prompt or "").strip()
        if not normalized:
            return normalized

        # Long prompts already carry enough detail.
        if len(normalized) >= 180:
            return normalized

        match = self._best_match(normalized)
        if not match:
            return normalized

        existing = {segment.strip().lower() for segment in normalized.split(",") if segment.strip()}
        additions: list[str] = []

        for segment in match.split(","):
            cleaned = segment.strip()
            if not cleaned:
                continue
            lowered = cleaned.lower()
            if lowered in existing or lowered in {item.lower() for item in additions}:
                continue
            if len(cleaned) > 60:
                continue
            additions.append(cleaned)
            if len(additions) >= 3:
                break

        if not additions:
            return normalized

        return f"{normalized}, {', '.join(additions)}"

    def status(self) -> dict[str, Any]:
        prompts = self._load_prompts()
        return {
            "enabled": os.getenv("COSMO_IMAGE_PROMPT_PRIOR_ENABLED", "true").lower() == "true",
            "prompt_count": len(prompts),
            "dataset_dir": str(CURATED_IMAGE_PROMPT_DIR),
        }


image_prompt_library = ImagePromptLibrary()
