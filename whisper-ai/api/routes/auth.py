"""
Whisper AI - Authentication Routes.
Hybrid authentication: Admin (JWT) + Users (Turso-backed local auth)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from loguru import logger
from pydantic import BaseModel

from .profile import get_supabase
from services.google_auth import google_auth_status


router = APIRouter()

LEGACY_ADMIN_USERNAME = "shubhjain"
LEGACY_ADMIN_PASSWORD_HASH = hashlib.sha256("@Jainshubh261998".encode()).hexdigest()
ALLOW_LEGACY_ADMIN = os.environ.get("ALLOW_LEGACY_ADMIN", "false").lower() == "true"

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME") or os.environ.get("ADMIN_EMAIL", "")
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
if not ADMIN_PASSWORD_HASH and ADMIN_PASSWORD:
    ADMIN_PASSWORD_HASH = hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest()
if not ADMIN_PASSWORD_HASH and ALLOW_LEGACY_ADMIN:
    ADMIN_USERNAME = ADMIN_USERNAME or LEGACY_ADMIN_USERNAME
    ADMIN_PASSWORD_HASH = LEGACY_ADMIN_PASSWORD_HASH

JWT_SECRET = os.environ.get("JWT_SECRET", "whisper-ai-secret-key-change-in-production")
JWT_EXPIRY = 86400 * 7


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
    signature = hmac.new(JWT_SECRET.encode(), message.encode(), hashlib.sha256).digest()
    signature_b64 = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{header_b64}.{payload_b64}.{signature_b64}"


def verify_jwt(token: str) -> Optional[dict]:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header_b64, payload_b64, signature_b64 = parts
        message = f"{header_b64}.{payload_b64}"
        expected_sig = hmac.new(JWT_SECRET.encode(), message.encode(), hashlib.sha256).digest()
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
    if not ADMIN_USERNAME or not ADMIN_PASSWORD_HASH:
        return False

    admin_aliases = {ADMIN_USERNAME.lower()}
    admin_email = os.environ.get("ADMIN_EMAIL")
    if admin_email:
        admin_aliases.add(admin_email.lower())

    password_hash = hashlib.sha256(password.encode()).hexdigest()
    return username_or_email.lower() in admin_aliases and password_hash == ADMIN_PASSWORD_HASH


@router.get("/auth/admin-status")
async def admin_status():
    return {
        "admin_configured": bool(ADMIN_USERNAME and ADMIN_PASSWORD_HASH),
        "legacy_admin_enabled": ALLOW_LEGACY_ADMIN,
        "google_auth": google_auth_status(),
    }


@router.post("/auth/signup")
async def signup(request: SignUpRequest):
    """User signup using the Turso-backed auth store."""
    try:
        result = get_supabase().auth.sign_up(
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
        return {
            "success": True,
            "session": {
                "access_token": token,
                "refresh_token": token,
                "user": {"email": username_or_email, "is_admin": True},
            },
            "error": None,
        }

    try:
        result = get_supabase().auth.sign_in_with_password(
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
            return {
                "success": True,
                "session": {
                    "access_token": token,
                    "refresh_token": token,
                    "user": {"id": result.user.id, "email": username_or_email},
                },
                "user": result.user.model_dump(),
                "error": None,
            }
        return {"success": False, "error": "Invalid username or password"}
    except Exception as exc:
        error_msg = str(exc)
        logger.warning(f"User login failed: {error_msg}")
        if "Invalid login credentials" in error_msg:
            error_msg = "Invalid username or password"
        return {"success": False, "error": error_msg}


@router.post("/auth/google")
async def google_signin(request: GoogleAuthRequest):
    """Google sign-in using verified ID tokens and Turso-backed local profiles."""
    try:
        result = get_supabase().auth.sign_in_with_id_token({"provider": "google", "token": request.id_token})
        if result.user and result.session:
            token = create_jwt(
                username=result.user.email or result.user.id,
                user_id=result.user.id,
                is_admin=False,
            )
            return {
                "success": True,
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
        token = get_supabase().auth.reset_password_for_email(request.email)
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
        get_supabase().auth.sign_out()
        return {"success": True, "message": "Signed out"}
    except Exception:
        return {"success": True, "message": "Signed out"}


@router.post("/auth/logout")
async def logout():
    return {"success": True, "message": "Logged out"}
