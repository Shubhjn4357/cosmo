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


def list_research_runs(limit: int = 20) -> list[dict[str, Any]]:
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

    rows.sort(key=lambda row: row.get("timestamp", 0), reverse=True)
    return rows[: max(0, limit)]


def summarize_research_runs(limit: int | None = None) -> dict[str, Any]:
    rows = list_research_runs(limit=limit or 10_000)
    if not rows:
        return {
            "runs": 0,
            "documents_indexed": 0,
            "last_run": None,
            "last_error": None,
            "last_provider": None,
            "last_job_id": None,
        }

    latest = rows[0]
    latest_error = next((row.get("error") for row in rows if row.get("status") == "failed" and row.get("error")), None)
    return {
        "runs": len(rows),
        "documents_indexed": sum(int(row.get("chunks_indexed") or 0) for row in rows if row.get("status") == "completed"),
        "last_run": latest.get("timestamp"),
        "last_error": latest_error if latest and latest.get("status") == "failed" else latest.get("error"),
        "last_provider": latest.get("provider"),
        "last_job_id": latest.get("job_id"),
    }


def delete_research_runs(
    *,
    topic: str | None = None,
    provider: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    rows = list_research_runs(limit=10_000_000)
    if not rows:
        return {
            "deleted": 0,
            "remaining": 0,
            "path": str(RESEARCH_HISTORY_PATH),
        }

    def _matches(row: dict[str, Any]) -> bool:
        if topic and str(row.get("topic") or "").lower() != topic.lower():
            return False
        if provider and str(row.get("provider") or "").lower() != provider.lower():
            return False
        if status and str(row.get("status") or "").lower() != status.lower():
            return False
        return True

    kept = [row for row in rows if not _matches(row)]
    deleted = [row for row in rows if _matches(row)]

    _ensure_history_dir()
    with open(RESEARCH_HISTORY_PATH, "w", encoding="utf-8") as handle:
        for row in sorted(kept, key=lambda item: item.get("timestamp", 0)):
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")
    try:
        from utils.persistence import backup_file

        backup_file(str(RESEARCH_HISTORY_PATH))
    except Exception:
        pass

    return {
        "deleted": len(deleted),
        "remaining": len(kept),
        "path": str(RESEARCH_HISTORY_PATH),
        "deleted_topics": sorted({row.get("topic") or "unknown" for row in deleted})[:20],
        "deleted_providers": sorted({row.get("provider") or "unknown" for row in deleted})[:20],
    }
