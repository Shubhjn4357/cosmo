"""
Cosmo AI - Analytics Routes
Server metrics, response tracking, and system analytics.
"""
import hashlib
import json
import time
from datetime import date, datetime, timedelta, timezone
from threading import Lock
from typing import Dict, Any, List

import psutil
from dataclasses import dataclass, field
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from .auth import verify_admin_token
from services.system_jobs import (
    refresh_job_state,
    start_generator_job,
    start_training_job,
    stop_generator_job,
    stop_training_job,
)
from utils.app_paths import DATA_ROOT


router = APIRouter()
DAILY_ANALYTICS_PATH = DATA_ROOT / "analytics" / "daily_metrics.json"
EVENT_ANALYTICS_PATH = DATA_ROOT / "analytics" / "mobile_usage_events.jsonl"


@dataclass
class AnalyticsTracker:
    """Tracks request analytics and persists daily aggregates."""
    start_time: float = field(default_factory=time.time)
    request_count: int = 0
    total_response_time: float = 0.0
    knowledge_added: int = 0
    chat_requests: int = 0
    image_requests: int = 0
    errors: int = 0
    recent_response_times: List[float] = field(default_factory=list)
    daily_metrics: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock, repr=False)

    def __post_init__(self):
        self._load_daily_metrics()

    def _load_daily_metrics(self):
        try:
            if DAILY_ANALYTICS_PATH.exists():
                payload = json.loads(DAILY_ANALYTICS_PATH.read_text(encoding="utf-8"))
                if isinstance(payload, dict):
                    self.daily_metrics = payload
        except Exception:
            self.daily_metrics = {}

    def _save_daily_metrics(self):
        DAILY_ANALYTICS_PATH.parent.mkdir(parents=True, exist_ok=True)
        DAILY_ANALYTICS_PATH.write_text(
            json.dumps(self.daily_metrics, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    def _prune_daily_metrics(self, keep_days: int = 35):
        cutoff = date.today() - timedelta(days=max(keep_days - 1, 0))
        self.daily_metrics = {
            day_key: data
            for day_key, data in self.daily_metrics.items()
            if day_key >= cutoff.isoformat()
        }

    def _get_day_bucket(self, day_key: str) -> Dict[str, Any]:
        bucket = self.daily_metrics.setdefault(
            day_key,
            {
                "requests": 0,
                "chat_requests": 0,
                "image_requests": 0,
                "knowledge_added": 0,
                "errors": 0,
                "unique_clients": [],
            },
        )
        bucket.setdefault("requests", 0)
        bucket.setdefault("chat_requests", 0)
        bucket.setdefault("image_requests", 0)
        bucket.setdefault("knowledge_added", 0)
        bucket.setdefault("errors", 0)
        bucket.setdefault("unique_clients", [])
        return bucket

    def _client_hash(self, client_id: str | None) -> str | None:
        if not client_id:
            return None
        return hashlib.sha1(client_id.encode("utf-8")).hexdigest()[:12]

    def _record_daily_event(
        self,
        *,
        requests: int = 0,
        chat_requests: int = 0,
        image_requests: int = 0,
        knowledge_added: int = 0,
        errors: int = 0,
        client_id: str | None = None,
    ):
        with self._lock:
            bucket = self._get_day_bucket(date.today().isoformat())
            bucket["requests"] += requests
            bucket["chat_requests"] += chat_requests
            bucket["image_requests"] += image_requests
            bucket["knowledge_added"] += knowledge_added
            bucket["errors"] += errors
            client_hash = self._client_hash(client_id)
            if client_hash and client_hash not in bucket["unique_clients"]:
                bucket["unique_clients"].append(client_hash)
            self._prune_daily_metrics()
            self._save_daily_metrics()

    def _categorize_endpoint(self, endpoint: str) -> Dict[str, int]:
        if endpoint.startswith("/api/chat"):
            return {"chat_requests": 1}
        if endpoint.startswith("/api/image"):
            return {"image_requests": 1}
        return {}

    def record_request(
        self,
        response_time: float,
        endpoint: str = "",
        client_id: str | None = None,
        status_code: int | None = None,
    ):
        """Record a request."""
        self.request_count += 1
        self.total_response_time += response_time

        categories = self._categorize_endpoint(endpoint)
        self.chat_requests += categories.get("chat_requests", 0)
        self.image_requests += categories.get("image_requests", 0)
        if status_code is not None and status_code >= 500:
            self.errors += 1

        self.recent_response_times.append(response_time)
        if len(self.recent_response_times) > 100:
            self.recent_response_times.pop(0)

        self._record_daily_event(
            requests=1,
            chat_requests=categories.get("chat_requests", 0),
            image_requests=categories.get("image_requests", 0),
            errors=1 if status_code is not None and status_code >= 500 else 0,
            client_id=client_id,
        )

    def record_error(self, client_id: str | None = None):
        """Record an error."""
        self.errors += 1
        self._record_daily_event(errors=1, client_id=client_id)

    def record_knowledge_added(self, count: int = 1):
        """Record knowledge addition."""
        self.knowledge_added += count
        self._record_daily_event(knowledge_added=count)

    def get_day_totals(self, day_key: str | None = None) -> Dict[str, int]:
        day_key = day_key or date.today().isoformat()
        bucket = self.daily_metrics.get(day_key, {})
        return {
            "requests": int(bucket.get("requests", 0)),
            "chat_requests": int(bucket.get("chat_requests", 0)),
            "image_requests": int(bucket.get("image_requests", 0)),
            "knowledge_added": int(bucket.get("knowledge_added", 0)),
            "errors": int(bucket.get("errors", 0)),
            "unique_clients": len(bucket.get("unique_clients", [])),
        }

    def get_daily_series(self, days: int = 7) -> Dict[str, Any]:
        labels: List[str] = []
        dau: List[int] = []
        requests: List[int] = []
        chat: List[int] = []
        image: List[int] = []
        knowledge: List[int] = []
        errors: List[int] = []
        totals = {
            "requests": 0,
            "chat_requests": 0,
            "image_requests": 0,
            "knowledge_added": 0,
            "errors": 0,
        }

        for offset in range(days - 1, -1, -1):
            day = date.today() - timedelta(days=offset)
            bucket = self.get_day_totals(day.isoformat())
            labels.append(day.strftime("%a"))
            dau.append(bucket["unique_clients"])
            requests.append(bucket["requests"])
            chat.append(bucket["chat_requests"])
            image.append(bucket["image_requests"])
            knowledge.append(bucket["knowledge_added"])
            errors.append(bucket["errors"])
            totals["requests"] += bucket["requests"]
            totals["chat_requests"] += bucket["chat_requests"]
            totals["image_requests"] += bucket["image_requests"]
            totals["knowledge_added"] += bucket["knowledge_added"]
            totals["errors"] += bucket["errors"]

        return {
            "labels": labels,
            "dau": dau,
            "requests": requests,
            "chat_requests": chat,
            "image_requests": image,
            "knowledge_added": knowledge,
            "errors": errors,
            "totals": totals,
        }

    def get_stats(self) -> Dict[str, Any]:
        """Get current statistics."""
        uptime = time.time() - self.start_time
        avg_response = (
            sum(self.recent_response_times) / len(self.recent_response_times)
            if self.recent_response_times else 0
        )
        today = self.get_day_totals()

        return {
            "uptime_seconds": int(uptime),
            "uptime_formatted": self._format_uptime(uptime),
            "total_requests": self.request_count,
            "chat_requests": self.chat_requests,
            "image_requests": self.image_requests,
            "knowledge_added": self.knowledge_added,
            "errors": self.errors,
            "avg_response_time_ms": round(avg_response * 1000, 2),
            "requests_per_minute": round(self.request_count / max(uptime / 60, 1), 2),
            "today": today,
        }

    def _format_uptime(self, seconds: float) -> str:
        """Format uptime as human readable."""
        hours, remainder = divmod(int(seconds), 3600)
        minutes, secs = divmod(remainder, 60)
        if hours > 0:
            return f"{hours}h {minutes}m {secs}s"
        elif minutes > 0:
            return f"{minutes}m {secs}s"
        return f"{secs}s"


# Global analytics tracker (lightweight)
analytics = AnalyticsTracker()


class AnalyticsCollectEvent(BaseModel):
    model_config = {"protected_namespaces": ()}
    type: str
    action: str
    metadata: dict[str, Any] | None = None
    timestamp: str


class AnalyticsCollectRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    events: list[AnalyticsCollectEvent]
    deviceId: str | None = None


def _period_days(period: str | None) -> int:
    normalized = str(period or "week").strip().lower()
    if normalized == "day":
        return 1
    if normalized == "month":
        return 30
    return 7


def _cutoff_timestamp(days: int) -> str:
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(days - 1, 0))
    return cutoff.isoformat()


def _write_usage_events(payload: AnalyticsCollectRequest) -> int:
    EVENT_ANALYTICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    device_id = str(payload.deviceId or "").strip() or "anonymous"
    written = 0
    with EVENT_ANALYTICS_PATH.open("a", encoding="utf-8") as handle:
        for event in payload.events:
            handle.write(
                json.dumps(
                    {
                        "type": event.type,
                        "action": event.action,
                        "metadata": event.metadata or {},
                        "timestamp": event.timestamp,
                        "device_id": device_id,
                        "received_at": datetime.now(timezone.utc).isoformat(),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            written += 1
    return written


def _usage_requests_by_day(days: int) -> list[dict[str, Any]]:
    series = analytics.get_daily_series(days=days)
    return [
        {
            "date": (date.today() - timedelta(days=days - index - 1)).isoformat(),
            "count": count,
        }
        for index, count in enumerate(series["requests"])
    ]


def _token_analytics_payload(*, user_id: str | None, period: str | None) -> dict[str, Any]:
    from .profile import get_db_client

    days = _period_days(period)
    db_client = get_db_client()
    if not db_client or not user_id:
        return {
            "total_tokens_used": 0,
            "tokens_by_feature": [],
            "tokens_by_day": [
                {"date": (date.today() - timedelta(days=days - index - 1)).isoformat(), "tokens": 0}
                for index in range(days)
            ],
            "average_daily_usage": 0,
        }

    try:
        result = (
            db_client.table("token_usage")
            .select("feature,tokens_used,created_at")
            .eq("user_id", user_id)
            .gte("created_at", _cutoff_timestamp(days))
            .execute()
        )
    except Exception:
        result = None

    rows = result.data if result and getattr(result, "data", None) else []
    tokens_by_feature: dict[str, float] = {}
    tokens_by_day: dict[str, float] = {}

    for row in rows:
        feature = str(row.get("feature") or "unknown")
        tokens = float(row.get("tokens_used") or 0)
        created_at = str(row.get("created_at") or "")
        day_key = created_at.split("T", 1)[0] if created_at else date.today().isoformat()
        tokens_by_feature[feature] = tokens_by_feature.get(feature, 0.0) + tokens
        tokens_by_day[day_key] = tokens_by_day.get(day_key, 0.0) + tokens

    ordered_days = [
        (date.today() - timedelta(days=days - index - 1)).isoformat()
        for index in range(days)
    ]
    day_series = [{"date": day_key, "tokens": round(tokens_by_day.get(day_key, 0.0), 2)} for day_key in ordered_days]
    total_tokens = round(sum(tokens_by_feature.values()), 2)

    return {
        "total_tokens_used": total_tokens,
        "tokens_by_feature": [
            {"feature": feature, "tokens": round(tokens, 2)}
            for feature, tokens in sorted(tokens_by_feature.items(), key=lambda item: item[1], reverse=True)
        ],
        "tokens_by_day": day_series,
        "average_daily_usage": round(total_tokens / max(days, 1), 2),
    }


def _popular_models_payload() -> dict[str, Any]:
    from .profile import get_db_client
    from services.admin_state import get_selected_image_model
    from services.model_manager import get_profiles

    db_client = get_db_client()
    model_counts: dict[str, int] = {}

    if db_client:
        try:
            image_rows = db_client.table("generated_images").select("model_id").execute()
            for row in image_rows.data or []:
                model_id = str(row.get("model_id") or "").strip()
                if model_id:
                    model_counts[model_id] = model_counts.get(model_id, 0) + 1
        except Exception:
            pass

    if not model_counts:
        selected_image_model = get_selected_image_model("cyberrealistic-v9") or "cyberrealistic-v9"
        model_counts[selected_image_model] = 1
        for profile_id in get_profiles().keys():
            model_counts.setdefault(profile_id, 0)

    total = sum(model_counts.values()) or 1
    models = [
        {
            "model": model_id,
            "usage_count": count,
            "percentage": round((count / total) * 100, 2),
        }
        for model_id, count in sorted(model_counts.items(), key=lambda item: item[1], reverse=True)
    ]
    return {"models": models}


def get_system_metrics() -> Dict[str, Any]:
    """Get system resource metrics."""
    try:
        memory = psutil.virtual_memory()
        cpu_percent = psutil.cpu_percent(interval=0.1)
        
        return {
            "cpu_percent": cpu_percent,
            "memory_used_gb": round(memory.used / (1024**3), 2),
            "memory_total_gb": round(memory.total / (1024**3), 2),
            "memory_percent": memory.percent
        }
    except Exception:
        return {
            "cpu_percent": 0,
            "memory_used_gb": 0,
            "memory_total_gb": 16,
            "memory_percent": 0
        }


@router.get("/admin/system-analytics")
async def get_system_analytics(payload: dict = Depends(verify_admin_token)):
    """Get low-level server analytics (admin only)."""
    from ..route import get_app_state
    
    app_state = get_app_state()
    jobs = refresh_job_state(app_state)
    
    stats = analytics.get_stats()
    system = get_system_metrics()
    
    runtime = (
        app_state.chat_runtime.status()
        if app_state.chat_runtime is not None
        else {
            "active_backend": "uninitialized",
            "model_id": None,
            "loaded": False,
        }
    )
    
    # Knowledge base info
    kb_stats = {}
    if app_state.vectordb:
        kb_stats = app_state.vectordb.get_stats()
    
    return {
        "analytics": stats,
        "system": system,
        "model": {
            "parameters": 0,
            "parameters_formatted": "n/a",
            "loaded": runtime.get("loaded", False),
            "backend": runtime.get("active_backend"),
            "model_id": runtime.get("model_id"),
        },
        "knowledge": kb_stats,
        "status": {
            "server": "running",
            "model_loaded": runtime.get("loaded", False),
            "tokenizer_loaded": runtime.get("loaded", False),
            "vectordb_loaded": app_state.vectordb is not None,
            "is_training": app_state.is_training,
            "daemon_running": app_state.daemon_running,
        },
        "jobs": jobs,
    }


@router.get("/analytics/usage")
async def get_usage_analytics(user_id: str | None = None, period: str = "week"):
    days = _period_days(period)
    stats = analytics.get_stats()
    series = analytics.get_daily_series(days=days)
    total_requests = series["totals"]["requests"]
    failed_requests = series["totals"]["errors"]
    successful_requests = max(total_requests - failed_requests, 0)

    return {
        "user_id": user_id,
        "period": period,
        "total_requests": total_requests,
        "successful_requests": successful_requests,
        "failed_requests": failed_requests,
        "average_response_time": stats["avg_response_time_ms"],
        "requests_by_day": _usage_requests_by_day(days),
    }


@router.get("/analytics/tokens")
async def get_token_analytics(user_id: str | None = None, period: str = "week"):
    return {
        "user_id": user_id,
        "period": period,
        **_token_analytics_payload(user_id=user_id, period=period),
    }


@router.get("/analytics/popular-models")
async def get_popular_models():
    return _popular_models_payload()


@router.post("/analytics/collect")
async def collect_mobile_analytics(request: AnalyticsCollectRequest):
    written = _write_usage_events(request)
    return {
        "success": True,
        "accepted": written,
        "device_id": str(request.deviceId or "").strip() or "anonymous",
    }


@router.get("/admin/status")
async def get_status(payload: dict = Depends(verify_admin_token)):
    """Get detailed server status (admin only)."""
    from ..route import get_app_state
    
    app_state = get_app_state()
    system = get_system_metrics()
    jobs = refresh_job_state(app_state)
    
    return {
        "healthy": True,
        "components": {
            "model": "loaded" if app_state.chat_runtime and app_state.chat_runtime.is_ready() else "not loaded",
            "tokenizer": "loaded" if app_state.chat_runtime and app_state.chat_runtime.is_ready() else "not loaded",
            "vectordb": "loaded" if app_state.vectordb else "not loaded",
            "rag": "loaded" if app_state.rag else "not loaded"
        },
        "system": system,
        "uptime": analytics.get_stats()["uptime_formatted"],
        "jobs": jobs,
    }


@router.post("/admin/generator/start")
async def start_generator(payload: dict = Depends(verify_admin_token)):
    """Start the data generator (admin only)."""
    from ..route import get_app_state
    
    app_state = get_app_state()
    return start_generator_job(app_state)


@router.post("/admin/generator/stop")
async def stop_generator(payload: dict = Depends(verify_admin_token)):
    """Stop hint for generator (it will stop on next iteration)."""
    from ..route import get_app_state
    
    app_state = get_app_state()
    return stop_generator_job(app_state)


@router.post("/admin/training/start")
async def start_training(payload: dict = Depends(verify_admin_token), steps: int = 100):
    """Start training process (admin only)."""
    from ..route import get_app_state
    
    app_state = get_app_state()
    return start_training_job(app_state, steps)


@router.get("/admin/training/status")
async def get_training_status(payload: dict = Depends(verify_admin_token)):
    """Get training status (admin only)."""
    from ..route import get_app_state
    
    app_state = get_app_state()
    jobs = refresh_job_state(app_state)
    
    return {
        "is_training": app_state.is_training,
        "daemon_running": app_state.daemon_running,
        "job": jobs["training"],
    }


@router.post("/admin/training/stop")
async def stop_training(payload: dict = Depends(verify_admin_token)):
    """Request training stop (admin only)."""
    from ..route import get_app_state
    
    app_state = get_app_state()
    return stop_training_job(app_state)


@router.get("/settings")
async def get_settings():
    """Get public settings (no auth required)."""
    from ..route import get_app_state
    
    app_state = get_app_state()
    
    return {
        "model_switch_enabled": app_state.model_switch_enabled
    }


@router.post("/admin/settings/model-switch")
async def toggle_model_switch(payload: dict = Depends(verify_admin_token), enabled: bool = False):
    """Toggle model switch visibility in app (admin only)."""
    from ..route import get_app_state
    
    app_state = get_app_state()
    app_state.model_switch_enabled = enabled
    
    return {
        "success": True,
        "model_switch_enabled": app_state.model_switch_enabled,
        "message": f"Model switch {'enabled' if enabled else 'disabled'}"
    }
