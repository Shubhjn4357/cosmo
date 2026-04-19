from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from utils.app_paths import DATA_ROOT


RESEARCH_HISTORY_PATH = DATA_ROOT / "research" / "history.jsonl"


def _ensure_history_dir() -> None:
    RESEARCH_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)


def record_research_run(entry: dict[str, Any]) -> dict[str, Any]:
    _ensure_history_dir()
    record = {
        "id": entry.get("id") or uuid.uuid4().hex,
        "timestamp": entry.get("timestamp") or time.time(),
        **entry,
    }
    with open(RESEARCH_HISTORY_PATH, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=True) + "\n")
    try:
        from utils.persistence import backup_file

        backup_file(str(RESEARCH_HISTORY_PATH))
    except Exception:
        pass
    return record


def _load_research_runs() -> list[dict[str, Any]]:
    if not RESEARCH_HISTORY_PATH.exists():
        return []

    rows: list[dict[str, Any]] = []
    with open(RESEARCH_HISTORY_PATH, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def _save_research_runs(rows: list[dict[str, Any]]) -> None:
    _ensure_history_dir()
    with open(RESEARCH_HISTORY_PATH, "w", encoding="utf-8") as handle:
        for row in sorted(rows, key=lambda item: item.get("timestamp", 0)):
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")
    try:
        from utils.persistence import backup_file

        backup_file(str(RESEARCH_HISTORY_PATH))
    except Exception:
        pass


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _normalize_url(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    while normalized.endswith("/"):
        normalized = normalized[:-1]
    return normalized


def _normalize_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _normalize_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _matches_autonomy_source(row: dict[str, Any], source: dict[str, Any]) -> bool:
    if row.get("autonomy_source_id") or row.get("autonomy_source_label"):
        return False

    if _normalize_text(row.get("topic")) != _normalize_text(source.get("topic")):
        return False

    source_start_url = _normalize_url(source.get("start_url"))
    row_start_url = _normalize_url(row.get("start_url"))
    if source_start_url:
        if row_start_url != source_start_url:
            return False
    elif row_start_url:
        return False

    if _normalize_int(row.get("max_pages"), 0) != _normalize_int(source.get("max_pages"), 0):
        return False
    if _normalize_int(row.get("max_sites"), 0) != _normalize_int(source.get("max_sites"), 0):
        return False
    if _normalize_int(row.get("depth"), 0) != _normalize_int(source.get("depth"), 0):
        return False
    if _normalize_bool(row.get("render")) != _normalize_bool(source.get("render")):
        return False
    if _normalize_text(row.get("source") or "all") != _normalize_text(source.get("source") or "all"):
        return False

    source_provider = _normalize_text(source.get("provider") or "auto")
    requested_provider = _normalize_text(row.get("requested_provider"))
    actual_provider = _normalize_text(row.get("provider"))
    if source_provider == "auto":
        if requested_provider not in {"", "auto"}:
            return False
        if actual_provider not in {"none", "legacy", "cloudflare"}:
            return False
    else:
        if requested_provider:
            if requested_provider != source_provider:
                return False
        elif actual_provider != source_provider:
            return False

    return True


def _backfill_autonomy_sources(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    try:
        from services.research_autonomy import load_autonomy_config

        sources = load_autonomy_config().get("sources") or []
    except Exception:
        return rows, 0

    updated_rows: list[dict[str, Any]] = []
    changed = 0
    for row in rows:
        if row.get("autonomy_source_id") or row.get("autonomy_source_label"):
            updated_rows.append(row)
            continue

        matched_source = next((source for source in sources if _matches_autonomy_source(row, source)), None)
        if matched_source is None:
            updated_rows.append(row)
            continue

        changed += 1
        updated_rows.append(
            {
                **row,
                "autonomy_source_id": matched_source.get("id"),
                "autonomy_source_label": matched_source.get("label") or matched_source.get("topic"),
                "autonomy_source_inferred": True,
            }
        )
    return updated_rows, changed


def _matches_filter(actual: Any, expected: str | None) -> bool:
    if expected is None or str(expected).strip() == "":
        return True
    return str(actual or "").strip().lower() == str(expected).strip().lower()


def _matches_search(row: dict[str, Any], search: str | None) -> bool:
    if search is None or str(search).strip() == "":
        return True
    needle = str(search).strip().lower()
    for field in (
        row.get("topic"),
        row.get("provider"),
        row.get("status"),
        row.get("error"),
        row.get("autonomy_source_id"),
        row.get("autonomy_source_label"),
        row.get("start_url"),
    ):
        if needle in str(field or "").lower():
            return True
    return False


def _filter_research_runs(
    rows: list[dict[str, Any]],
    *,
    topic: str | None = None,
    provider: str | None = None,
    status: str | None = None,
    source_id: str | None = None,
    source_label: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []
    for row in rows:
        if not _matches_filter(row.get("topic"), topic):
            continue
        if not _matches_filter(row.get("provider"), provider):
            continue
        if not _matches_filter(row.get("status"), status):
            continue
        if not _matches_filter(row.get("autonomy_source_id"), source_id):
            continue
        if not _matches_filter(row.get("autonomy_source_label"), source_label):
            continue
        if not _matches_search(row, search):
            continue
        filtered.append(row)
    return filtered


def list_research_runs(
    limit: int = 20,
    *,
    topic: str | None = None,
    provider: str | None = None,
    status: str | None = None,
    source_id: str | None = None,
    source_label: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    loaded_rows = _load_research_runs()
    backfilled_rows, backfilled_count = _backfill_autonomy_sources(loaded_rows)
    if backfilled_count:
        _save_research_runs(backfilled_rows)
    rows = _filter_research_runs(
        backfilled_rows,
        topic=topic,
        provider=provider,
        status=status,
        source_id=source_id,
        source_label=source_label,
        search=search,
    )
    rows.sort(key=lambda row: row.get("timestamp", 0), reverse=True)
    return rows[: max(0, limit)]


def summarize_research_runs(
    limit: int | None = None,
    *,
    topic: str | None = None,
    provider: str | None = None,
    status: str | None = None,
    source_id: str | None = None,
    source_label: str | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    rows = list_research_runs(
        limit=limit or 10_000,
        topic=topic,
        provider=provider,
        status=status,
        source_id=source_id,
        source_label=source_label,
        search=search,
    )
    if not rows:
        return {
            "runs": 0,
            "completed_runs": 0,
            "failed_runs": 0,
            "documents_indexed": 0,
            "last_run": None,
            "last_error": None,
            "last_provider": None,
            "last_job_id": None,
            "source_count": 0,
        }

    latest = rows[0]
    latest_error = next((row.get("error") for row in rows if row.get("status") == "failed" and row.get("error")), None)
    return {
        "runs": len(rows),
        "completed_runs": sum(1 for row in rows if row.get("status") == "completed"),
        "failed_runs": sum(1 for row in rows if row.get("status") == "failed"),
        "documents_indexed": sum(int(row.get("chunks_indexed") or 0) for row in rows if row.get("status") == "completed"),
        "last_run": latest.get("timestamp"),
        "last_error": latest_error if latest and latest.get("status") == "failed" else latest.get("error"),
        "last_provider": latest.get("provider"),
        "last_job_id": latest.get("job_id"),
        "source_count": len(
            {
                row.get("autonomy_source_id") or row.get("autonomy_source_label")
                for row in rows
                if row.get("autonomy_source_id") or row.get("autonomy_source_label")
            }
        ),
    }


def delete_research_runs(
    *,
    topic: str | None = None,
    provider: str | None = None,
    status: str | None = None,
    source_id: str | None = None,
    source_label: str | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    rows = _load_research_runs()
    if not rows:
        return {
            "deleted": 0,
            "remaining": 0,
            "path": str(RESEARCH_HISTORY_PATH),
        }

    def _matches(row: dict[str, Any]) -> bool:
        return bool(
            _filter_research_runs(
                [row],
                topic=topic,
                provider=provider,
                status=status,
                source_id=source_id,
                source_label=source_label,
                search=search,
            )
        )

    kept = [row for row in rows if not _matches(row)]
    deleted = [row for row in rows if _matches(row)]

    _save_research_runs(kept)

    return {
        "deleted": len(deleted),
        "remaining": len(kept),
        "path": str(RESEARCH_HISTORY_PATH),
        "deleted_topics": sorted({row.get("topic") or "unknown" for row in deleted})[:20],
        "deleted_providers": sorted({row.get("provider") or "unknown" for row in deleted})[:20],
        "deleted_source_ids": sorted({row.get("autonomy_source_id") or "manual" for row in deleted})[:20],
    }
