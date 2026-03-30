"""
Whisper AI - Analytics Routes
Server metrics, response tracking, and system analytics.
"""
import hashlib
import json
import time
from datetime import date, timedelta
from threading import Lock
from typing import Dict, Any, List

import psutil
from dataclasses import dataclass, field
from fastapi import APIRouter, Depends
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
