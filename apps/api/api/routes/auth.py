"""
Cosmo AI - Authentication Routes.
Hybrid authentication: Admin (JWT) + Users (Turso-backed local auth)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from typing import Optional

from dotenv import dotenv_values
from fastapi import APIRouter, Depends, Header, HTTPException
from loguru import logger
from pydantic import BaseModel

from .profile import get_db_client
from services.google_auth import google_auth_status


router = APIRouter()

LEGACY_ADMIN_USERNAME = "shubhjain"
LEGACY_ADMIN_PASSWORD_HASH = hashlib.sha256("@Jainshubh261998".encode()).hexdigest()
APP_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = APP_ROOT / ".env"
JWT_EXPIRY = 86400 * 7


def _load_runtime_env() -> dict[str, str]:
    keys = (
        "ALLOW_LEGACY_ADMIN",
        "ADMIN_USERNAME",
        "ADMIN_EMAIL",
        "ADMIN_PASSWORD",
        "ADMIN_PASSWORD_HASH",
        "JWT_SECRET",
    )
    values: dict[str, str] = {}
    for key in keys:
        current = os.environ.get(key)
        if current is not None:
            values[key] = current

    prefer_process_env = os.getenv("COSMO_TEST_MODE", "false").lower() == "true"

    # Prefer the checked-in `.env` file when present so local credential edits
    # take effect without needing to restart the server process.
    if ENV_FILE.exists():
        file_values = dotenv_values(ENV_FILE)
        for key in keys:
            current = file_values.get(key)
            if current not in (None, ""):
                # ONLY update if the key wasn't already set in the process environment (os.environ)
                # or if the current value is empty, respecting the standard priority.
                if key not in values or values[key] in (None, ""):
                    values[key] = str(current)

    return values


def _env_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _admin_auth_config() -> dict:
    runtime_env = _load_runtime_env()
    admin_username = (runtime_env.get("ADMIN_USERNAME") or "").strip()
    admin_email = (runtime_env.get("ADMIN_EMAIL") or "").strip()
    allow_legacy_admin = _env_bool(runtime_env.get("ALLOW_LEGACY_ADMIN"), False)

    password_hashes: set[str] = set()
    configured_hash = (runtime_env.get("ADMIN_PASSWORD_HASH") or "").strip().lower()
    if configured_hash:
        password_hashes.add(configured_hash)

    configured_password = runtime_env.get("ADMIN_PASSWORD") or ""
    if configured_password:
        password_hashes.add(hashlib.sha256(configured_password.encode()).hexdigest())

    if allow_legacy_admin:
        admin_username = admin_username or LEGACY_ADMIN_USERNAME
        password_hashes.add(LEGACY_ADMIN_PASSWORD_HASH)

    admin_aliases = {
        alias.strip().lower()
        for alias in (admin_username, admin_email)
        if alias and alias.strip()
    }

    return {
        "admin_username": admin_username,
        "admin_email": admin_email,
        "aliases": admin_aliases,
        "password_hashes": password_hashes,
        "allow_legacy_admin": allow_legacy_admin,
        "configured": bool(admin_aliases and password_hashes),
    }


def _jwt_secret() -> str:
    runtime_env = _load_runtime_env()
    return runtime_env.get("JWT_SECRET", "cosmo-ai-secret-key-change-in-production")


class LoginRequest(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    password: str


class SignUpRequest(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = None


class GoogleAuthRequest(BaseModel):
    id_token: str


class PasswordResetRequest(BaseModel):
    email: str


class LoginResponse(BaseModel):
    success: bool
    token: Optional[str] = None
    user: Optional[dict] = None
    message: str


def _login_success_response(*, token: str, user: dict, is_admin: bool, profile: Optional[dict] = None) -> dict:
    payload = {
        "success": True,
        "token": token,
        "access_token": token,
        "message": "Login successful",
        "session": {
            "access_token": token,
            "refresh_token": token,
            "user": user,
            "expires_in": 86400 * 7,
            "token_type": "Bearer",
        },
        "user": user,
        "is_admin": is_admin,
        "error": None,
    }
    if profile is not None:
        payload["profile"] = profile
    return payload


def _login_error_response(message: str) -> dict:
    return {
        "success": False,
        "token": None,
        "message": message,
        "error": message,
    }


def create_jwt(username: str, user_id: Optional[str] = None, is_admin: bool = False) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": username,
        "user_id": user_id,
        "is_admin": is_admin,
        "iat": int(time.time()),
        "exp": int(time.time()) + JWT_EXPIRY,
    }
    header_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    message = f"{header_b64}.{payload_b64}"
    signature = hmac.new(_jwt_secret().encode(), message.encode(), hashlib.sha256).digest()
    signature_b64 = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{header_b64}.{payload_b64}.{signature_b64}"


def verify_jwt(token: str) -> Optional[dict]:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header_b64, payload_b64, signature_b64 = parts
        message = f"{header_b64}.{payload_b64}"
        expected_sig = hmac.new(_jwt_secret().encode(), message.encode(), hashlib.sha256).digest()
        expected_sig_b64 = base64.urlsafe_b64encode(expected_sig).decode().rstrip("=")
        if not hmac.compare_digest(signature_b64, expected_sig_b64):
            return None
        payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


async def verify_token_payload(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization token")
    token = authorization.replace("Bearer ", "")
    payload = verify_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


async def verify_admin_token(authorization: Optional[str] = Header(None)) -> dict:
    payload = await verify_token_payload(authorization)
    if not payload.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


def _is_admin_login(username_or_email: str, password: str) -> bool:
    if not username_or_email or not password:
        return False
    config = _admin_auth_config()
    if not config["configured"]:
        return False

    password_hash = hashlib.sha256(password.encode()).hexdigest()
    return username_or_email.strip().lower() in config["aliases"] and password_hash in config["password_hashes"]


@router.get("/auth/admin-status")
async def admin_status():
    config = _admin_auth_config()
    return {
        "admin_configured": config["configured"],
        "legacy_admin_enabled": config["allow_legacy_admin"],
        "admin_aliases": sorted(config["aliases"]),
        "google_auth": google_auth_status(),
    }


@router.post("/auth/signup")
async def signup(request: SignUpRequest):
    """User signup using the Turso-backed auth store."""
    try:
        result = get_db_client().auth.sign_up(
            {
                "email": request.email,
                "password": request.password,
                "options": {"data": {"display_name": request.display_name or request.email.split("@")[0]}},
            }
        )
        if not result.user:
            return {"success": False, "error": "Signup failed - user not created"}

        token = create_jwt(username=request.email, user_id=result.user.id, is_admin=False)
        return {
            "success": True,
            "token": token,
            "access_token": token,
            "session": {
                "access_token": token,
                "refresh_token": token,
                "user": {"id": result.user.id, "email": request.email},
            }
            if result.session
            else None,
            "user": result.user.model_dump(),
            "error": None,
        }
    except Exception as exc:
        logger.warning(f"Signup failed: {exc}")
        return {"success": False, "error": str(exc)}


@router.post("/auth/signin")
async def signin(request: LoginRequest):
    """Hybrid login: admin or Turso-backed local user."""
    username_or_email = request.username or request.email or ""
    if _is_admin_login(username_or_email, request.password):
        token = create_jwt(username_or_email, is_admin=True)
        return _login_success_response(
            token=token,
            user={"email": username_or_email, "is_admin": True},
            is_admin=True,
        )

    try:
        result = get_db_client().auth.sign_in_with_password(
            {
                "email": username_or_email,
                "password": request.password,
            }
        )
        if result.user and result.session:
            token = create_jwt(
                username=username_or_email,
                user_id=result.user.id,
                is_admin=False,
            )
            return _login_success_response(
                token=token,
                user={"id": result.user.id, "email": username_or_email},
                is_admin=False,
                profile=result.user.model_dump(),
            )
        return _login_error_response("Invalid username or password")
    except Exception as exc:
        error_msg = str(exc)
        logger.warning(f"User login failed: {error_msg}")
        if "Invalid login credentials" in error_msg:
            error_msg = "Invalid username or password"
        elif "Missing database migration file" in error_msg:
            error_msg = "Local user database is not available"
        return _login_error_response(error_msg)


@router.post("/auth/login")
async def login(request: LoginRequest):
    """Compatibility alias for older mobile/admin clients."""
    return await signin(request)


@router.post("/auth/admin-login")
async def admin_login(request: LoginRequest):
    """Compatibility alias for admin UI."""
    return await signin(request)


@router.post("/auth/google")
async def google_signin(request: GoogleAuthRequest):
    """Google sign-in using verified ID tokens and Turso-backed local profiles."""
    try:
        result = get_db_client().auth.sign_in_with_id_token({"provider": "google", "token": request.id_token})
        if result.user and result.session:
            token = create_jwt(
                username=result.user.email or result.user.id,
                user_id=result.user.id,
                is_admin=False,
            )
            return {
                "success": True,
                "token": token,
                "access_token": token,
                "session": {
                    "access_token": token,
                    "refresh_token": token,
                    "user": {"id": result.user.id, "email": result.user.email},
                },
            }
        return {"success": False, "error": "Google sign-in failed"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


@router.post("/auth/reset-password")
async def reset_password(request: PasswordResetRequest):
    """Generate a local password-reset token."""
    try:
        token = get_db_client().auth.reset_password_for_email(request.email)
        if token:
            return {
                "success": True,
                "message": "Password reset token generated. Email delivery is not configured on this backend.",
            }
        return {"success": True, "message": "If the account exists, a reset token was generated."}
    except Exception as exc:
        return {"success": False, "message": f"Failed to process password reset: {exc}"}


@router.get("/auth/verify")
async def verify_token(payload: dict = Depends(verify_token_payload)):
    return {
        "valid": True,
        "username": payload.get("sub"),
        "user_id": payload.get("user_id"),
        "is_admin": payload.get("is_admin", False),
        "expires": payload.get("exp"),
    }


@router.post("/auth/signout")
async def signout():
    try:
        get_db_client().auth.sign_out()
        return {"success": True, "message": "Signed out"}
    except Exception:
        return {"success": True, "message": "Signed out"}


@router.post("/auth/logout")
async def logout():
    return {"success": True, "message": "Logged out"}
