"""
Persistent admin-managed state for model toggles.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from utils.app_paths import DATA_ROOT, ensure_app_dirs

ensure_app_dirs()

ADMIN_MODEL_STATE_PATH = DATA_ROOT / "admin_model_state.json"


def _default_payload() -> dict[str, Any]:
    return {
        "enabled": {},
        "image": {
            "current_model": None,
        },
    }


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
    try:
        from utils.persistence import backup_file

        backup_file(str(path))
    except Exception:
        pass


def _load_payload() -> dict[str, Any]:
    payload = _load_json(ADMIN_MODEL_STATE_PATH, _default_payload())
    enabled = payload.get("enabled")
    image = payload.get("image")
    if not isinstance(enabled, dict):
        enabled = {}
    if not isinstance(image, dict):
        image = {}
    current_model = image.get("current_model")
    return {
        "enabled": {str(key): bool(value) for key, value in enabled.items()},
        "image": {
            "current_model": str(current_model).strip() if isinstance(current_model, str) and current_model.strip() else None,
        },
    }


def _save_payload(payload: dict[str, Any]) -> None:
    _save_json(ADMIN_MODEL_STATE_PATH, payload)


def get_model_state() -> dict[str, bool]:
    return dict(_load_payload()["enabled"])


def get_model_enabled(model_id: str, default: bool = True) -> bool:
    return get_model_state().get(model_id, default)


def set_model_enabled(model_id: str, enabled: bool) -> dict[str, bool]:
    payload = _load_payload()
    payload["enabled"][model_id] = enabled
    _save_payload(payload)
    return dict(payload["enabled"])


def get_selected_image_model(default: str | None = None) -> str | None:
    payload = _load_payload()
    return payload["image"].get("current_model") or default


def set_selected_image_model(model_id: str | None) -> str | None:
    payload = _load_payload()
    payload["image"]["current_model"] = str(model_id).strip() if model_id else None
    _save_payload(payload)
    return payload["image"]["current_model"]
