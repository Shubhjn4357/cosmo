from __future__ import annotations

from pathlib import Path

import requests


def test_health_and_runtime_status(server):
    health = requests.get(f"{server.base_url}/api/health", timeout=60)
    assert health.status_code == 200
    health_payload = health.json()
    assert health_payload["status"] == "ok"

    runtime_status = requests.get(f"{server.base_url}/api/admin/runtime-status", timeout=60)
    assert runtime_status.status_code == 200
    runtime_payload = runtime_status.json()
    assert runtime_payload["runtime"]["configured_backend"] == "stub"
    assert runtime_payload["runtime"]["readiness"]["can_load"] is True


def test_admin_auth_and_runtime_profiles(server, admin_headers):
    verify = requests.get(f"{server.base_url}/api/auth/verify", headers=admin_headers, timeout=60)
    assert verify.status_code == 200
    assert verify.json()["is_admin"] is True

    profiles = requests.get(f"{server.base_url}/api/admin/runtime-profiles", headers=admin_headers, timeout=60)
    assert profiles.status_code == 200
    payload = profiles.json()
    profile_ids = {profile["id"] for profile in payload["profiles"]}
    assert {"fast-coder", "balanced-coder", "gguf-coder", "heavy-airllm"} <= profile_ids

    hf_status = requests.get(f"{server.base_url}/api/learn/hf-status", headers=admin_headers, timeout=60)
    assert hf_status.status_code == 200
    hf_payload = hf_status.json()
    assert isinstance(hf_payload["configured"], bool)
    assert hf_payload["available"] is True


def test_admin_readiness_reports_remaining_external_blockers(server, admin_headers):
    readiness = requests.get(f"{server.base_url}/api/admin/readiness", headers=admin_headers, timeout=60)
    assert readiness.status_code == 200
    payload = readiness.json()
    assert payload["summary"]["overall"] in {"ready", "degraded", "blocked"}
    assert "sections" in payload
    assert "blockers" in payload
    assert payload["sections"]["google_auth"]["configured"] is True
    assert payload["sections"]["cloudflare"]["configured"] is False
    assert payload["sections"]["payments"]["configured"] is True
    blocker_ids = {item["id"] for item in payload["blockers"]}
    assert "cloudflare_credentials" in blocker_ids
    assert "airllm_snapshot" in blocker_ids
    assert "payments" not in blocker_ids
    assert "payments_invalid" not in blocker_ids


def test_admin_control_center_aggregates_ai_operations(server, admin_headers):
    response = requests.get(f"{server.base_url}/api/admin/control-center", headers=admin_headers, timeout=60)
    assert response.status_code == 200
    payload = response.json()
    assert "runtime" in payload
    assert "runtime_profiles" in payload
    assert "readiness" in payload
    assert "self_learner" in payload
    assert "jobs" in payload
    assert "logs" in payload
    assert "datasets" in payload
    assert "ai_modes" in payload
    assert payload["system"]["logs_dir"]
    assert isinstance(payload["ai_modes"], list)
    assert {"training", "generator"} <= set(payload["logs"].keys())


def test_admin_database_validation_reports_local_sqlite_fallback(server, admin_headers):
    validation = requests.post(f"{server.base_url}/api/admin/database/validate", headers=admin_headers, timeout=60)
    assert validation.status_code == 200
    payload = validation.json()
    assert payload["mode"] == "local-sqlite"
    assert payload["remote_configured"] is False
    assert payload["reachable"] is True
    assert payload["schema_ready"] is True
    assert "profiles" in payload["tables_sample"]
    assert payload["profiles_count"] >= 0


def test_admin_payment_validation_reports_configured_gateway(server, admin_headers):
    validation = requests.post(f"{server.base_url}/api/admin/payments/validate", headers=admin_headers, timeout=60)
    assert validation.status_code == 200
    payload = validation.json()
    assert payload["configured"] is True
    assert payload["provider"] == "razorpay"
    assert payload["reachable"] is True
    assert payload["last_valid"] is True
    assert payload["validated_endpoint"] == "/orders?count=1"


def test_runtime_profile_validation_is_cached_without_mutating_live_runtime(server, admin_headers):
    validation_response = requests.post(
        f"{server.base_url}/api/admin/runtime/validate",
        headers=admin_headers,
        json={"profile_id": "gguf-coder", "test_load": False, "refresh_imports": True},
        timeout=60,
    )
    assert validation_response.status_code == 200
    payload = validation_response.json()
    assert payload["status"] == "validated"
    assert payload["profile_id"] == "gguf-coder"
    assert payload["current_runtime_unchanged"] is True
    assert payload["runtime"]["configured_backend"] == "stub"
    assert payload["validation"]["profile_id"] == "gguf-coder"
    assert payload["validation"]["test_load"]["attempted"] is False
    assert payload["validation"]["preflight"]["backend"] == "llama_cpp"

    profiles = requests.get(f"{server.base_url}/api/admin/runtime-profiles", headers=admin_headers, timeout=60)
    assert profiles.status_code == 200
    gguf_profile = next(profile for profile in profiles.json()["profiles"] if profile["id"] == "gguf-coder")
    assert gguf_profile["validation"]["profile_id"] == "gguf-coder"
    assert gguf_profile["validation"]["summary"]


def test_gguf_runtime_diagnostics_are_explicit(server, admin_headers):
    select = requests.post(
        f"{server.base_url}/api/admin/runtime-profiles/select",
        headers=admin_headers,
        json={"profile_id": "gguf-coder", "eager_load": False},
        timeout=60,
    )
    assert select.status_code == 200

    reload_runtime = requests.post(
        f"{server.base_url}/api/admin/runtime/reload",
        headers=admin_headers,
        timeout=60,
    )
    assert reload_runtime.status_code == 200
    runtime = reload_runtime.json()["runtime"]
    assert runtime["loaded"] is False
    assert runtime["configured_backend"] == "llama_cpp"
    assert "llama-cpp-python is not installed" in runtime["last_error"] or "GGUF file not found" in runtime["last_error"]


def test_auto_runtime_prefers_local_gguf_when_artifact_is_ready(server, admin_headers):
    gguf_dir = server.data_root / "models" / "llm" / "gguf-coder"
    gguf_dir.mkdir(parents=True, exist_ok=True)
    gguf_path = gguf_dir / "qwen2.5-1.5b-instruct-q4_k_m.gguf"
    gguf_path.write_bytes(b"fake-gguf")

    llama_bin_dir = server.data_root / "models" / "llama-bin"
    llama_bin_dir.mkdir(parents=True, exist_ok=True)
    cli_path = llama_bin_dir / "llama-completion.exe"
    cli_path.write_bytes(b"fake-cli")

    configure = requests.post(
        f"{server.base_url}/api/admin/runtime/custom",
        headers=admin_headers,
        json={
            "backend": "auto",
            "model_id": "Qwen/Qwen2.5-Coder-0.5B-Instruct",
            "gguf_model_path": "",
            "airllm_model_id": "",
            "airllm_model_path": "",
            "max_context_tokens": 4096,
            "max_new_tokens": 128,
            "device": "cpu",
            "allow_remote_code": False,
            "n_threads": 1,
        },
        timeout=60,
    )
    assert configure.status_code == 200

    runtime_status = requests.get(f"{server.base_url}/api/admin/runtime-status", timeout=60)
    assert runtime_status.status_code == 200
    readiness = runtime_status.json()["runtime"]["readiness"]
    assert readiness["configured_backend"] == "auto"
    assert readiness["resolved_backend"] == "llama_cpp"
    assert readiness["resolved_profile"] == "gguf-coder"
    assert readiness["can_load"] is True

    reload_runtime = requests.post(
        f"{server.base_url}/api/admin/runtime/reload",
        headers=admin_headers,
        timeout=60,
    )
    assert reload_runtime.status_code == 200
    runtime = reload_runtime.json()["runtime"]
    assert runtime["loaded"] is True
    assert runtime["configured_backend"] == "auto"
    assert runtime["resolved_backend"] == "llama_cpp"
    assert runtime["active_backend"] == "llama_cpp_cli"
    assert runtime["resolved_profile"] == "gguf-coder"
    assert Path(runtime["resolved_config"]["gguf_model_path"]) == gguf_path


def test_runtime_profile_validation_can_load_prepared_gguf_runtime(server, admin_headers):
    gguf_dir = server.data_root / "models" / "llm" / "gguf-coder"
    gguf_dir.mkdir(parents=True, exist_ok=True)
    gguf_path = gguf_dir / "qwen2.5-1.5b-instruct-q4_k_m.gguf"
    gguf_path.write_bytes(b"fake-gguf")

    llama_bin_dir = server.data_root / "models" / "llama-bin"
    llama_bin_dir.mkdir(parents=True, exist_ok=True)
    cli_path = llama_bin_dir / "llama-completion.exe"
    cli_path.write_bytes(b"fake-cli")

    validation_response = requests.post(
        f"{server.base_url}/api/admin/runtime/validate",
        headers=admin_headers,
        json={"profile_id": "gguf-coder", "test_load": True, "refresh_imports": True},
        timeout=60,
    )
    assert validation_response.status_code == 200
    payload = validation_response.json()
    assert payload["current_runtime_unchanged"] is True
    assert payload["runtime"]["configured_backend"] == "stub"
    assert payload["validation"]["ok"] is True
    assert payload["validation"]["preflight"]["can_load"] is True
    assert payload["validation"]["test_load"]["attempted"] is True
    assert payload["validation"]["test_load"]["loaded"] is True
    assert payload["validation"]["test_load"]["active_backend"] == "llama_cpp_cli"
    assert Path(payload["validation"]["preflight"]["artifact_path"]) == gguf_path
    assert Path(payload["validation"]["preflight"]["llama_cli_path"]).name == cli_path.name


def test_training_job_lifecycle_is_real(server, admin_headers):
    start = requests.post(
        f"{server.base_url}/api/admin/system/training/start",
        headers=admin_headers,
        params={"steps": 2},
        timeout=60,
    )
    assert start.status_code == 200
    start_payload = start.json()
    assert start_payload["success"] is True
    assert start_payload["pid"]

    runtime_status = requests.get(f"{server.base_url}/api/admin/runtime-status", timeout=60)
    assert runtime_status.status_code == 200
    jobs = runtime_status.json()["jobs"]
    assert jobs["training"]["running"] is True
    assert jobs["training"]["pid"] == start_payload["pid"]

    status = requests.get(f"{server.base_url}/api/admin/training/status", headers=admin_headers, timeout=60)
    assert status.status_code == 200
    status_payload = status.json()
    assert status_payload["is_training"] is True
    assert status_payload["job"]["running"] is True

    stop = requests.post(f"{server.base_url}/api/admin/system/training/stop", headers=admin_headers, timeout=60)
    assert stop.status_code == 200
    assert stop.json()["success"] is True

    status_after = requests.get(f"{server.base_url}/api/admin/training/status", headers=admin_headers, timeout=60)
    assert status_after.status_code == 200
    assert status_after.json()["is_training"] is False


def test_generator_job_lifecycle_is_real(server, admin_headers):
    start = requests.post(f"{server.base_url}/api/admin/generator/start", headers=admin_headers, timeout=60)
    assert start.status_code == 200
    start_payload = start.json()
    assert start_payload["success"] is True
    assert start_payload["pid"]

    runtime_status = requests.get(f"{server.base_url}/api/admin/runtime-status", timeout=60)
    assert runtime_status.status_code == 200
    jobs = runtime_status.json()["jobs"]
    assert jobs["generator"]["running"] is True
    assert jobs["generator"]["pid"] == start_payload["pid"]

    stop = requests.post(f"{server.base_url}/api/admin/generator/stop", headers=admin_headers, timeout=60)
    assert stop.status_code == 200
    assert stop.json()["success"] is True

    runtime_after = requests.get(f"{server.base_url}/api/admin/runtime-status", timeout=60)
    assert runtime_after.status_code == 200
    assert runtime_after.json()["jobs"]["generator"]["running"] is False


def test_admin_model_toggles_affect_public_behavior(server, admin_headers):
    models = requests.get(f"{server.base_url}/api/admin/models", headers=admin_headers, timeout=60)
    assert models.status_code == 200
    model_ids = {model["id"] for model in models.json()["models"]}
    assert "runtime.fast-coder" in model_ids
    assert "image.dreamshaper-8" in model_ids
    assert "smart.local" in model_ids

    disable_image = requests.post(
        f"{server.base_url}/api/admin/models/image.dreamshaper-8/toggle",
        headers=admin_headers,
        params={"enabled": "false"},
        timeout=60,
    )
    assert disable_image.status_code == 200
    assert disable_image.json()["enabled"] is False

    image_models = requests.get(f"{server.base_url}/api/image/models", timeout=60)
    assert image_models.status_code == 200
    image_ids = {model["id"] for model in image_models.json()["models"]}
    assert "dreamshaper-8" not in image_ids

    disabled_image = requests.post(
        f"{server.base_url}/api/image/generate",
        json={
            "prompt": "disabled model test",
            "model_id": "dreamshaper-8",
            "session_id": "pytest-disabled-image",
            "is_local": False,
        },
        timeout=60,
    )
    assert disabled_image.status_code == 400
    assert "disabled by admin" in disabled_image.text

    disable_smart = requests.post(
        f"{server.base_url}/api/admin/models/smart.local/toggle",
        headers=admin_headers,
        params={"enabled": "false"},
        timeout=60,
    )
    assert disable_smart.status_code == 200

    smart_status = requests.get(f"{server.base_url}/api/chat/smart/status", timeout=60)
    assert smart_status.status_code == 200
    assert smart_status.json()["models"]["local"] is False

    disable_runtime = requests.post(
        f"{server.base_url}/api/admin/models/runtime.fast-coder/toggle",
        headers=admin_headers,
        params={"enabled": "false"},
        timeout=60,
    )
    assert disable_runtime.status_code == 200

    select_disabled_runtime = requests.post(
        f"{server.base_url}/api/admin/runtime-profiles/select",
        headers=admin_headers,
        json={"profile_id": "fast-coder", "eager_load": False},
        timeout=60,
    )
    assert select_disabled_runtime.status_code == 400


def test_admin_subscription_plans_update_payment_catalog(server, admin_headers):
    create_plan = requests.post(
        f"{server.base_url}/api/admin/subscriptions/create",
        headers=admin_headers,
        json={
            "plan_id": "qa_plan",
            "name": "QA Plan",
            "price": 12.5,
            "currency": "INR",
            "features": ["Private testing"],
            "tokens": 250,
            "plan_type": "addon",
            "active": True,
        },
        timeout=60,
    )
    assert create_plan.status_code == 200
    assert create_plan.json()["plan_id"] == "qa_plan"

    payment_plans = requests.get(f"{server.base_url}/api/payments/plans", timeout=60)
    assert payment_plans.status_code == 200
    plans_payload = payment_plans.json()["plans"]
    assert "qa_plan" in plans_payload
    assert plans_payload["qa_plan"]["amount"] == 1250
    assert plans_payload["qa_plan"]["tokens"] == 250

    update_plan = requests.post(
        f"{server.base_url}/api/admin/subscriptions/qa_plan/update",
        headers=admin_headers,
        json={
            "name": "QA Plan Revised",
            "price": 15.0,
            "currency": "INR",
            "features": ["Private testing", "Priority fixes"],
            "tokens": 300,
            "plan_type": "addon",
            "active": False,
        },
        timeout=60,
    )
    assert update_plan.status_code == 200

    payment_plans_after = requests.get(f"{server.base_url}/api/payments/plans", timeout=60)
    assert payment_plans_after.status_code == 200
    updated_plan = payment_plans_after.json()["plans"]["qa_plan"]
    assert updated_plan["name"] == "QA Plan Revised"
    assert updated_plan["amount"] == 1500
    assert updated_plan["tokens"] == 300
    assert updated_plan["active"] is False


def test_admin_analytics_tracks_real_requests(server, admin_headers):
    chat = requests.post(
        f"{server.base_url}/api/chat",
        json={
            "message": "analytics probe",
            "session_id": "pytest-analytics-chat",
            "is_local": True,
            "max_tokens": 32,
            "temperature": 0.0,
        },
        timeout=60,
    )
    assert chat.status_code == 200

    image = requests.post(
        f"{server.base_url}/api/image/generate",
        json={
            "prompt": "analytics image probe",
            "model_id": "flux-schnell",
            "session_id": "pytest-analytics-image",
            "is_local": False,
            "width": 256,
            "height": 256,
        },
        timeout=60,
    )
    assert image.status_code == 200

    analytics = requests.get(f"{server.base_url}/api/admin/analytics", headers=admin_headers, timeout=60)
    assert analytics.status_code == 200
    payload = analytics.json()
    totals = payload["request_totals"]

    assert totals["chat_requests"] >= 1
    assert totals["image_requests"] >= 1
    assert totals["today"]["chat_requests"] >= 1
    assert totals["today"]["image_requests"] >= 1
    assert payload["dau"]["data"][-1] >= 1
    assert payload["daily_requests"]["data"][-1] >= 2
