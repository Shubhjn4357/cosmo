from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

from google.auth.transport import requests as google_requests  # type: ignore
from google.oauth2 import id_token as google_id_token  # type: ignore


GOOGLE_DEFAULT_CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs"
GOOGLE_ALLOWED_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64url_decode(data: str) -> bytes:
    data += "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(data)


def _test_mode_enabled() -> bool:
    return os.getenv("COSMO_TEST_MODE", "false").lower() == "true"


def google_client_ids() -> list[str]:
    values: list[str] = []
    primary = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if primary:
        values.append(primary)
    extra = os.getenv("GOOGLE_CLIENT_IDS", "").strip()
    if extra:
        values.extend([item.strip() for item in extra.split(",") if item.strip()])
    deduped: list[str] = []
    seen = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


def google_auth_configured() -> bool:
    return bool(google_client_ids())


def google_auth_status() -> dict[str, Any]:
    client_ids = google_client_ids()
    return {
        "configured": bool(client_ids),
        "client_ids": client_ids,
        "certs_url": os.getenv("GOOGLE_OAUTH_CERTS_URL", GOOGLE_DEFAULT_CERTS_URL),
        "test_secret_configured": bool(os.getenv("GOOGLE_TEST_ID_TOKEN_SECRET")),
    }


def _validate_common_claims(claims: dict[str, Any], *, audience: str | None = None) -> dict[str, Any]:
    issuer = str(claims.get("iss") or "")
    if issuer not in GOOGLE_ALLOWED_ISSUERS:
        raise ValueError("Invalid Google issuer")

    audiences = google_client_ids()
    if audience:
        audiences = [audience]
    if not audiences:
        raise ValueError("Google sign-in is not configured")

    token_aud = claims.get("aud")
    if token_aud not in audiences:
        raise ValueError("Google token audience mismatch")

    exp = int(claims.get("exp") or 0)
    if exp <= int(time.time()):
        raise ValueError("Google token has expired")

    email = str(claims.get("email") or "").strip().lower()
    if not email:
        raise ValueError("Google token is missing email")
    if claims.get("email_verified") is False:
        raise ValueError("Google email is not verified")

    claims["email"] = email
    return claims


def _verify_test_id_token(token: str) -> dict[str, Any]:
    secret = os.getenv("GOOGLE_TEST_ID_TOKEN_SECRET", "").encode()
    if not secret:
        raise ValueError("Google test token secret is not configured")

    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed Google test token")

    header_b64, payload_b64, signature_b64 = parts
    message = f"{header_b64}.{payload_b64}"
    expected_sig = hmac.new(secret, message.encode(), hashlib.sha256).digest()
    expected_sig_b64 = _b64url_encode(expected_sig)
    if not hmac.compare_digest(signature_b64, expected_sig_b64):
        raise ValueError("Invalid Google test token signature")

    header = json.loads(_b64url_decode(header_b64))
    if header.get("alg") != "HS256":
        raise ValueError("Unsupported Google test token algorithm")

    claims = json.loads(_b64url_decode(payload_b64))
    return _validate_common_claims(claims)


def verify_google_id_token(token: str) -> dict[str, Any]:
    token = (token or "").strip()
    if not token:
        raise ValueError("Google ID token is required")

    if _test_mode_enabled() and os.getenv("GOOGLE_TEST_ID_TOKEN_SECRET"):
        return _verify_test_id_token(token)

    if not google_auth_configured():
        raise ValueError("Google sign-in is not configured")

    certs_url = os.getenv("GOOGLE_OAUTH_CERTS_URL", GOOGLE_DEFAULT_CERTS_URL)
    claims = google_id_token.verify_token(
        token,
        google_requests.Request(),
        audience=None,
        certs_url=certs_url,
    )
    return _validate_common_claims(dict(claims))
