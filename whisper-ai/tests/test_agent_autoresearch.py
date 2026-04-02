from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import requests


def test_agent_profiles_endpoint(server, admin_headers):
    response = requests.get(f"{server.base_url}/api/agent/profiles", headers=admin_headers, timeout=60)
    response.raise_for_status()
    payload = response.json()
    profile_ids = {item["id"] for item in payload["profiles"]}
    assert "autonomous-researcher" in profile_ids
    assert "database-optimizer" in profile_ids


def test_autoresearch_project_run(server, admin_headers):
    repo_root = Path(__file__).resolve().parents[1]
    temp_dir = repo_root / ".tmp-autoresearch-tests" / uuid.uuid4().hex
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        (temp_dir / "candidate.py").write_text("VALUE = 1\n", encoding="utf-8")
        (temp_dir / "metric.py").write_text("print('val_bpb=1.23')\n", encoding="utf-8")

        create_response = requests.post(
            f"{server.base_url}/api/autoresearch/projects",
            headers=admin_headers,
            json={
                "name": "Test autoresearch project",
                "objective": "Verify the Karpathy-style experiment loop persists metrics.",
                "workspace_path": temp_dir.relative_to(repo_root).as_posix(),
                "editable_paths": ["candidate.py"],
                "experiment_command": "python metric.py",
                "metric_pattern": r"val_bpb=([0-9.]+)",
                "metric_goal": "min",
                "agent_profile_id": "autonomous-researcher",
                "backend": "server",
            },
            timeout=60,
        )
        create_response.raise_for_status()
        project = create_response.json()["project"]
        assert project["status"] == "idle"

        run_response = requests.post(
            f"{server.base_url}/api/autoresearch/projects/{project['id']}/run",
            headers=admin_headers,
            json={"wait_for_completion": True},
            timeout=120,
        )
        run_response.raise_for_status()
        run_payload = run_response.json()
        assert run_payload["project"]["status"] == "idle"
        assert run_payload["runs"]

        details_response = requests.get(
            f"{server.base_url}/api/autoresearch/projects/{project['id']}",
            headers=admin_headers,
            timeout=60,
        )
        details_response.raise_for_status()
        details = details_response.json()
        latest_run = details["runs"][0]
        assert latest_run["status"] == "completed"
        assert latest_run["metric_value"] == 1.23
        assert latest_run["accepted"] is True
        assert details["project"]["best_metric"] == 1.23
        assert details["project"]["task_running"] is False
    finally:
        shutil.rmtree(temp_dir.parent, ignore_errors=True)
