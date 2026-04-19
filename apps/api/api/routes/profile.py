"""
Cosmo AI - Profile API Routes
User profile management with Turso-backed persistence.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.turso_db import TursoClient, get_turso_client


router = APIRouter()
_db_client: Optional[TursoClient] = None


def get_db_client() -> TursoClient:
    """Return the shared Turso-backed database client."""
    global _db_client
    if _db_client is None:
        try:
            _db_client = get_turso_client()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Database initialization failed: {exc}") from exc
    return _db_client


def get_supabase() -> TursoClient:
    """Deprecated compatibility alias for the old client name."""
    return get_db_client()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sanitize_profile(profile: dict) -> dict:
    sanitized = dict(profile)
    sanitized.pop("password_hash", None)
    if sanitized.get("hf_api_key"):
        sanitized["hf_api_key_set"] = True
        sanitized["hf_api_key"] = "***REDACTED***"
    return sanitized


class ProfileCreate(BaseModel):
    user_id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    terms_accepted: bool = False
    consent_given: bool = False
    data_collection_consent: bool = False


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    theme: Optional[str] = None
    notifications_enabled: Optional[bool] = None
    nsfw_enabled: Optional[bool] = None
    hf_model_preference: Optional[str] = None


class TokenUseRequest(BaseModel):
    amount: int = 0


@router.post("/profile")
async def create_profile(data: ProfileCreate):
    """Create a new user profile."""
    try:
        now = _utc_now()
        client = get_db_client()
        existing = client.table("profiles").select("*").eq("id", data.user_id).execute()
        if existing.data:
            return {"success": True, "profile": existing.data[0]}

        profile_data = {
            "id": data.user_id,
            "email": data.email,
            "display_name": data.display_name or (data.email.split("@")[0] if data.email else "User"),
            "consent_given": data.consent_given,
            "data_collection_consent": data.data_collection_consent,
            "is_admin": False,
            "created_at": now,
            "updated_at": now,
            "last_active": now,
        }
        if data.consent_given:
            profile_data["consent_given_at"] = now
        if data.terms_accepted:
            profile_data["terms_accepted_at"] = now

        result = client.table("profiles").insert(profile_data).execute()  # type: ignore
        profile = result.data[0] if result.data else profile_data
        return {"success": True, "profile": _sanitize_profile(profile)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/profile/{user_id}")
async def get_profile(user_id: str):
    """Get user profile."""
    try:
        result = get_db_client().table("profiles").select("*").eq("id", user_id).execute()
        if not result.data:
            return {"success": False, "error": "Profile not found"}
        return {"success": True, "profile": _sanitize_profile(result.data[0])}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/profile/{user_id}")
async def update_profile(user_id: str, updates: ProfileUpdate):
    """Update user profile."""
    try:
        update_data = {key: value for key, value in updates.dict().items() if value is not None}
        update_data["updated_at"] = _utc_now()
        get_db_client().table("profiles").update(update_data).eq("id", user_id).execute()
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/profile/{user_id}/consent")
async def accept_consent(user_id: str, data_collection: bool):
    """Accept user consent."""
    try:
        get_db_client().table("profiles").update(
            {
                "consent_given": True,
                "consent_given_at": _utc_now(),
                "data_collection_consent": data_collection,
                "terms_accepted_at": _utc_now(),
                "updated_at": _utc_now(),
            }
        ).eq("id", user_id).execute()
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/profile/{user_id}/tokens/use")
async def use_tokens(user_id: str, request: TokenUseRequest):
    """Compatibility endpoint kept as a no-op for the simplified free app."""
    return {"success": True, "remaining": 0, "used": max(0, request.amount)}


class ChatHistoryRequest(BaseModel):
    user_id: str
    title: str
    messages: list


class ChatHistoryUpdate(BaseModel):
    title: Optional[str] = None
    messages: Optional[list] = None


@router.get("/history/{user_id}")
async def get_chat_histories(user_id: str):
    """Get all chat histories for a user."""
    try:
        result = (
            get_db_client()
            .table("chat_history")
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        return {"success": True, "histories": result.data}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/history")
async def create_chat(data: ChatHistoryRequest):
    """Create new chat history."""
    try:
        result = (
            get_db_client()
            .table("chat_history")
            .insert({"user_id": data.user_id, "title": data.title, "messages": data.messages})
            .select("id")
            .execute()
        )
        return {"success": True, "id": result.data[0]["id"] if result.data else None}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/history/{chat_id}")
async def update_chat(chat_id: str, data: ChatHistoryUpdate):
    """Update chat history."""
    try:
        update_data = {}
        if data.title is not None:
            update_data["title"] = data.title
        if data.messages is not None:
            update_data["messages"] = data.messages  # type: ignore
        update_data["updated_at"] = _utc_now()
        get_db_client().table("chat_history").update(update_data).eq("id", chat_id).execute()  # type: ignore
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/history/{chat_id}")
async def delete_chat(chat_id: str):
    """Delete chat history."""
    try:
        get_db_client().table("chat_history").delete().eq("id", chat_id).execute()
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class NsfwPreferenceRequest(BaseModel):
    nsfw_enabled: bool


class HfModelPreferenceRequest(BaseModel):
    hf_model_preference: str


class HfApiKeyRequest(BaseModel):
    hf_api_key: str


@router.put("/profile/{user_id}/preferences/nsfw")
async def update_nsfw_preference(user_id: str, data: NsfwPreferenceRequest):
    """Update the user's NSFW content preference."""
    try:
        get_db_client().table("profiles").update(
            {
                "nsfw_enabled": data.nsfw_enabled,
                "updated_at": _utc_now(),
            }
        ).eq("id", user_id).execute()
        return {"success": True, "nsfw_enabled": data.nsfw_enabled}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/profile/{user_id}/preferences/hf-model")
async def update_hf_model(user_id: str, data: HfModelPreferenceRequest):
    """Update the user's Hugging Face model preference."""
    try:
        get_db_client().table("profiles").update(
            {
                "hf_model_preference": data.hf_model_preference,
                "updated_at": _utc_now(),
            }
        ).eq("id", user_id).execute()
        return {"success": True, "hf_model_preference": data.hf_model_preference}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/profile/{user_id}/preferences/hf-api-key")
async def update_hf_api_key(user_id: str, data: HfApiKeyRequest):
    """Update the user's Hugging Face API key."""
    try:
        from utils.encryption import encrypt_api_key

        encrypted_key = encrypt_api_key(data.hf_api_key)
        get_db_client().table("profiles").update(
            {
                "hf_api_key": encrypted_key,
                "updated_at": _utc_now(),
            }
        ).eq("id", user_id).execute()
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/profile/{user_id}/preferences/hf-api-key")
async def delete_hf_api_key(user_id: str):
    """Delete the user's Hugging Face API key."""
    try:
        get_db_client().table("profiles").update(
            {
                "hf_api_key": None,
                "updated_at": _utc_now(),
            }
        ).eq("id", user_id).execute()
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/profile/{user_id}/preferences")
async def get_preferences(user_id: str):
    """Get all user preferences."""
    try:
        result = (
            get_db_client()
            .table("profiles")
            .select("nsfw_enabled, hf_model_preference, hf_api_key, theme, notifications_enabled")
            .eq("id", user_id)
            .execute()
        )
        if not result.data:
            return {"success": False, "error": "Profile not found"}

        preferences = result.data[0]
        if preferences.get("hf_api_key"):
            preferences["hf_api_key_set"] = True
            preferences["hf_api_key"] = "***REDACTED***"
        else:
            preferences["hf_api_key_set"] = False
        return {"success": True, "preferences": preferences}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
