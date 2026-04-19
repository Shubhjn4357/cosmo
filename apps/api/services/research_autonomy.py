from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional
from utils.anonymizer import anonymize_lesson

from utils.app_paths import DATA_ROOT


AUTONOMY_CONFIG_PATH = DATA_ROOT / "research" / "autonomy.json"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except Exception:
        return max(minimum, default)


def _default_source(
    *,
    label: str,
    topic: str,
    start_url: Optional[str] = None,
    provider: str = "auto",
    max_pages: int = 3,
    max_sites: int = 1,
    depth: int = 1,
) -> dict[str, Any]:
    now = time.time()
    return {
        "id": uuid.uuid4().hex,
        "label": label,
        "topic": topic,
        "start_url": start_url,
        "provider": provider,
        "max_pages": max_pages,
        "max_sites": max_sites,
        "depth": depth,
        "render": False,
        "source": "all",
        "include_patterns": [],
        "exclude_patterns": [],
        "formats": ["markdown"],
        "include_external_links": False,
        "include_subdomains": False,
        "modified_since": None,
        "max_age": None,
        "refresh_existing": False,
        "enabled": True,
        "tags": [],
        "created_at": now,
        "updated_at": now,
        "last_run_at": None,
        "last_status": None,
        "last_error": None,
        "last_result": {},
        "runs_completed": 0,
        "runs_failed": 0,
    }


def _default_sources() -> list[dict[str, Any]]:
    return [
        _default_source(
            label="Python Docs",
            topic="python programming best practices",
            start_url="https://docs.python.org/3/",
        ),
        _default_source(
            label="Cloudflare Docs",
            topic="developer tooling updates",
            start_url="https://developers.cloudflare.com/",
        ),
        _default_source(
            label="MDN Web Docs",
            topic="software engineering patterns",
            start_url="https://developer.mozilla.org/en-US/docs/Web",
        ),
        _default_source(
            label="AI Research",
            topic="artificial intelligence research",
            provider="auto",
            max_pages=2,
            max_sites=1,
            depth=1,
        ),
    ]


def _default_config() -> dict[str, Any]:
    return {
        "enabled": _env_bool("AUTO_CRAWL_ENABLED", True),
        "interval_minutes": _env_int("AUTO_CRAWL_INTERVAL_MINUTES", 60, minimum=1),
        "auto_sync_hf": _env_bool("AUTO_CRAWL_SYNC_HF", True),
        "learning_chunk_chars": _env_int("AUTO_CRAWL_LEARNING_CHUNK_CHARS", 1200, minimum=200),
        "learning_max_chunks_per_document": _env_int("AUTO_CRAWL_LEARNING_MAX_CHUNKS", 2, minimum=1),
        "last_selected_source_id": None,
        "updated_at": time.time(),
        "sources": _default_sources(),
    }


def _normalize_source(source: dict[str, Any]) -> dict[str, Any]:
    created_at = source.get("created_at") or time.time()
    updated_at = source.get("updated_at") or created_at
    base = _default_source(
        label=source.get("label") or source.get("topic") or source.get("start_url") or "Research Source",
        topic=source.get("topic") or "general research",
        start_url=source.get("start_url"),
        provider=source.get("provider") or "auto",
        max_pages=int(source.get("max_pages") or 3),
        max_sites=int(source.get("max_sites") or 1),
        depth=int(source.get("depth") or 1),
    )
    merged = {**base, **source}
    merged["id"] = str(merged.get("id") or uuid.uuid4().hex)
    merged["label"] = str(merged.get("label") or merged.get("topic") or merged.get("start_url") or "Research Source")
    merged["topic"] = str(merged.get("topic") or merged["label"]).strip()
    merged["provider"] = str(merged.get("provider") or "auto").lower()
    merged["max_pages"] = max(1, int(merged.get("max_pages") or 3))
    merged["max_sites"] = max(1, int(merged.get("max_sites") or 1))
    merged["depth"] = max(0, int(merged.get("depth") or 1))
    merged["render"] = bool(merged.get("render"))
    merged["include_external_links"] = bool(merged.get("include_external_links"))
    merged["include_subdomains"] = bool(merged.get("include_subdomains"))
    merged["refresh_existing"] = bool(merged.get("refresh_existing"))
    merged["enabled"] = bool(merged.get("enabled", True))
    merged["include_patterns"] = [str(item) for item in (merged.get("include_patterns") or []) if str(item).strip()]
    merged["exclude_patterns"] = [str(item) for item in (merged.get("exclude_patterns") or []) if str(item).strip()]
    merged["formats"] = [str(item) for item in (merged.get("formats") or ["markdown"]) if str(item).strip()]
    merged["tags"] = [str(item) for item in (merged.get("tags") or []) if str(item).strip()]
    merged["created_at"] = created_at
    merged["updated_at"] = updated_at
    return merged


def _normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    defaults = _default_config()
    normalized = {**defaults, **(config or {})}
    normalized["enabled"] = bool(normalized.get("enabled", defaults["enabled"]))
    normalized["interval_minutes"] = max(1, int(normalized.get("interval_minutes") or defaults["interval_minutes"]))
    normalized["auto_sync_hf"] = bool(normalized.get("auto_sync_hf", defaults["auto_sync_hf"]))
    normalized["learning_chunk_chars"] = max(200, int(normalized.get("learning_chunk_chars") or defaults["learning_chunk_chars"]))
    normalized["learning_max_chunks_per_document"] = max(
        1,
        int(normalized.get("learning_max_chunks_per_document") or defaults["learning_max_chunks_per_document"]),
    )
    normalized["last_selected_source_id"] = normalized.get("last_selected_source_id")
    normalized["updated_at"] = normalized.get("updated_at") or time.time()
    normalized["sources"] = [_normalize_source(source) for source in (normalized.get("sources") or defaults["sources"])]
    return normalized


def _ensure_parent() -> None:
    AUTONOMY_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)


def load_autonomy_config() -> dict[str, Any]:
    _ensure_parent()
    if not AUTONOMY_CONFIG_PATH.exists():
        config = _default_config()
        AUTONOMY_CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
        return config
    try:
        payload = json.loads(AUTONOMY_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        payload = _default_config()
    normalized = _normalize_config(payload)
    AUTONOMY_CONFIG_PATH.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    return normalized


def save_autonomy_config(config: dict[str, Any]) -> dict[str, Any]:
    _ensure_parent()
    normalized = _normalize_config(config)
    normalized["updated_at"] = time.time()
    AUTONOMY_CONFIG_PATH.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    return normalized


def autonomy_status() -> dict[str, Any]:
    config = load_autonomy_config()
    sources = config.get("sources") or []
    return {
        "enabled": config["enabled"],
        "interval_minutes": config["interval_minutes"],
        "auto_sync_hf": config["auto_sync_hf"],
        "learning_chunk_chars": config["learning_chunk_chars"],
        "learning_max_chunks_per_document": config["learning_max_chunks_per_document"],
        "config_path": str(AUTONOMY_CONFIG_PATH),
        "updated_at": config.get("updated_at"),
        "last_selected_source_id": config.get("last_selected_source_id"),
        "source_count": len(sources),
        "enabled_source_count": sum(1 for source in sources if source.get("enabled", True)),
        "sources": sources,
    }


def update_autonomy_settings(payload: dict[str, Any]) -> dict[str, Any]:
    config = load_autonomy_config()
    for key in (
        "enabled",
        "interval_minutes",
        "auto_sync_hf",
        "learning_chunk_chars",
        "learning_max_chunks_per_document",
        "last_selected_source_id",
    ):
        if key in payload and payload[key] is not None:
            config[key] = payload[key]
    return save_autonomy_config(config)


def add_autonomy_source(payload: dict[str, Any]) -> dict[str, Any]:
    config = load_autonomy_config()
    source = _normalize_source(payload)
    config["sources"].append(source)
    save_autonomy_config(config)
    return source


def update_autonomy_source(source_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    config = load_autonomy_config()
    for index, source in enumerate(config["sources"]):
        if source.get("id") != source_id:
            continue
        merged = _normalize_source(
            {
                **source,
                **payload,
                "id": source_id,
                "created_at": source.get("created_at"),
                "updated_at": time.time(),
            }
        )
        config["sources"][index] = merged
        save_autonomy_config(config)
        return merged
    raise KeyError(source_id)


def delete_autonomy_source(source_id: str) -> dict[str, Any]:
    config = load_autonomy_config()
    kept = [source for source in config["sources"] if source.get("id") != source_id]
    deleted = len(kept) != len(config["sources"])
    config["sources"] = kept
    if config.get("last_selected_source_id") == source_id:
        config["last_selected_source_id"] = None
    save_autonomy_config(config)
    return {"deleted": deleted, "source_id": source_id, "remaining": len(kept)}


def select_next_autonomy_source() -> Optional[dict[str, Any]]:
    config = load_autonomy_config()
    enabled_sources = [source for source in config["sources"] if source.get("enabled", True)]
    if not enabled_sources:
        return None

    last_selected = config.get("last_selected_source_id")
    next_index = 0
    if last_selected:
        for index, source in enumerate(enabled_sources):
            if source.get("id") == last_selected:
                next_index = (index + 1) % len(enabled_sources)
                break

    selected = enabled_sources[next_index]
    config["last_selected_source_id"] = selected.get("id")
    save_autonomy_config(config)
    return selected


def record_autonomy_run(source_id: str, *, status: str, result: Optional[dict[str, Any]] = None, error: Optional[str] = None) -> None:
    config = load_autonomy_config()
    updated = False
    for index, source in enumerate(config["sources"]):
        if source.get("id") != source_id:
            continue
        refreshed = dict(source)
        refreshed["last_run_at"] = time.time()
        refreshed["last_status"] = status
        refreshed["last_error"] = error
        
        # Audit: Anonymize the result summary before persisting to config
        if result:
            scrubbed_result = {}
            for k, v in result.items():
                if isinstance(v, str):
                    scrubbed_result[k] = anonymize_lesson(v)
                else:
                    scrubbed_result[k] = v
            refreshed["last_result"] = scrubbed_result
        else:
            refreshed["last_result"] = {}
        if status == "completed":
            refreshed["runs_completed"] = int(refreshed.get("runs_completed") or 0) + 1
        elif status == "failed":
            refreshed["runs_failed"] = int(refreshed.get("runs_failed") or 0) + 1
        refreshed["updated_at"] = time.time()
        config["sources"][index] = refreshed
        updated = True
        break

    if updated:
        save_autonomy_config(config)
