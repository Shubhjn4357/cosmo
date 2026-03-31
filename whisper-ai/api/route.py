"""
Whisper AI - FastAPI entrypoint.
"""

from __future__ import annotations

import asyncio
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

load_dotenv()
TEST_MODE = os.getenv("WHISPER_TEST_MODE", "false").lower() == "true"

from utils.system_tuning import apply_process_tuning, get_power_profile

apply_process_tuning()

from api.routes import (
    admin,
    analytics,
    auth,
    characters,
    chat,
    collect,
    dashboard,
    datasets,
    faceswap,
    feed,
    files,
    healthcheck,
    horde,
    huggingface,
    image,
    knowledge,
    learn,
    models,
    ping,
    profile,
    research,
    roleplay,
    smart_mode,
    train_vision,
    tts,
    ui,
    upscale,
    voice,
)
from knowledge.embedder import get_embedder
from knowledge.rag import RAGSystem
from services.runtime_manager import get_chat_runtime_manager
from utils.app_paths import UPLOADS_DIR, ensure_app_dirs
from utils.persistence import backup_data, restore_data


class AppState:
    def __init__(self):
        self.chat_runtime = None
        self.model = None
        self.tokenizer = None
        self.vectordb = None
        self.embedder = None
        self.rag = None
        self.is_training = False
        self.daemon_running = False
        self.generator_running = False
        self.training_process = None
        self.generator_process = None
        self.auto_training_task = None
        self.model_switch_enabled = False
        self.start_time = time.time()
        self.config = {}


app_state = AppState()


def get_app_state() -> AppState:
    return app_state


def _runtime_status() -> dict:
    if app_state.chat_runtime is None:
        return {
            "configured_backend": "unknown",
            "active_backend": "uninitialized",
            "model_id": None,
            "loaded": False,
            "loaded_at": None,
            "last_error": None,
            "config": {},
        }
    return app_state.chat_runtime.status()


def _initialize_knowledge_base():
    try:
        from knowledge.vectordb import VectorDB, VectorDBConfig

        embedder = get_embedder()
        vectordb = VectorDB(VectorDBConfig(embedding_dim=embedder.dim))
        rag = RAGSystem(vectordb=vectordb, embedder=embedder)
        app_state.embedder = embedder
        app_state.vectordb = vectordb
        app_state.rag = rag
        logger.info(
            "Knowledge base ready with {} vectors",
            vectordb.get_stats().get("total_vectors", 0),
        )
    except Exception as exc:
        app_state.embedder = None
        app_state.vectordb = None
        app_state.rag = None
        logger.warning(f"Knowledge base initialization skipped: {exc}")


def _background_feature_enabled(env_name: str, default: bool = True) -> bool:
    configured = os.getenv(env_name)
    if configured is not None:
        return configured.strip().lower() == "true"
    if get_power_profile() == "low-power":
        return False
    return default


async def _startup(app: FastAPI):
    from api.routes.profile import get_supabase
    from services.catalog_bootstrap import start_catalog_bootstrap
    from services.gguf_bootstrap import start_gguf_runtime_bootstrap
    from services.hf_keepalive import get_keepalive, keepalive_enabled

    startup_start = time.time()
    app_state.start_time = startup_start
    logger.info("Whisper AI starting")

    try:
        get_supabase()
        logger.info("Application database ready")
    except Exception as exc:
        logger.warning(f"Database initialization skipped: {exc}")

    if not TEST_MODE:
        try:
            restore_data()
        except Exception as exc:
            logger.warning(f"Dataset restore skipped: {exc}")

    hf_key = None
    if not TEST_MODE:
        try:
            hf_key = os.getenv("HF_TOKEN")
        except Exception:
            hf_key = None

        if keepalive_enabled():
            keepalive = get_keepalive(api_key=hf_key, interval_minutes=30)
            keepalive.start()
        else:
            logger.info("HF keepalive disabled by configuration")

    app_state.chat_runtime = get_chat_runtime_manager()
    if TEST_MODE:
        app_state.embedder = None
        app_state.vectordb = None
        app_state.rag = None
    else:
        _initialize_knowledge_base()

    if not TEST_MODE:
        if _background_feature_enabled("WHISPER_AUTO_COLLECTION_ENABLED"):
            try:
                await collect.start_auto_collection_task()
            except Exception as exc:
                logger.warning(f"Auto-collection scheduler unavailable: {exc}")
        else:
            logger.info("Auto-collection scheduler disabled by power profile/configuration")

        if _background_feature_enabled("WHISPER_AUTO_RESEARCH_ENABLED"):
            try:
                await research.start_background_research_task()
            except Exception as exc:
                logger.warning(f"Auto research scheduler unavailable: {exc}")
        else:
            logger.info("Auto research scheduler disabled by power profile/configuration")

        if _background_feature_enabled("WHISPER_AUTO_TRAINING_ENABLED"):
            try:
                from api.routes.train_vision import schedule_auto_training

                if app_state.auto_training_task is None or app_state.auto_training_task.done():
                    app_state.auto_training_task = asyncio.create_task(schedule_auto_training())
                logger.info("Auto-training scheduler initialized")
            except Exception as exc:
                logger.warning(f"Auto-training scheduler unavailable: {exc}")
        else:
            logger.info("Auto-training scheduler disabled by power profile/configuration")

        try:
            from utils.verify_startup import run_verification

            run_verification(app)
        except Exception as exc:
            logger.warning(f"Startup verification skipped: {exc}")

        try:
            bootstrap_status = start_gguf_runtime_bootstrap()
            logger.info(
                "GGUF bootstrap status: {} ({})",
                bootstrap_status.get("status"),
                bootstrap_status.get("stage"),
            )
        except Exception as exc:
            logger.warning(f"GGUF runtime bootstrap skipped: {exc}")

        try:
            catalog_status = start_catalog_bootstrap()
            logger.info(
                "Approved model bootstrap status: {}",
                catalog_status.get("status"),
            )
        except Exception as exc:
            logger.warning(f"Approved model bootstrap skipped: {exc}")

    logger.info(f"Server started in {time.time() - startup_start:.2f}s")


async def _shutdown():
    from services.hf_keepalive import get_keepalive, keepalive_enabled

    if app_state.auto_training_task is not None and not app_state.auto_training_task.done():
        app_state.auto_training_task.cancel()
        try:
            await app_state.auto_training_task
        except asyncio.CancelledError:
            logger.info("Auto-training scheduler stopped")
        finally:
            app_state.auto_training_task = None

    try:
        await research.stop_background_research_task()
    except Exception as exc:
        logger.warning(f"Auto research shutdown skipped: {exc}")

    try:
        await collect.stop_auto_collection_task()
    except Exception as exc:
        logger.warning(f"Auto-collection shutdown skipped: {exc}")

    if app_state.vectordb is not None:
        try:
            app_state.vectordb.save()
            logger.info("Knowledge base saved")
        except Exception as exc:
            logger.error(f"Failed to save knowledge base: {exc}")

    if not TEST_MODE:
        try:
            backup_data()
        except Exception as exc:
            logger.warning(f"Dataset backup skipped: {exc}")

        if keepalive_enabled():
            keepalive = get_keepalive()
            keepalive.stop()
            logger.info("Keepalive stopped")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await _startup(app)
    try:
        yield
    finally:
        await _shutdown()


app = FastAPI(
    title="Whisper AI",
    description="AI-powered API server with local runtime, chat UI, datasets, and admin tools",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ensure_app_dirs()
Path("ui").mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(UPLOADS_DIR)), name="static")
app.mount("/ui-assets", StaticFiles(directory="ui"), name="ui-assets")

app.include_router(chat.router, prefix="/api", tags=["Chat"])
app.include_router(image.router, prefix="/api", tags=["Image"])
app.include_router(files.router, prefix="/api", tags=["Files"])
app.include_router(knowledge.router, prefix="/api", tags=["Knowledge"])
app.include_router(auth.router, prefix="/api", tags=["Auth"])
app.include_router(analytics.router, prefix="/api", tags=["Analytics"])
app.include_router(models.router, prefix="/api", tags=["Models"])
app.include_router(profile.router, prefix="/api", tags=["Profile"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(dashboard.dashboard_router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(voice.router, prefix="/api", tags=["Voice"])
app.include_router(faceswap.router, prefix="/api", tags=["FaceSwap"])
app.include_router(upscale.router, prefix="/api", tags=["Upscale"])
app.include_router(roleplay.router, prefix="/api", tags=["Roleplay"])
app.include_router(horde.router, prefix="/api", tags=["Horde"])
app.include_router(characters.router, prefix="/api", tags=["Characters"])
app.include_router(tts.router, prefix="/api", tags=["TTS"])
app.include_router(learn.router, prefix="/api", tags=["Learning"])
app.include_router(feed.router, prefix="/api/feed", tags=["Data Feed"])
app.include_router(huggingface.router, prefix="/api", tags=["HuggingFace"])
app.include_router(smart_mode.router, prefix="/api", tags=["Smart Mode"])
app.include_router(healthcheck.router, prefix="/api", tags=["Health"])
app.include_router(ping.router, prefix="/api", tags=["Keepalive"])
app.include_router(collect.router, prefix="/api/collect", tags=["Data Collection"])
app.include_router(train_vision.router, tags=["Vision Training"])
app.include_router(datasets.router, prefix="/api", tags=["Datasets"])
app.include_router(research.router, prefix="/api", tags=["Research"])
app.include_router(ui.router, tags=["UI"])


@app.middleware("http")
async def track_request_analytics(request, call_next):
    start = time.time()
    status_code = 500

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        path = request.url.path or ""
        if path.startswith("/api"):
            client_host = request.client.host if request.client else None
            analytics.analytics.record_request(
                time.time() - start,
                endpoint=path,
                client_id=client_host,
                status_code=status_code,
            )


@app.get("/")
async def root():
    return JSONResponse(
        content={
            "status": "healthy",
            "message": "Whisper AI is running",
            "version": app.version,
            "endpoints": {
                "chat_api": "/api/chat",
                "chat_ui": "/chat",
                "image_api": "/api/image/generate",
                "datasets": "/api/datasets",
                "research": "/api/research",
                "admin_ui": "/admin-ui",
                "docs": "/docs",
            },
        }
    )


@app.get("/health")
async def health():
    runtime = _runtime_status()
    return JSONResponse(
        content={
            "status": "ok",
            "service": "whisper-ai",
            "model_loaded": runtime.get("loaded", False),
            "backend": runtime.get("active_backend"),
            "uptime": int(time.time() - app_state.start_time),
            "knowledge_loaded": app_state.rag is not None,
        }
    )


@app.get("/api/health")
async def api_health():
    runtime = _runtime_status()
    return JSONResponse(
        content={
            "status": "ok",
            "service": "whisper-ai",
            "model_loaded": runtime.get("loaded", False),
            "backend": runtime.get("active_backend"),
            "runtime": runtime,
            "uptime": int(time.time() - app_state.start_time),
            "knowledge_loaded": app_state.rag is not None,
        }
    )
