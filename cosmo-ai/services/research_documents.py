from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Optional

from utils.app_paths import DATASETS_DIR, DATA_ROOT


RESEARCH_DOCUMENTS_PATH = DATA_ROOT / "crawled_documents.jsonl"


def ensure_research_document_dir() -> None:
    RESEARCH_DOCUMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)


def append_research_documents(documents: list[dict[str, Any]]) -> None:
    ensure_research_document_dir()
    with open(RESEARCH_DOCUMENTS_PATH, "a", encoding="utf-8") as handle:
        for document in documents:
            handle.write(json.dumps(document, ensure_ascii=True) + "\n")
    try:
        from utils.persistence import backup_file

        backup_file(str(RESEARCH_DOCUMENTS_PATH))
    except Exception:
        pass


def _topic_from_source(source: str) -> str:
    value = str(source or "")
    if value.startswith("research:"):
        parts = value.split(":")
        if len(parts) >= 2:
            return parts[1]
    return value or "unknown"


def _domain_from_url(url: str) -> str:
    from urllib.parse import urlparse

    hostname = urlparse(url or "").hostname or ""
    hostname = hostname.lower()
    return hostname[4:] if hostname.startswith("www.") else hostname


def _normalize_document(row: dict[str, Any]) -> dict[str, Any]:
    if "provider" in row and "topic" in row and "domain" in row:
        return row

    source = row.get("source") or ""
    source_url = row.get("source_url") or row.get("url") or ""
    domain = row.get("domain") or _domain_from_url(source_url) or "unknown"

    normalized = {
        "topic": row.get("topic") or _topic_from_source(source),
        "provider": row.get("provider") or "unknown",
        "source": source or f"research:{_topic_from_source(source)}:{domain}",
        "source_url": source_url,
        "url": row.get("url") or source_url,
        "domain": domain,
        "title": row.get("title") or row.get("topic") or _topic_from_source(source),
        "text": row.get("text") or "",
        "timestamp": row.get("timestamp") or 0,
        "policy": row.get("policy") or {
            "allowed": True,
            "reason": "legacy_record",
        },
        "provenance": row.get("provenance") or {
            "category": "legacy",
            "license": "unknown",
            "trust": "unknown",
            "notes": "Imported from a pre-provenance research record.",
            "override_domain": None,
        },
        "metadata": row.get("metadata") or {},
    }
    return normalized


def _iter_documents() -> list[dict[str, Any]]:
    if not RESEARCH_DOCUMENTS_PATH.exists():
        return []

    rows: list[dict[str, Any]] = []
    with open(RESEARCH_DOCUMENTS_PATH, "r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(_normalize_document(json.loads(line)))
            except json.JSONDecodeError:
                continue
    return rows


def _matches_filter(value: Optional[str], expected: Optional[str]) -> bool:
    if not expected:
        return True
    return str(value or "").lower() == str(expected).lower()


def _matches_search(document: dict[str, Any], search: Optional[str]) -> bool:
    if not search:
        return True
    needle = search.lower()
    for field in (
        document.get("topic"),
        document.get("domain"),
        document.get("title"),
        document.get("url"),
        document.get("text"),
    ):
        if needle in str(field or "").lower():
            return True
    return False


def filtered_documents(
    *,
    topic: Optional[str] = None,
    domain: Optional[str] = None,
    provider: Optional[str] = None,
    search: Optional[str] = None,
) -> list[dict[str, Any]]:
    rows = []
    for row in _iter_documents():
        if not _matches_filter(row.get("topic"), topic):
            continue
        if not _matches_filter(row.get("domain"), domain):
            continue
        if not _matches_filter(row.get("provider"), provider):
            continue
        if not _matches_search(row, search):
            continue
        rows.append(row)
    rows.sort(key=lambda row: row.get("timestamp", 0), reverse=True)
    return rows


def list_research_documents(
    *,
    limit: int = 20,
    topic: Optional[str] = None,
    domain: Optional[str] = None,
    provider: Optional[str] = None,
    search: Optional[str] = None,
    include_text: bool = False,
    preview_chars: int = 200,
) -> list[dict[str, Any]]:
    documents = filtered_documents(topic=topic, domain=domain, provider=provider, search=search)
    shaped: list[dict[str, Any]] = []
    for row in documents[: max(0, limit)]:
        shaped_row = dict(row)
        text = str(shaped_row.get("text") or "")
        shaped_row["text_length"] = len(text)
        shaped_row["text_preview"] = text[: max(0, preview_chars)]
        if not include_text:
            shaped_row.pop("text", None)
        shaped.append(shaped_row)
    return shaped


def summarize_research_documents() -> dict[str, Any]:
    documents = filtered_documents()
    if not documents:
        return {
            "document_count": 0,
            "providers": {},
            "domains": {},
            "topics": {},
            "latest_document_at": None,
        }

    providers: dict[str, int] = {}
    domains: dict[str, int] = {}
    topics: dict[str, int] = {}
    for document in documents:
        providers[document.get("provider") or "unknown"] = providers.get(document.get("provider") or "unknown", 0) + 1
        domains[document.get("domain") or "unknown"] = domains.get(document.get("domain") or "unknown", 0) + 1
        topics[document.get("topic") or "unknown"] = topics.get(document.get("topic") or "unknown", 0) + 1

    return {
        "document_count": len(documents),
        "providers": providers,
        "domains": dict(sorted(domains.items(), key=lambda item: item[1], reverse=True)[:20]),
        "topics": dict(sorted(topics.items(), key=lambda item: item[1], reverse=True)[:20]),
        "latest_document_at": documents[0].get("timestamp"),
    }


def export_research_documents(
    *,
    topic: Optional[str] = None,
    domain: Optional[str] = None,
    provider: Optional[str] = None,
    search: Optional[str] = None,
    include_text: bool = True,
    dataset_name: Optional[str] = None,
) -> dict[str, Any]:
    documents = filtered_documents(topic=topic, domain=domain, provider=provider, search=search)
    if not documents:
        raise FileNotFoundError("No research documents matched the requested filters")

    DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    filename = Path(dataset_name or f"research_export_{int(time.time())}.jsonl").name
    if not filename.endswith(".jsonl"):
        filename = f"{filename}.jsonl"
    target = DATASETS_DIR / filename

    with open(target, "w", encoding="utf-8") as handle:
        for document in documents:
            row = dict(document)
            if not include_text:
                row.pop("text", None)
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")

    return {
        "path": target,
        "name": target.name,
        "rows": len(documents),
        "size_bytes": target.stat().st_size,
        "filters": {
            "topic": topic,
            "domain": domain,
            "provider": provider,
            "search": search,
            "include_text": include_text,
        },
    }


def delete_research_documents(
    *,
    topic: Optional[str] = None,
    domain: Optional[str] = None,
    provider: Optional[str] = None,
    search: Optional[str] = None,
) -> dict[str, Any]:
    documents = _iter_documents()
    if not documents:
        return {
            "deleted": 0,
            "remaining": 0,
            "path": str(RESEARCH_DOCUMENTS_PATH),
        }

    kept: list[dict[str, Any]] = []
    deleted: list[dict[str, Any]] = []
    for row in documents:
        if (
            _matches_filter(row.get("topic"), topic)
            and _matches_filter(row.get("domain"), domain)
            and _matches_filter(row.get("provider"), provider)
            and _matches_search(row, search)
        ):
            deleted.append(row)
        else:
            kept.append(row)

    ensure_research_document_dir()
    with open(RESEARCH_DOCUMENTS_PATH, "w", encoding="utf-8") as handle:
        for row in kept:
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")
    try:
        from utils.persistence import backup_file

        backup_file(str(RESEARCH_DOCUMENTS_PATH))
    except Exception:
        pass

    return {
        "deleted": len(deleted),
        "remaining": len(kept),
        "path": str(RESEARCH_DOCUMENTS_PATH),
        "deleted_topics": sorted({row.get("topic") or "unknown" for row in deleted})[:20],
        "deleted_domains": sorted({row.get("domain") or "unknown" for row in deleted})[:20],
    }
