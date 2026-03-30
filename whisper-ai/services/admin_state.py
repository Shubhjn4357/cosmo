"""
Persistent admin-managed state for model toggles and payment plans.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from utils.app_paths import DATA_ROOT, ensure_app_dirs

ensure_app_dirs()

ADMIN_MODEL_STATE_PATH = DATA_ROOT / "admin_model_state.json"
ADMIN_PLAN_STATE_PATH = DATA_ROOT / "admin_subscription_plans.json"


def _load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return dict(default)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return dict(default)


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def get_model_state() -> dict[str, bool]:
    payload = _load_json(ADMIN_MODEL_STATE_PATH, {"enabled": {}})
    enabled = payload.get("enabled", {})
    if not isinstance(enabled, dict):
        return {}
    return {str(key): bool(value) for key, value in enabled.items()}


def get_model_enabled(model_id: str, default: bool = True) -> bool:
    return get_model_state().get(model_id, default)


def set_model_enabled(model_id: str, enabled: bool) -> dict[str, bool]:
    state = get_model_state()
    state[model_id] = enabled
    _save_json(ADMIN_MODEL_STATE_PATH, {"enabled": state})
    return state


def get_payment_plans(default_plans: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    payload = _load_json(ADMIN_PLAN_STATE_PATH, {"plans": {}})
    stored = payload.get("plans", {})
    plans = {plan_id: dict(plan) for plan_id, plan in default_plans.items()}

    if isinstance(stored, dict):
        for plan_id, plan in stored.items():
            if isinstance(plan, dict):
                plans[plan_id] = {**plans.get(plan_id, {}), **plan}

    return plans


def upsert_payment_plan(plan_id: str, plan: dict[str, Any], default_plans: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    plans = get_payment_plans(default_plans)
    plans[plan_id] = {**plans.get(plan_id, {}), **plan}
    _save_json(ADMIN_PLAN_STATE_PATH, {"plans": plans})
    return plans
