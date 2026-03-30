"""
Simple UI routes for the chat and admin pages.
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response


router = APIRouter(tags=["ui"])

UI_DIR = Path("ui")


def _serve_page(filename: str):
    path = UI_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"UI page not found: {filename}")
    return FileResponse(path)


@router.get("/chat")
async def chat_page():
    return _serve_page("chat.html")


@router.get("/admin-ui")
async def admin_page():
    return _serve_page("admin.html")


@router.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)
