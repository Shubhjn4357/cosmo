from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth import verify_admin_token
from services.autoresearch_service import (
    cancel_autoresearch_run,
    create_autoresearch_project,
    get_autoresearch_project,
    list_autoresearch_projects,
    list_autoresearch_runs,
    start_autoresearch_run,
)


router = APIRouter(prefix="/autoresearch", tags=["autoresearch"])


class AutoresearchProjectCreateRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    name: str
    objective: str
    workspace_path: str
    editable_paths: list[str] = Field(default_factory=list)
    experiment_command: str
    metric_pattern: str
    metric_goal: str = "min"
    setup_command: Optional[str] = None
    backend: str = "server"
    agent_profile_id: str = "autonomous-researcher"
    max_steps: int = 6
    max_tokens: int = 384
    baseline_metric: Optional[float] = None
    notes: Optional[str] = None


class AutoresearchRunRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    wait_for_completion: bool = False


@router.get("/projects")
async def get_autoresearch_projects(limit: int = 20, payload: dict = Depends(verify_admin_token)):
    return {"projects": list_autoresearch_projects(limit=max(1, min(limit, 100)))}


@router.post("/projects")
async def create_autoresearch_project_route(
    request: AutoresearchProjectCreateRequest,
    payload: dict = Depends(verify_admin_token),
):
    try:
        project = create_autoresearch_project(request.model_dump())
    except (ValueError, FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "created", "project": project}


@router.get("/projects/{project_id}")
async def get_autoresearch_project_route(project_id: str, payload: dict = Depends(verify_admin_token)):
    project = get_autoresearch_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Unknown autoresearch project '{project_id}'")
    return {
        "project": project,
        "runs": list_autoresearch_runs(project_id, limit=20),
    }


@router.get("/projects/{project_id}/runs")
async def get_autoresearch_runs_route(
    project_id: str,
    limit: int = 20,
    payload: dict = Depends(verify_admin_token),
):
    project = get_autoresearch_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Unknown autoresearch project '{project_id}'")
    return {
        "project": project,
        "runs": list_autoresearch_runs(project_id, limit=max(1, min(limit, 100))),
    }


@router.post("/projects/{project_id}/run")
async def run_autoresearch_project_route(
    project_id: str,
    request: AutoresearchRunRequest,
    payload: dict = Depends(verify_admin_token),
):
    from api.route import get_app_state

    if get_autoresearch_project(project_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown autoresearch project '{project_id}'")
    try:
        result = await start_autoresearch_run(
            project_id,
            get_app_state(),
            wait_for_completion=request.wait_for_completion,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"status": "started", **result}


@router.post("/projects/{project_id}/cancel")
async def cancel_autoresearch_project_route(project_id: str, payload: dict = Depends(verify_admin_token)):
    if get_autoresearch_project(project_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown autoresearch project '{project_id}'")
    try:
        result = await cancel_autoresearch_run(project_id)
    except KeyError as exc:
        raise HTTPException(status_code=409, detail=f"No active run for project '{project_id}'") from exc
    return {"status": "cancelled", **result}
