from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import pytest
import requests


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@dataclass
class TestServer:
    process: subprocess.Popen
    base_url: str
    data_root: Path
    output_dir: Path
    admin_username: str
    admin_password: str

    def login(self) -> dict[str, str]:
        response = requests.post(
            f"{self.base_url}/api/auth/signin",
            json={"username": self.admin_username, "password": self.admin_password},
            timeout=60,
        )
        response.raise_for_status()
        token = response.json()["session"]["access_token"]
        return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def server(tmp_path_factory: pytest.TempPathFactory) -> TestServer:
    repo_root = Path(__file__).resolve().parents[1]
    temp_root = tmp_path_factory.mktemp("cosmo-test")
    output_dir = temp_root / "logs"
    output_dir.mkdir(parents=True, exist_ok=True)
    data_root = temp_root / "data"
    uploads_dir = data_root / "uploads"
    models_dir = data_root / "models"
    runtime_config = data_root / "runtime" / "runtime_config.json"
    port = _free_port()

    env = os.environ.copy()
    env.update(
        {
            "COSMO_TEST_MODE": "true",
            "COSMO_DATA_ROOT": str(data_root),
            "COSMO_UPLOADS_DIR": str(uploads_dir),
            "COSMO_MODELS_DIR": str(models_dir),
            "COSMO_RUNTIME_CONFIG": str(runtime_config),
            "LOCAL_CHAT_BACKEND": "stub",
            "ADMIN_USERNAME": "admin",
            "ADMIN_PASSWORD": "testpass123",
            "JWT_SECRET": "test-secret",
            "GOOGLE_CLIENT_ID": "test-google-client-id",
            "GOOGLE_TEST_ID_TOKEN_SECRET": "test-google-secret",
            "RAZORPAY_KEY_ID": "test_razorpay_key_id",
            "RAZORPAY_KEY_SECRET": "test_razorpay_key_secret",
            "PYTHONIOENCODING": "utf-8",
            "HOST": "127.0.0.1",
            "PORT": str(port),
        }
    )

    stdout_path = output_dir / "server.out.log"
    stderr_path = output_dir / "server.err.log"
    stdout_handle = stdout_path.open("w", encoding="utf-8")
    stderr_handle = stderr_path.open("w", encoding="utf-8")

    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "api.route:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=repo_root,
        env=env,
        stdout=stdout_handle,
        stderr=stderr_handle,
    )

    base_url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 90
    last_error = None
    while time.time() < deadline:
        if process.poll() is not None:
            break
        try:
            response = requests.get(f"{base_url}/api/health", timeout=5)
            if response.status_code == 200:
                last_error = None
                break
        except Exception as exc:  # pragma: no cover - startup polling
            last_error = exc
        time.sleep(1)
    else:
        last_error = TimeoutError("server did not start in time")

    if process.poll() is not None or last_error:
        stdout_handle.close()
        stderr_handle.close()
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=20)
        stdout = stdout_path.read_text(encoding="utf-8", errors="ignore")
        stderr = stderr_path.read_text(encoding="utf-8", errors="ignore")
        raise RuntimeError(
            f"Test server failed to start: {last_error}\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}"
        )

    yield TestServer(
        process=process,
        base_url=base_url,
        data_root=data_root,
        output_dir=output_dir,
        admin_username=env["ADMIN_USERNAME"],
        admin_password=env["ADMIN_PASSWORD"],
    )

    process.terminate()
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=20)
    stdout_handle.close()
    stderr_handle.close()


@pytest.fixture
def admin_headers(server: TestServer) -> dict[str, str]:
    return server.login()


@pytest.fixture(autouse=True)
def reset_stub_runtime(server: TestServer, admin_headers: dict[str, str]):
    for path in (
        server.data_root / "admin_model_state.json",
        server.data_root / "admin_subscription_plans.json",
        server.data_root / "research" / "history.jsonl",
        server.data_root / "research" / "cloudflare_quota.json",
        server.data_root / "research" / "source_policy.json",
        server.data_root / "crawled_documents.jsonl",
    ):
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    shutil.rmtree(server.data_root / "models", ignore_errors=True)

    response = requests.post(
        f"{server.base_url}/api/admin/runtime/custom",
        headers=admin_headers,
        json={
            "backend": "stub",
            "model_id": "stub-model",
            "gguf_model_path": "",
            "airllm_model_id": "",
            "airllm_model_path": "",
            "max_context_tokens": 2048,
            "max_new_tokens": 128,
            "device": "cpu",
            "allow_remote_code": False,
            "n_threads": 1,
        },
        timeout=60,
    )
    response.raise_for_status()
    unload = requests.post(f"{server.base_url}/api/admin/runtime/unload", headers=admin_headers, timeout=60)
    unload.raise_for_status()
    requests.post(f"{server.base_url}/api/admin/system/training/stop", headers=admin_headers, timeout=60)
    requests.post(f"{server.base_url}/api/admin/generator/stop", headers=admin_headers, timeout=60)
    yield
    requests.post(f"{server.base_url}/api/admin/system/training/stop", headers=admin_headers, timeout=60)
    requests.post(f"{server.base_url}/api/admin/generator/stop", headers=admin_headers, timeout=60)
    for path in (
        server.data_root / "admin_model_state.json",
        server.data_root / "admin_subscription_plans.json",
        server.data_root / "research" / "history.jsonl",
        server.data_root / "research" / "cloudflare_quota.json",
        server.data_root / "research" / "source_policy.json",
        server.data_root / "crawled_documents.jsonl",
    ):
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    shutil.rmtree(server.data_root / "models", ignore_errors=True)
