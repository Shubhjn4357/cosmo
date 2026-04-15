#!/usr/bin/env python
"""
Small end-to-end smoke test for the local Cosmo AI server.

Usage:
    python scripts/smoke_api.py --base-url http://127.0.0.1:7860
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any
from uuid import uuid4

import requests


def require(condition: bool, message: str):
    if not condition:
        raise RuntimeError(message)


def print_step(message: str):
    print(f"[smoke] {message}")


def read_json(response: requests.Response) -> dict[str, Any]:
    try:
        return response.json()
    except Exception as exc:  # pragma: no cover - smoke helper only
        raise RuntimeError(f"Expected JSON from {response.request.method} {response.url}: {exc}") from exc


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.getenv("COSMO_BASE_URL", "http://127.0.0.1:7860"))
    parser.add_argument("--admin-username", default=os.getenv("ADMIN_USERNAME", ""))
    parser.add_argument("--admin-password", default=os.getenv("ADMIN_PASSWORD", ""))
    parser.add_argument("--skip-chat", action="store_true")
    parser.add_argument("--skip-image", action="store_true")
    args = parser.parse_args()

    session = requests.Session()

    print_step(f"Checking health on {args.base_url}")
    health = session.get(f"{args.base_url}/api/health", timeout=60)
    require(health.status_code == 200, f"Health failed: {health.status_code}")

    print_step("Checking runtime status")
    runtime_status_response = session.get(f"{args.base_url}/api/admin/runtime-status", timeout=60)
    require(runtime_status_response.status_code == 200, f"Runtime status failed: {runtime_status_response.status_code}")
    runtime_status = read_json(runtime_status_response)
    require("runtime" in runtime_status, "Runtime payload missing runtime field")

    print_step("Checking collection configuration")
    collect_config_response = session.get(f"{args.base_url}/api/collect/config", timeout=60)
    require(collect_config_response.status_code == 200, f"Collection config failed: {collect_config_response.status_code}")
    collect_config = read_json(collect_config_response)
    require("backend" in collect_config, "Collection config missing backend")

    print_step("Checking public UI entrypoints")
    for path in ("/chat", "/admin-ui"):
        response = session.get(f"{args.base_url}{path}", timeout=60)
        require(response.status_code == 200, f"{path} failed: {response.status_code}")

    if args.admin_username and args.admin_password:
        print_step("Logging in as admin")
        login_response = session.post(
            f"{args.base_url}/api/auth/signin",
            json={"username": args.admin_username, "password": args.admin_password},
            timeout=60,
        )
        require(login_response.status_code == 200, f"Admin login failed: {login_response.status_code}")
        login_payload = read_json(login_response)
        token = login_payload.get("session", {}).get("access_token")
        require(token, "Admin login did not return an access token")
        admin_headers = {"Authorization": f"Bearer {token}"}

        print_step("Checking protected runtime profiles")
        profiles_response = session.get(
            f"{args.base_url}/api/admin/runtime-profiles",
            headers=admin_headers,
            timeout=60,
        )
        require(profiles_response.status_code == 200, f"Runtime profiles failed: {profiles_response.status_code}")
        profiles_payload = read_json(profiles_response)
        require(profiles_payload.get("profiles"), "Runtime profiles payload is empty")

        gguf_profile = next(
            (profile for profile in profiles_payload["profiles"] if profile.get("id") == "gguf-coder"),
            None,
        )
        require(gguf_profile is not None, "GGUF profile is missing from runtime profiles")
        require("status_message" in gguf_profile, "GGUF profile diagnostics are missing")

        print_step("Checking selected runtime validation")
        runtime_validate_response = session.post(
            f"{args.base_url}/api/admin/runtime/validate",
            headers=admin_headers,
            json={"profile_id": "gguf-coder", "test_load": False, "refresh_imports": True},
            timeout=120,
        )
        require(
            runtime_validate_response.status_code == 200,
            f"Runtime validation failed: {runtime_validate_response.status_code}",
        )
        runtime_validate_payload = read_json(runtime_validate_response)
        require(
            runtime_validate_payload.get("validation", {}).get("profile_id") == "gguf-coder",
            "Runtime validation payload did not include the requested profile",
        )
        require(
            "summary" in runtime_validate_payload.get("validation", {}),
            "Runtime validation payload missing summary",
        )

        print_step("Checking deployment readiness report")
        readiness_response = session.get(
            f"{args.base_url}/api/admin/readiness",
            headers=admin_headers,
            timeout=120,
        )
        require(readiness_response.status_code == 200, f"Readiness failed: {readiness_response.status_code}")
        readiness_payload = read_json(readiness_response)
        require("summary" in readiness_payload, "Readiness payload missing summary")
        require("blockers" in readiness_payload, "Readiness payload missing blockers")

        print_step("Checking database validation")
        database_validate_response = session.post(
            f"{args.base_url}/api/admin/database/validate",
            headers=admin_headers,
            timeout=120,
        )
        require(
            database_validate_response.status_code == 200,
            f"Database validation failed: {database_validate_response.status_code}",
        )
        database_validate_payload = read_json(database_validate_response)
        require("reachable" in database_validate_payload, "Database validation missing reachable field")
        require("mode" in database_validate_payload, "Database validation missing mode")

        print_step("Checking payment gateway validation")
        payment_validate_response = session.post(
            f"{args.base_url}/api/admin/payments/validate",
            headers=admin_headers,
            timeout=120,
        )
        require(
            payment_validate_response.status_code == 200,
            f"Payment validation failed: {payment_validate_response.status_code}",
        )
        payment_validate_payload = read_json(payment_validate_response)
        require("configured" in payment_validate_payload, "Payment validation missing configured field")
        require("provider" in payment_validate_payload, "Payment validation missing provider")

        print_step("Checking protected datasets")
        datasets_response = session.get(
            f"{args.base_url}/api/datasets",
            headers=admin_headers,
            timeout=60,
        )
        require(datasets_response.status_code == 200, f"Datasets failed: {datasets_response.status_code}")

        print_step("Checking HF dataset sync status")
        hf_status_response = session.get(
            f"{args.base_url}/api/learn/hf-status",
            headers=admin_headers,
            timeout=60,
        )
        require(hf_status_response.status_code == 200, f"HF sync status failed: {hf_status_response.status_code}")
        hf_status_payload = read_json(hf_status_response)
        require("configured" in hf_status_payload, "HF sync status missing configured field")

        print_step("Checking research document browser")
        research_documents_response = session.get(
            f"{args.base_url}/api/research/documents?limit=1",
            headers=admin_headers,
            timeout=60,
        )
        require(
            research_documents_response.status_code == 200,
            f"Research documents failed: {research_documents_response.status_code}",
        )
        research_documents_payload = read_json(research_documents_response)
        require("documents" in research_documents_payload, "Research documents payload missing documents field")

        print_step("Checking Cloudflare provider validation")
        cloudflare_validate_response = session.post(
            f"{args.base_url}/api/research/cloudflare/validate",
            headers=admin_headers,
            timeout=120,
        )
        require(
            cloudflare_validate_response.status_code == 200,
            f"Cloudflare validation failed: {cloudflare_validate_response.status_code}",
        )
        cloudflare_validate_payload = read_json(cloudflare_validate_response)
        require("reachable" in cloudflare_validate_payload, "Cloudflare validation missing reachable field")
    else:
        print_step("Skipping admin-only checks because admin credentials were not provided")

    if not args.skip_chat:
        print_step("Checking local chat generation")
        chat_session_id = f"smoke-chat-{uuid4().hex}"
        chat_response = session.post(
            f"{args.base_url}/api/chat",
            json={
                "message": "Reply with a short confirmation that the runtime is online.",
                "session_id": chat_session_id,
                "max_tokens": 48,
                "temperature": 0.0,
                "is_local": True,
            },
            timeout=300,
        )
        require(chat_response.status_code == 200, f"Chat failed: {chat_response.status_code}")
        chat_payload = read_json(chat_response)
        require(chat_payload.get("response"), "Chat returned an empty response")
        require(chat_payload.get("backend"), "Chat payload missing backend")

    if not args.skip_image:
        print_step("Checking image model catalog")
        image_models_response = session.get(f"{args.base_url}/api/image/models", timeout=60)
        require(image_models_response.status_code == 200, f"Image model catalog failed: {image_models_response.status_code}")
        image_models_payload = read_json(image_models_response)
        models = image_models_payload.get("models") or []
        require(models, "Image model catalog is empty")
        model_id = image_models_payload.get("current_model") or models[0]["id"]

        print_step("Checking image generation")
        image_session_id = f"smoke-image-{uuid4().hex}"
        image_response = session.post(
            f"{args.base_url}/api/image/generate",
            json={
                "prompt": "minimal monochrome geometric logo",
                "model_id": model_id,
                "width": 512,
                "height": 512,
                "is_local": False,
                "session_id": image_session_id,
            },
            timeout=300,
        )
        require(image_response.status_code == 200, f"Image generation failed: {image_response.status_code}")
        image_payload = read_json(image_response)
        require(image_payload.get("image_url"), "Image generation returned no image_url")

    print_step("Checking vision feed stats")
    vision_stats_response = session.get(f"{args.base_url}/api/feed/vision/stats", timeout=60)
    require(vision_stats_response.status_code == 200, f"Vision stats failed: {vision_stats_response.status_code}")
    vision_stats = read_json(vision_stats_response)
    require("storage" in vision_stats, "Vision stats payload missing storage")

    print_step("Seeding local vision memory")
    collect_response = session.post(
        f"{args.base_url}/api/collect/collect",
        json={
            "source_type": "images",
            "count": 1,
            "auto_feed": True,
        },
        timeout=120,
    )
    require(collect_response.status_code == 200, f"Vision collection failed: {collect_response.status_code}")
    collect_payload = read_json(collect_response)
    require(collect_payload.get("success") is True, "Vision collection returned success=false")

    print_step("Checking retrieval-based vision generation")
    vision_response = session.post(
        f"{args.base_url}/api/feed/vision/generate",
        params={
            "prompt": "space image",
            "use_pretrained": "false",
            "use_trained_model": "false",
        },
        json={},
        timeout=120,
    )
    require(vision_response.status_code == 200, f"Vision retrieval failed: {vision_response.status_code}")
    vision_payload = read_json(vision_response)
    require(vision_payload.get("method"), "Vision payload missing method")
    require(vision_payload["method"] in {"retrieval", "trained_model"}, "Unexpected vision method")

    print_step("Smoke checks passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[smoke] FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
