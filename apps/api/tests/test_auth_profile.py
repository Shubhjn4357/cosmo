from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import requests


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _make_google_test_token(
    *,
    email: str = "google-user@example.com",
    subject: str = "google-subject-123",
    audience: str = "test-google-client-id",
    name: str = "Google User",
) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": "https://accounts.google.com",
        "aud": audience,
        "sub": subject,
        "email": email,
        "email_verified": True,
        "name": name,
        "picture": "https://example.com/avatar.png",
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    }
    header_b64 = _b64url(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    message = f"{header_b64}.{payload_b64}"
    signature = hmac.new(b"test-google-secret", message.encode(), hashlib.sha256).digest()
    return f"{message}.{_b64url(signature)}"


def test_local_signup_signin_and_profile_roundtrip(server):
    signup = requests.post(
        f"{server.base_url}/api/auth/signup",
        json={
            "email": "user@example.com",
            "password": "pass12345",
            "display_name": "Example User",
        },
        timeout=60,
    )
    assert signup.status_code == 200
    signup_payload = signup.json()
    assert signup_payload["success"] is True
    user_id = signup_payload["session"]["user"]["id"]

    profile = requests.get(f"{server.base_url}/api/profile/{user_id}", timeout=60)
    assert profile.status_code == 200
    profile_payload = profile.json()
    assert profile_payload["success"] is True
    assert profile_payload["profile"]["email"] == "user@example.com"
    assert profile_payload["profile"]["display_name"] == "Example User"
    assert "password_hash" not in profile_payload["profile"]

    signin = requests.post(
        f"{server.base_url}/api/auth/signin",
        json={"email": "user@example.com", "password": "pass12345"},
        timeout=60,
    )
    assert signin.status_code == 200
    signin_payload = signin.json()
    assert signin_payload["success"] is True

    verify = requests.get(
        f"{server.base_url}/api/auth/verify",
        headers={"Authorization": f"Bearer {signin_payload['session']['access_token']}"},
        timeout=60,
    )
    assert verify.status_code == 200
    verify_payload = verify.json()
    assert verify_payload["valid"] is True
    assert verify_payload["user_id"] == user_id


def test_google_signin_creates_local_profile(server):
    id_token = _make_google_test_token()

    signin = requests.post(
        f"{server.base_url}/api/auth/google",
        json={"id_token": id_token},
        timeout=60,
    )
    assert signin.status_code == 200
    signin_payload = signin.json()
    assert signin_payload["success"] is True
    user_id = signin_payload["session"]["user"]["id"]
    assert user_id == "google_google-subject-123"

    verify = requests.get(
        f"{server.base_url}/api/auth/verify",
        headers={"Authorization": f"Bearer {signin_payload['session']['access_token']}"},
        timeout=60,
    )
    assert verify.status_code == 200
    verify_payload = verify.json()
    assert verify_payload["valid"] is True
    assert verify_payload["user_id"] == user_id

    profile = requests.get(f"{server.base_url}/api/profile/{user_id}", timeout=60)
    assert profile.status_code == 200
    profile_payload = profile.json()
    assert profile_payload["success"] is True
    assert profile_payload["profile"]["email"] == "google-user@example.com"
    assert profile_payload["profile"]["display_name"] == "Google User"
    assert profile_payload["profile"]["avatar_url"] == "https://example.com/avatar.png"


def test_profile_preferences_and_history_roundtrip(server):
    signup = requests.post(
        f"{server.base_url}/api/auth/signup",
        json={
            "email": "prefs@example.com",
            "password": "pass12345",
            "display_name": "Prefs User",
        },
        timeout=60,
    )
    assert signup.status_code == 200
    user_id = signup.json()["session"]["user"]["id"]

    update_profile = requests.put(
        f"{server.base_url}/api/profile/{user_id}",
        json={
            "display_name": "Updated User",
            "theme": "amber",
            "notifications_enabled": False,
        },
        timeout=60,
    )
    assert update_profile.status_code == 200
    assert update_profile.json()["success"] is True

    update_nsfw = requests.put(
        f"{server.base_url}/api/profile/{user_id}/preferences/nsfw",
        json={"nsfw_enabled": True},
        timeout=60,
    )
    assert update_nsfw.status_code == 200

    update_model = requests.put(
        f"{server.base_url}/api/profile/{user_id}/preferences/hf-model",
        json={"hf_model_preference": "Qwen/Qwen2.5-Coder-0.5B-Instruct"},
        timeout=60,
    )
    assert update_model.status_code == 200

    update_key = requests.put(
        f"{server.base_url}/api/profile/{user_id}/preferences/hf-api-key",
        json={"hf_api_key": "hf_test_token"},
        timeout=60,
    )
    assert update_key.status_code == 200

    prefs = requests.get(f"{server.base_url}/api/profile/{user_id}/preferences", timeout=60)
    assert prefs.status_code == 200
    prefs_payload = prefs.json()
    assert prefs_payload["success"] is True
    assert prefs_payload["preferences"]["nsfw_enabled"] is True
    assert prefs_payload["preferences"]["hf_model_preference"] == "Qwen/Qwen2.5-Coder-0.5B-Instruct"
    assert prefs_payload["preferences"]["hf_api_key_set"] is True

    create_chat = requests.post(
        f"{server.base_url}/api/history",
        json={
            "user_id": user_id,
            "title": "First Chat",
            "messages": [{"role": "user", "content": "hello"}],
        },
        timeout=60,
    )
    assert create_chat.status_code == 200
    chat_id = create_chat.json()["id"]
    assert chat_id

    update_chat = requests.put(
        f"{server.base_url}/api/history/{chat_id}",
        json={"messages": [{"role": "assistant", "content": "hi"}]},
        timeout=60,
    )
    assert update_chat.status_code == 200

    histories = requests.get(f"{server.base_url}/api/history/{user_id}", timeout=60)
    assert histories.status_code == 200
    history_payload = histories.json()
    assert history_payload["success"] is True
    assert len(history_payload["histories"]) == 1
    assert history_payload["histories"][0]["messages"][0]["content"] == "hi"


def test_admin_user_listing_redacts_sensitive_fields(server, admin_headers):
    signup = requests.post(
        f"{server.base_url}/api/auth/signup",
        json={
            "email": "redact@example.com",
            "password": "pass12345",
            "display_name": "Redact User",
        },
        timeout=60,
    )
    assert signup.status_code == 200

    users = requests.get(f"{server.base_url}/api/admin/users", headers=admin_headers, timeout=60)
    assert users.status_code == 200
    payload = users.json()
    assert payload["success"] is True
    found = next(user for user in payload["users"] if user["email"] == "redact@example.com")
    assert "password_hash" not in found
