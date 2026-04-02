from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from loguru import logger

from services.agent_profiles import DEFAULT_AGENT_PROFILE_ID, get_agent_profile
from services.agent_runtime import (
    SUPPORTED_AGENT_BACKENDS,
    AgentRunRequestPayload,
    WORKSPACE_ROOT,
    run_agent,
)
from services.turso_db import get_turso_client


PROJECT_TABLE = "autoresearch_projects"
RUN_TABLE = "autoresearch_runs"
RUN_TIMEOUT_SECONDS = int(os.getenv("WHISPER_AUTORESEARCH_COMMAND_TIMEOUT_SECONDS", "600"))

_RUNNING_PROJECT_TASKS: dict[str, asyncio.Task] = {}
_RUNNING_PROJECT_LOCK = asyncio.Lock()


def _workspace_relative(path: Path) -> str:
    return path.resolve().relative_to(WORKSPACE_ROOT).as_posix()


def _resolve_workspace_path(raw_path: str) -> Path:
    candidate = Path(str(raw_path or "").strip())
    if not str(candidate):
        raise ValueError("path is required")
    resolved = candidate.resolve() if candidate.is_absolute() else (WORKSPACE_ROOT / candidate).resolve()
    workspace_root_text = str(WORKSPACE_ROOT)
    resolved_text = str(resolved)
    if resolved_text != workspace_root_text and not resolved_text.startswith(f"{workspace_root_text}{os.sep}"):
        raise ValueError(f"Path '{resolved}' is outside the workspace root")
    return resolved


def _resolve_project_root(workspace_path: str) -> Path:
    root = _resolve_workspace_path(workspace_path)
    if not root.exists():
        raise FileNotFoundError(str(root))
    if not root.is_dir():
        raise NotADirectoryError(str(root))
    return root


def _resolve_editable_path(project_root: Path, raw_path: str) -> Path:
    candidate = Path(str(raw_path or "").strip())
    if not str(candidate):
        raise ValueError("editable path is required")
    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        resolved = (project_root / candidate).resolve()
    workspace_root_text = str(WORKSPACE_ROOT)
    resolved_text = str(resolved)
    if resolved_text != workspace_root_text and not resolved_text.startswith(f"{workspace_root_text}{os.sep}"):
        raise ValueError(f"Editable path '{resolved}' is outside the workspace root")
    return resolved


def _normalize_project(row: dict[str, Any]) -> dict[str, Any]:
    editable_paths = row.get("editable_paths") or []
    if isinstance(editable_paths, str):
        try:
            editable_paths = json.loads(editable_paths)
        except Exception:
            editable_paths = [editable_paths]
    row = dict(row)
    row["editable_paths"] = [str(path) for path in editable_paths]
    row["task_running"] = _is_project_running(str(row.get("id") or ""))
    return row


def _normalize_run(row: dict[str, Any]) -> dict[str, Any]:
    changed_paths = row.get("changed_paths") or []
    if isinstance(changed_paths, str):
        try:
            changed_paths = json.loads(changed_paths)
        except Exception:
            changed_paths = [changed_paths]
    row = dict(row)
    row["changed_paths"] = [str(path) for path in changed_paths]
    row["accepted"] = bool(row.get("accepted"))
    return row


def _is_project_running(project_id: str) -> bool:
    task = _RUNNING_PROJECT_TASKS.get(project_id)
    return task is not None and not task.done()


def list_autoresearch_projects(limit: int = 20) -> list[dict[str, Any]]:
    client = get_turso_client()
    rows = (
        client.table(PROJECT_TABLE)
        .select("*")
        .order("updated_at", desc=True)
        .range(0, max(0, limit - 1))
        .execute()
        .data
    )
    return [_normalize_project(row) for row in rows]


def get_autoresearch_project(project_id: str) -> Optional[dict[str, Any]]:
    client = get_turso_client()
    rows = client.table(PROJECT_TABLE).select("*").eq("id", project_id).execute().data
    if not rows:
        return None
    return _normalize_project(rows[0])


def list_autoresearch_runs(project_id: str, limit: int = 20) -> list[dict[str, Any]]:
    client = get_turso_client()
    rows = (
        client.table(RUN_TABLE)
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .range(0, max(0, limit - 1))
        .execute()
        .data
    )
    return [_normalize_run(row) for row in rows]


def create_autoresearch_project(payload: dict[str, Any]) -> dict[str, Any]:
    client = get_turso_client()

    name = str(payload.get("name") or "").strip()
    objective = str(payload.get("objective") or "").strip()
    workspace_path = str(payload.get("workspace_path") or "").strip()
    experiment_command = str(payload.get("experiment_command") or "").strip()
    metric_pattern = str(payload.get("metric_pattern") or "").strip()
    editable_paths = list(payload.get("editable_paths") or [])
    metric_goal = str(payload.get("metric_goal") or "min").strip().lower() or "min"
    backend = str(payload.get("backend") or "server").strip().lower() or "server"
    agent_profile_id = str(payload.get("agent_profile_id") or DEFAULT_AGENT_PROFILE_ID).strip() or DEFAULT_AGENT_PROFILE_ID

    if not name:
        raise ValueError("name is required")
    if not objective:
        raise ValueError("objective is required")
    if not workspace_path:
        raise ValueError("workspace_path is required")
    if not experiment_command:
        raise ValueError("experiment_command is required")
    if not metric_pattern:
        raise ValueError("metric_pattern is required")
    if not editable_paths:
        raise ValueError("editable_paths is required")
    if metric_goal not in {"min", "max"}:
        raise ValueError("metric_goal must be 'min' or 'max'")
    if backend not in SUPPORTED_AGENT_BACKENDS:
        raise ValueError(f"backend must be one of: {sorted(SUPPORTED_AGENT_BACKENDS)}")
    if get_agent_profile(agent_profile_id) is None:
        raise ValueError(f"Unknown agent_profile_id '{agent_profile_id}'")

    project_root = _resolve_project_root(workspace_path)
    normalized_editable_paths = [
        _workspace_relative(_resolve_editable_path(project_root, raw_path))
        for raw_path in editable_paths
    ]

    project_id = uuid.uuid4().hex
    row = {
        "id": project_id,
        "name": name,
        "objective": objective,
        "workspace_path": _workspace_relative(project_root),
        "editable_paths": normalized_editable_paths,
        "setup_command": str(payload.get("setup_command") or "").strip() or None,
        "experiment_command": experiment_command,
        "metric_pattern": metric_pattern,
        "metric_goal": metric_goal,
        "backend": backend,
        "agent_profile_id": agent_profile_id,
        "max_steps": max(2, min(int(payload.get("max_steps") or 6), 8)),
        "max_tokens": max(128, min(int(payload.get("max_tokens") or 384), 768)),
        "baseline_metric": payload.get("baseline_metric"),
        "best_metric": payload.get("baseline_metric"),
        "status": "idle",
        "notes": str(payload.get("notes") or "").strip() or None,
    }
    client.table(PROJECT_TABLE).insert(row).execute()
    return get_autoresearch_project(project_id) or _normalize_project(row)


def _update_project(project_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    client = get_turso_client()
    client.table(PROJECT_TABLE).update(updates).eq("id", project_id).execute()
    project = get_autoresearch_project(project_id)
    if project is None:
        raise KeyError(project_id)
    return project


def _insert_run(row: dict[str, Any]) -> dict[str, Any]:
    client = get_turso_client()
    client.table(RUN_TABLE).insert(row).execute()
    rows = client.table(RUN_TABLE).select("*").eq("id", row["id"]).execute().data
    return _normalize_run(rows[0]) if rows else _normalize_run(row)


def _update_run(run_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    client = get_turso_client()
    client.table(RUN_TABLE).update(updates).eq("id", run_id).execute()
    rows = client.table(RUN_TABLE).select("*").eq("id", run_id).execute().data
    if not rows:
        raise KeyError(run_id)
    return _normalize_run(rows[0])


def _next_iteration(project_id: str) -> int:
    client = get_turso_client()
    rows = (
        client.table(RUN_TABLE)
        .select("iteration")
        .eq("project_id", project_id)
        .order("iteration", desc=True)
        .range(0, 0)
        .execute()
        .data
    )
    if not rows:
        return 1
    return int(rows[0].get("iteration") or 0) + 1


def _snapshot_files(paths: list[Path]) -> dict[str, Optional[str]]:
    snapshot: dict[str, Optional[str]] = {}
    for path in paths:
        key = _workspace_relative(path)
        snapshot[key] = path.read_text(encoding="utf-8") if path.exists() else None
    return snapshot


def _restore_snapshot(snapshot: dict[str, Optional[str]]) -> None:
    for relative_path, content in snapshot.items():
        target = _resolve_workspace_path(relative_path)
        if content is None:
            try:
                target.unlink()
            except FileNotFoundError:
                pass
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")


def _changed_paths(snapshot: dict[str, Optional[str]]) -> list[str]:
    changed: list[str] = []
    for relative_path, original in snapshot.items():
        target = _resolve_workspace_path(relative_path)
        current = target.read_text(encoding="utf-8") if target.exists() else None
        if current != original:
            changed.append(relative_path)
    return sorted(changed)


def _extract_metric(text: str, pattern: str) -> Optional[float]:
    if not text or not pattern:
        return None
    matches = list(re.finditer(pattern, text, flags=re.MULTILINE))
    if not matches:
        return None

    match = matches[-1]
    groups = list(match.groups())
    values = groups if groups else [match.group(0)]
    for value in values:
        if value is None:
            continue
        try:
            return float(str(value).strip())
        except ValueError:
            number_match = re.search(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", str(value))
            if number_match:
                return float(number_match.group(0))
    return None


def _is_improvement(metric_value: Optional[float], reference_metric: Optional[float], goal: str) -> bool:
    if metric_value is None:
        return False
    if reference_metric is None:
        return True
    if goal == "max":
        return metric_value > reference_metric
    return metric_value < reference_metric


def _build_project_context(project: dict[str, Any], iteration: int) -> str:
    profile = get_agent_profile(project.get("agent_profile_id"))
    editable_paths = "\n".join(f"- {path}" for path in project.get("editable_paths") or [])
    baseline = project.get("baseline_metric")
    best_metric = project.get("best_metric")
    return (
        f"Autonomous research project: {project.get('name')}\n"
        f"Objective: {project.get('objective')}\n"
        f"Iteration: {iteration}\n"
        f"Workspace path: {project.get('workspace_path')}\n"
        f"Editable files:\n{editable_paths}\n"
        f"Experiment command: {project.get('experiment_command')}\n"
        f"Metric pattern: {project.get('metric_pattern')}\n"
        f"Metric goal: {project.get('metric_goal')}\n"
        f"Baseline metric: {baseline}\n"
        f"Best metric so far: {best_metric}\n"
        f"Specialist profile: {profile.id if profile else DEFAULT_AGENT_PROFILE_ID}\n"
        "Rules:\n"
        "- Only edit the listed editable files.\n"
        "- Make one tight hypothesis-driven change, not a broad refactor.\n"
        "- Run the experiment command exactly once if you need to validate the change.\n"
        "- Summarize the hypothesis, measured outcome, and whether the change should survive.\n"
    )


def _extract_command_result(tool_results: list[dict[str, Any]], experiment_command: str) -> Optional[dict[str, Any]]:
    normalized = str(experiment_command or "").strip()
    exact_match = None
    last_command = None
    for item in tool_results:
        if item.get("tool") != "run_command":
            continue
        last_command = item
        if str(item.get("command") or "").strip() == normalized:
            exact_match = item
    return exact_match or last_command


def _run_local_command(command: str, cwd: Path, timeout_seconds: int = RUN_TIMEOUT_SECONDS) -> dict[str, Any]:
    shell_executable = shutil.which("bash") or shutil.which("sh")
    if os.name == "nt":
        completed = subprocess.run(
            ["cmd.exe", "/d", "/s", "/c", command],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=max(1, timeout_seconds),
        )
    else:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            shell=True,
            executable=shell_executable,
            capture_output=True,
            text=True,
            timeout=max(1, timeout_seconds),
        )
    return {
        "returncode": completed.returncode,
        "stdout": completed.stdout or "",
        "stderr": completed.stderr or "",
    }


async def _ensure_setup(project: dict[str, Any], project_root: Path) -> None:
    if not project.get("setup_command") or project.get("setup_completed_at"):
        return
    logger.info("Running autoresearch setup for {}", project.get("name"))
    result = await asyncio.to_thread(_run_local_command, str(project["setup_command"]), project_root, RUN_TIMEOUT_SECONDS)
    if result["returncode"] != 0:
        raise RuntimeError((result["stderr"] or result["stdout"] or "setup command failed").strip())
    _update_project(project["id"], {"setup_completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})


async def _run_project_iteration(project_id: str, app_state) -> dict[str, Any]:
    project = get_autoresearch_project(project_id)
    if project is None:
        raise KeyError(project_id)

    project_root = _resolve_project_root(project["workspace_path"])
    editable_files = [_resolve_workspace_path(path) for path in project.get("editable_paths") or []]
    snapshot = _snapshot_files(editable_files)
    iteration = _next_iteration(project_id)
    run_id = uuid.uuid4().hex

    _update_project(project_id, {"status": "running"})
    run = _insert_run(
        {
            "id": run_id,
            "project_id": project_id,
            "iteration": iteration,
            "status": "running",
            "command_ran": project.get("experiment_command"),
        }
    )

    try:
        await _ensure_setup(project, project_root)

        payload = AgentRunRequestPayload(
            message=(
                f"Read and improve the measurable experiment for project '{project['name']}'. "
                f"Only modify {project['editable_paths'][0]}."
            ),
            history=[],
            session_id=None,
            context=_build_project_context(project, iteration),
            system_prompt=None,
            use_rag=False,
            roleplay_mode=False,
            nsfw_mode=False,
            backend=str(project.get("backend") or "server"),
            allow_research=False,
            allow_images=False,
            max_steps=int(project.get("max_steps") or 6),
            max_tokens=int(project.get("max_tokens") or 384),
            user_id=None,
            profile_id=str(project.get("agent_profile_id") or DEFAULT_AGENT_PROFILE_ID),
            workspace_scope_paths=[str(project["workspace_path"])],
        )
        try:
            session = await run_agent(payload, app_state, wait_for_completion=True)
        except Exception as exc:
            logger.warning("Autoresearch agent planning failed for {}: {}", project_id, exc)
            session = {
                "id": None,
                "answer": f"Agent planning failed before experiment execution: {exc}",
                "tool_results": [],
            }
        command_result = _extract_command_result(session.get("tool_results", []), str(project["experiment_command"]))
        if command_result is None or str(command_result.get("command") or "").strip() != str(project["experiment_command"]).strip():
            command_result = await asyncio.to_thread(
                _run_local_command,
                str(project["experiment_command"]),
                project_root,
                RUN_TIMEOUT_SECONDS,
            )
            command_result["command"] = str(project["experiment_command"])

        combined_output = f"{command_result.get('stdout') or ''}\n{command_result.get('stderr') or ''}".strip()
        metric_value = _extract_metric(combined_output, str(project["metric_pattern"]))
        changed_paths = _changed_paths(snapshot)
        reference_metric = project.get("best_metric")
        accepted = _is_improvement(metric_value, reference_metric, str(project.get("metric_goal") or "min"))

        if not accepted:
            _restore_snapshot(snapshot)

        status = "completed" if metric_value is not None else "failed"
        summary = str(session.get("answer") or "Autoresearch iteration completed.").strip()
        run = _update_run(
            run_id,
            {
                "session_id": session.get("id"),
                "status": status,
                "hypothesis": summary[:300],
                "metric_value": metric_value,
                "accepted": accepted,
                "summary": summary,
                "stdout_tail": str(command_result.get("stdout") or "")[-4000:],
                "stderr_tail": str(command_result.get("stderr") or "")[-4000:],
                "changed_paths": changed_paths,
                "command_ran": str(command_result.get("command") or project["experiment_command"]),
            },
        )

        updates: dict[str, Any] = {
            "status": "idle" if status == "completed" else "failed",
            "last_run_id": run_id,
        }
        if accepted and metric_value is not None:
            updates["best_metric"] = metric_value
            updates["best_run_id"] = run_id
        _update_project(project_id, updates)
        return {
            "project": get_autoresearch_project(project_id),
            "run": run,
        }
    except asyncio.CancelledError:
        _restore_snapshot(snapshot)
        _update_run(run_id, {"status": "cancelled", "summary": "Run cancelled."})
        _update_project(project_id, {"status": "idle", "last_run_id": run_id})
        raise
    except Exception as exc:
        _restore_snapshot(snapshot)
        logger.warning("Autoresearch project {} failed: {}", project_id, exc)
        _update_run(run_id, {"status": "failed", "summary": str(exc)})
        _update_project(project_id, {"status": "failed", "last_run_id": run_id})
        raise
    finally:
        async with _RUNNING_PROJECT_LOCK:
            _RUNNING_PROJECT_TASKS.pop(project_id, None)


async def start_autoresearch_run(project_id: str, app_state, *, wait_for_completion: bool = False) -> dict[str, Any]:
    project = get_autoresearch_project(project_id)
    if project is None:
        raise KeyError(project_id)

    async with _RUNNING_PROJECT_LOCK:
        existing = _RUNNING_PROJECT_TASKS.get(project_id)
        if existing is not None and not existing.done():
            if wait_for_completion:
                await existing
            current = get_autoresearch_project(project_id)
            return {
                "project": current,
                "runs": list_autoresearch_runs(project_id, limit=10),
            }

        _update_project(project_id, {"status": "queued"})
        task = asyncio.create_task(_run_project_iteration(project_id, app_state))
        _RUNNING_PROJECT_TASKS[project_id] = task

    if wait_for_completion:
        await task
    return {
        "project": get_autoresearch_project(project_id),
        "runs": list_autoresearch_runs(project_id, limit=10),
    }


async def cancel_autoresearch_run(project_id: str) -> dict[str, Any]:
    async with _RUNNING_PROJECT_LOCK:
        task = _RUNNING_PROJECT_TASKS.get(project_id)
        if task is not None and not task.done():
            task.cancel()
        else:
            raise KeyError(project_id)

    _update_project(project_id, {"status": "cancelling"})
    return {
        "project": get_autoresearch_project(project_id),
        "runs": list_autoresearch_runs(project_id, limit=10),
    }
