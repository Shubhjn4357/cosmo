"""
Minimal Space-safe FastAPI app used to verify the Hugging Face Space runtime.
"""

from __future__ import annotations

import os
import time

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from loguru import logger

load_dotenv()

app = FastAPI(
    title="Whisper AI Space Safe Mode",
    description="Minimal app target used to validate HF Space startup.",
    version="1.1.0-safe",
)

START_TIME = time.time()

logger.warning("api.space_safe loaded")


@app.get("/")
async def root():
    return JSONResponse(
        content={
            "status": "healthy",
            "service": "whisper-ai",
            "safe_mode": True,
            "message": "Minimal HF Space safe mode is running",
            "docs": "/docs",
            "health": "/api/health",
        }
    )


@app.get("/health")
async def health():
    return JSONResponse(
        content={
            "status": "ok",
            "service": "whisper-ai",
            "safe_mode": True,
            "uptime": int(time.time() - START_TIME),
            "host": os.getenv("HOST", "0.0.0.0"),
            "port": int(os.getenv("PORT", "7860")),
        }
    )


@app.get("/api/health")
async def api_health():
    return JSONResponse(
        content={
            "status": "ok",
            "service": "whisper-ai",
            "safe_mode": True,
            "runtime": {
                "configured_backend": "space-safe",
                "active_backend": "space-safe",
                "loaded": False,
            },
            "uptime": int(time.time() - START_TIME),
        }
    )


@app.get("/api/ping")
async def ping():
    return {"status": "pong", "safe_mode": True}
