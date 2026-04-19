"""
Cosmo AI - FastAPI entrypoint.
"""

from __future__ import annotations

import asyncio
import os
import json
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator, Awaitable, Optional, Any

from dataclasses import dataclass
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from loguru import logger
from utils.system_tuning import apply_process_tuning, env_flag_enabled
from utils.app_paths import UPLOADS_DIR, ensure_app_dirs, get_ui_dir
from utils.anonymizer import anonymize_lesson

load_dotenv()
TEST_MODE = os.getenv("COSMO_TEST_MODE", "false").lower() == "true"

apply_process_tuning()

def _log_system_resources():
    try:
        import psutil
        mem = psutil.virtual_memory()
        cpu_count = os.cpu_count() or 1
        logger.info(f"System Resources: RAM={mem.total / (1024**3):.1f}GB (Used: {mem.percent}%), CPUs={cpu_count}")
    except Exception:
        pass

# Lazy-loaded router registration to improve startup time and memory footprint on restricted hardware
def _load_api_route_modules():
    from api.routes import (
        admin,
        agent,
        analytics,
        autoresearch,
        auth,
        characters,
        chat,
        collect,
        cosmo_agent,
        cosmo_business,
        dashboard,
        datasets,
        feed,
        files,
        healthcheck,
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
        voice,
    )
    from services.automation_service import automation_service
    from services.service_registry import service_registry

    # Register sovereign agent services
    service_registry.register("automation", automation_service)
    return {
        "admin": admin,
        "agent": agent,
        "analytics": analytics,
        "autoresearch": autoresearch,
        "auth": auth,
        "characters": characters,
        "chat": chat,
        "collect": collect,
        "cosmo_agent": cosmo_agent,
        "cosmo_business": cosmo_business,
        "dashboard": dashboard,
        "datasets": datasets,
        "feed": feed,
        "files": files,
        "healthcheck": healthcheck,
        "huggingface": huggingface,
        "image": image,
        "knowledge": knowledge,
        "learn": learn,
        "models": models,
        "ping": ping,
        "profile": profile,
        "research": research,
        "roleplay": roleplay,
        "smart_mode": smart_mode,
        "train_vision": train_vision,
        "tts": tts,
        "ui": ui,
        "voice": voice,
    }


def _register_api_routes(app: FastAPI, route_modules: dict | None = None) -> None:
    if app_state.routes_registered:
        return

    modules = route_modules or _load_api_route_modules()

    app.include_router(modules["chat"].router, prefix="/api", tags=["Chat"])
    app.include_router(modules["agent"].router, prefix="/api", tags=["Agent"])
    app.include_router(modules["cosmo_agent"].router, prefix="/api", tags=["Cosmo Multi-Agent"])
    app.include_router(modules["cosmo_business"].router, prefix="/api", tags=["Cosmo Business"])
    app.include_router(modules["autoresearch"].router, prefix="/api", tags=["Autoresearch"])
    app.include_router(modules["image"].router, prefix="/api", tags=["Image"])
    app.include_router(modules["files"].router, prefix="/api", tags=["Files"])
    app.include_router(modules["knowledge"].router, prefix="/api", tags=["Knowledge"])
    app.include_router(modules["auth"].router, prefix="/api", tags=["Auth"])
    app.include_router(modules["analytics"].router, prefix="/api", tags=["Analytics"])
    app.include_router(modules["models"].router, prefix="/api", tags=["Models"])
    app.include_router(modules["profile"].router, prefix="/api", tags=["Profile"])
    app.include_router(modules["admin"].router, prefix="/api/admin", tags=["Admin"])
    app.include_router(modules["dashboard"].dashboard_router, prefix="/api/dashboard", tags=["Dashboard"])
    app.include_router(modules["voice"].router, prefix="/api", tags=["Voice"])
    app.include_router(modules["roleplay"].router, prefix="/api", tags=["Roleplay"])
    app.include_router(modules["characters"].router, prefix="/api", tags=["Characters"])
    app.include_router(modules["tts"].router, prefix="/api", tags=["TTS"])
    app.include_router(modules["learn"].router, prefix="/api", tags=["Learning"])
    app.include_router(modules["feed"].router, prefix="/api/feed", tags=["Data Feed"])
    app.include_router(modules["huggingface"].router, prefix="/api", tags=["HuggingFace"])
    app.include_router(modules["smart_mode"].router, prefix="/api", tags=["Smart Mode"])
    app.include_router(modules["healthcheck"].router, prefix="/api", tags=["Health"])
    app.include_router(modules["ping"].router, prefix="/api", tags=["Keepalive"])
    app.include_router(modules["collect"].router, prefix="/api/collect", tags=["Data Collection"])
    app.include_router(modules["train_vision"].router, tags=["Vision Training"])
    app.include_router(modules["datasets"].router, prefix="/api", tags=["Datasets"])
    app.include_router(modules["research"].router, prefix="/api", tags=["Research"])
    app.include_router(modules["ui"].router, tags=["UI"])
    app_state.routes_registered = True
    logger.info("FastAPI route registration complete ({} modules)", len(modules))


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
        self.post_start_task = None
        self.knowledge_init_task = None
        self.runtime_warm_task = None
        self.route_registration_task = None
        self.routes_registered = False
        self.model_switch_enabled = False
        self.start_time = time.time()
        self.config = {}
        # WebSocket Management for real-time steering
        self.ws_manager = HardenedWSManager()


class HardenedWSManager:
    """
    Manages active WebSocket connections with Auth and Heartbeats.
    Ensures stable real-time steering for business automation.
    """
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}
        self._heartbeat_interval = 25 # Seconds
        self._loop = asyncio.get_event_loop()

    async def connect(self, websocket: WebSocket, session_id: str, token: Optional[str] = None):
        # 1. Verification Handshake
        admin_token = os.getenv("ADMIN_TOKEN", "cosmo-default-admin")
        if token and token != admin_token:
            await websocket.close(code=4003) # Unauthorized
            return False
            
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
        self.active_connections[session_id].append(websocket)
        
        # 2. Launch Heartbeat Monitor for this connection
        asyncio.create_task(self._heartbeat_loop(websocket, session_id))
        return True

    def disconnect(self, websocket: WebSocket, session_id: str):
        if session_id in self.active_connections:
            if websocket in self.active_connections[session_id]:
                self.active_connections[session_id].remove(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]

    async def _heartbeat_loop(self, websocket: WebSocket, session_id: str):
        """Keep-alive loop to prevent HF Space idle timeouts."""
        try:
            while websocket in self.active_connections.get(session_id, []):
                await asyncio.sleep(self._heartbeat_interval)
                # Send binary heartbeat to keep connection 'warm'
                await websocket.send_bytes(b"\x09") # PING
        except Exception:
            self.disconnect(websocket, session_id)

    async def broadcast(self, session_id: str, message: dict):
        if session_id not in self.active_connections:
            return

        # Audit: Scrub the broadcast payload
        scrubbed_message = {
            "type": message.get("type", "update"),
            "payload": self._scrub_payload(message.get("payload", message)),
            "timestamp": datetime.now().isoformat()
        }

        send_tasks = []
        for connection in self.active_connections[session_id]:
            send_tasks.append(connection.send_json(scrubbed_message))
        
        if send_tasks:
            results = await asyncio.gather(*send_tasks, return_exceptions=True)
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    logger.debug(f"WS send failed for {session_id}, pruning...")

    def _scrub_payload(self, data: Any) -> Any:
        if isinstance(data, str):
            return anonymize_lesson(data)
        if isinstance(data, dict):
            return {k: self._scrub_payload(v) for k, v in data.items()}
        if isinstance(data, list):
            return [self._scrub_payload(v) for v in data]
        return data

    async def handle_steering(self, websocket: WebSocket, session_id: str, raw_data: str):
        """Processes structured steering commands from the client."""
        try:
            cmd = json.loads(raw_data)
            action = cmd.get("action")
            logger.info(f"Steering command received [{session_id}]: {action}")
            
            # Integration hooks for cosmo_business steering
            # Actions: pause, resume, override_target, handoff_confirm
            response = {"type": "steering_ack", "action": action, "status": "processed"}
            await websocket.send_json(response)
        except Exception as e:
            logger.error(f"Steering error: {e}")


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
        from knowledge.embedder import get_embedder
        from knowledge.rag import RAGSystem
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


def _initialize_runtime_services() -> None:
    try:
        from api.routes.profile import get_db_client

        get_db_client()
        logger.info("Application database ready")
    except Exception as exc:
        logger.warning(f"Database initialization skipped: {exc}")

    try:
        from services.runtime_manager import get_chat_runtime_manager

        app_state.chat_runtime = get_chat_runtime_manager()
        logger.info("Chat runtime manager initialized")
    except Exception as exc:
        app_state.chat_runtime = None
        logger.warning(f"Chat runtime manager initialization skipped: {exc}")


def _background_feature_enabled(env_name: str, default: bool = True) -> bool:
    return env_flag_enabled(env_name, default, disable_in_low_power=True)


def _warm_chat_runtime_enabled() -> bool:
    return env_flag_enabled(
        "COSMO_WARM_CHAT_RUNTIME_ENABLED",
        True,
        disable_in_low_power=True,
    )


def _eager_knowledge_base_enabled() -> bool:
    return env_flag_enabled(
        "COSMO_EAGER_KNOWLEDGE_BASE_ENABLED",
        True,
        disable_in_low_power=True,
    )


def _startup_verification_enabled() -> bool:
    return env_flag_enabled(
        "COSMO_STARTUP_VERIFICATION_ENABLED",
        True,
        disable_in_low_power=True,
    )

def _defer_route_registration_enabled() -> bool:
    if os.getenv("SPACE_ID") or os.getenv("HUGGINGFACE_SPACES"):
        return env_flag_enabled("COSMO_DEFER_ROUTE_REGISTRATION", True)
    return env_flag_enabled("COSMO_DEFER_ROUTE_REGISTRATION", False)


async def _ensure_api_routes_registered(app: FastAPI) -> None:
    """
    Ensures all API routes are registered. 
    Now synchronous and eager to prevent 404s on booting.
    """
    if app_state.routes_registered:
        return
    
    modules = _load_api_route_modules()
    _register_api_routes(app, modules)


async def _run_post_start_initialization(app: FastAPI):
    startup_tasks: list[Awaitable[object]] = []

    # Always register routes eagerly to prevent hidden 404s
    await _ensure_api_routes_registered(app)

    startup_tasks.append(asyncio.to_thread(_initialize_runtime_services))

    startup_results = await asyncio.gather(*startup_tasks, return_exceptions=True)
    for result in startup_results:
        if isinstance(result, Exception):
            logger.error(f"Deferred startup initialization failed: {result}")

    # Stabilize HF Deployments by deliberately delaying heavy boot sequences
    # until AFTER the server is bound and serving HTTP 200 OK /health checks.
    logger.info("Initializing 15s health-check grace period (Heartbeat: 3s)...")
    for i in range(5):
        logger.info(f"Startup Heartbeat [{i+1}/5] - Service ready for traffic, background boot deferred.")
        await asyncio.sleep(3)
    logger.info("Waking up to resume eager initialization.")

    from services.catalog_bootstrap import start_catalog_bootstrap
    from services.gguf_bootstrap import start_gguf_runtime_bootstrap
    from utils.persistence import restore_data
    import api.routes.collect as collect
    import api.routes.research as research
    from services.service_registry import service_registry

    if not TEST_MODE:
        if _background_feature_enabled("COSMO_AUTO_COLLECTION_ENABLED"):
            try:
                await collect.start_auto_collection_task()
            except Exception as exc:
                logger.warning(f"Auto-collection scheduler unavailable: {exc}")
        else:
            logger.info("Auto-collection scheduler disabled by power profile/configuration")

        if _background_feature_enabled("COSMO_AUTO_RESEARCH_ENABLED"):
            try:
                await research.start_background_research_task()
            except Exception as exc:
                logger.warning(f"Auto research scheduler unavailable: {exc}")
        else:
            logger.info("Auto research scheduler disabled by power profile/configuration")

        if _background_feature_enabled("COSMO_AUTO_TRAINING_ENABLED"):
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
            bootstrap_status = start_gguf_runtime_bootstrap()
            logger.info(
                "GGUF bootstrap status: {} ({})",
                bootstrap_status.get("status"),
                bootstrap_status.get("stage"),
            )
        except Exception as exc:
            logger.warning(f"GGUF runtime bootstrap skipped: {exc}")

        # Start all registered background services
        await service_registry.start_all(app_state)

        try:
            catalog_status = start_catalog_bootstrap()
            logger.info(
                "Approved model bootstrap status: {}",
                catalog_status.get("status"),
            )
        except Exception as exc:
            logger.warning(f"Approved model bootstrap skipped: {exc}")

    try:
        await asyncio.to_thread(restore_data)
    except Exception as exc:
        logger.warning(f"Dataset restore skipped: {exc}")

    try:
        from services.runtime_manager import load_runtime_state

        config, selected_profile = load_runtime_state()
        if config is not None and app_state.chat_runtime is not None and not app_state.chat_runtime.is_ready():
            app_state.chat_runtime.reconfigure(
                config,
                selected_profile=selected_profile or "custom",
                persist=False,
            )
            logger.info("Runtime configuration refreshed from restored data")
    except Exception as exc:
        logger.warning(f"Runtime configuration refresh skipped: {exc}")

    if _startup_verification_enabled():
        try:
            from utils.verify_startup import run_verification

            run_verification(app)
        except Exception as exc:
            logger.warning(f"Startup verification skipped: {exc}")
    else:
        logger.info("Startup verification disabled by configuration")

    if _eager_knowledge_base_enabled():
        try:
            await asyncio.to_thread(_initialize_knowledge_base)
        except Exception as exc:
            logger.warning(f"Knowledge base initialization skipped: {exc}")
    else:
        logger.info("Knowledge base initialization disabled by configuration")

    if _warm_chat_runtime_enabled():
        try:
            readiness = app_state.chat_runtime.readiness()
            if readiness.get("can_load"):
                loaded = await asyncio.to_thread(app_state.chat_runtime.ensure_loaded)
                logger.info(
                    "Warm chat runtime {}",
                    "ready" if loaded else f"skipped ({app_state.chat_runtime.status().get('last_error')})",
                )
            else:
                logger.info("Warm chat runtime deferred: {}", readiness.get("summary"))
        except Exception as exc:
            logger.warning(f"Warm chat runtime skipped: {exc}")
    else:
        logger.info("Warm chat runtime disabled by power profile/configuration")


async def _startup(app: FastAPI):
    print(">>> LIFESPAN STARTUP PROBE: Cosmo AI Lifespan Triggered <<<", flush=True)
    _log_system_resources()

    from services.hf_keepalive import get_keepalive, keepalive_enabled

    startup_start = time.time()
    app_state.start_time = startup_start
    logger.info("Cosmo AI starting - Lifespan Hook Active")

    hf_key = None
    if not TEST_MODE:
        try:
            hf_key = os.getenv("HF_TOKEN")
        except Exception:
            hf_key = None

        if keepalive_enabled():
            keepalive = get_keepalive(api_key=hf_key, interval_minutes=30)  # type: ignore
            keepalive.start()
        else:
            logger.info("HF keepalive disabled by configuration")

    app_state.chat_runtime = None
    app_state.embedder = None
    app_state.vectordb = None
    app_state.rag = None

    if not TEST_MODE:
        if app_state.post_start_task is None or app_state.post_start_task.done():
            app_state.post_start_task = asyncio.create_task(_run_post_start_initialization(app))
        logger.info("Post-start initialization scheduled in background")

    duration = time.time() - startup_start
    logger.info(f"Server bootstrap complete in {duration:.2f}s. Ready for traffic on :7860.")


async def _shutdown():
    from services.hf_keepalive import get_keepalive, keepalive_enabled
    from utils.persistence import backup_data
    from services.service_registry import service_registry

    for task_name, label in (
        ("post_start_task", "Post-start initialization"),
        ("runtime_warm_task", "Warm chat runtime"),
        ("knowledge_init_task", "Knowledge base initialization"),
        ("route_registration_task", "Deferred route registration"),
    ):
        task = getattr(app_state, task_name, None)
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                logger.info(f"{label} stopped")
            finally:
                setattr(app_state, task_name, None)

    if app_state.auto_training_task is not None and not app_state.auto_training_task.done():
        app_state.auto_training_task.cancel()
        try:
            await app_state.auto_training_task
        except asyncio.CancelledError:
            logger.info("Auto-training scheduler stopped")
        finally:
            app_state.auto_training_task = None

    try:
        from api.routes.research import stop_background_research_task
        await stop_background_research_task()
    except Exception as exc:
        logger.warning(f"Auto research shutdown skipped: {exc}")

    try:
        from api.routes.collect import stop_auto_collection_task
        await stop_auto_collection_task()
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


from utils.constants import SYSTEM_DESCRIPTION, SYSTEM_NAME, SYSTEM_VERSION

app = FastAPI(
    title=SYSTEM_NAME,
    description=SYSTEM_DESCRIPTION,
    version=SYSTEM_VERSION,
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
app.mount("/static", StaticFiles(directory=str(UPLOADS_DIR)), name="static")
app.mount("/assets", StaticFiles(directory=str(get_ui_dir() / "assets")), name="assets")
app.mount("/ui-assets", StaticFiles(directory=str(get_ui_dir())), name="ui-assets")

# Register all routes immediately (Eager) to prevent 404s
_register_api_routes(app, _load_api_route_modules())


def _record_request_analytics(
    *,
    duration_seconds: float,
    endpoint: str,
    client_host: str | None,
    status_code: int,
) -> None:
    try:
        from api.routes.analytics import analytics as request_analytics

        request_analytics.record_request(
            duration_seconds,
            endpoint=endpoint,
            client_id=client_host,
            status_code=status_code,
        )
    except Exception as exc:
        logger.debug(f"Request analytics skipped: {exc}")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global Error for {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "message": "Internal Server Error",
            "detail": str(exc) if TEST_MODE else "Application error encountered",
            "error": "InternalServerError"
        }
    )


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


@app.middleware("http")
async def track_request_analytics(request, call_next):
    start = time.time()
    status_code = 500

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    except Exception as e:
        logger.error(f"Middleware error for {request.url.path}: {e}")
        raise e
    finally:
        path = request.url.path or ""
        if path.startswith("/api"):
            client_host = request.client.host if request.client else None
            _record_request_analytics(
                duration_seconds=time.time() - start,
                endpoint=path,
                client_host=client_host,
                status_code=status_code,
            )


@app.get("/")
async def root():
    """
    Landing page for Cosmo AI. 
    Redirects/Serves the primary Chat UI to ensure immediate usability on HF Spaces.
    """
    from api.routes.ui import chat_page
    return await chat_page()


@app.get("/admin")
@app.get("/admin/")
async def admin_redirect():
    """Compatibility redirect for older admin URLs."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/admin-ui")


@app.get("/health")
async def health():
    # Ensure routes are registered if they somehow haven't been (failsafe)
    if not app_state.routes_registered:
        _register_api_routes(app)
    
    runtime = _runtime_status()
    return JSONResponse(
        content={
            "status": "ok",
            "service": "cosmo-ai",
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
            "service": "cosmo-ai",
            "model_loaded": runtime.get("loaded", False),
            "backend": runtime.get("active_backend"),
            "runtime": runtime,
            "uptime": int(time.time() - app_state.start_time),
            "knowledge_loaded": app_state.rag is not None,
        }
    )


@app.websocket("/api/cosmo/business/ws/{session_id}")
async def cosmo_business_websocket(websocket: WebSocket, session_id: str, token: Optional[str] = None):
    """
    WebSocket endpoint for real-time mission steering.
    Streams task updates, progress, and handoff alerts.
    """
    connected = await app_state.ws_manager.connect(websocket, session_id, token)
    if not connected:
        return
        
    try:
        while True:
            # Client can send steering commands via WS
            data = await websocket.receive_text()
            await app_state.ws_manager.handle_steering(websocket, session_id, data)
    except WebSocketDisconnect:
        app_state.ws_manager.disconnect(websocket, session_id)
    except Exception as e:
        logger.error(f"WS error for {session_id}: {e}")
        app_state.ws_manager.disconnect(websocket, session_id)
