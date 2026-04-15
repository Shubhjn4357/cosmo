"""
Simple UI routes for the chat and admin pages.
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response


from utils.app_paths import get_ui_dir
from utils.constants import UI_PAGE_ADMIN, UI_PAGE_CHAT

router = APIRouter(tags=["ui"])

UI_DIR = get_ui_dir()


def _serve_page(filename: str):
    path = UI_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"UI page not found: {filename}")
    return FileResponse(path)


@router.get("/chat")
async def chat_page():
    return _serve_page(UI_PAGE_CHAT)


@router.get("/admin-ui")
async def admin_page():
    return _serve_page(UI_PAGE_ADMIN)


@router.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)
