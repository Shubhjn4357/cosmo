import os
import sys
import time

# Total stream synchronization
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)


def _prebind_delay_seconds() -> float:
    try:
        return max(0.0, float(os.getenv("WHISPER_PREBIND_DELAY_SECONDS", "0")))
    except Exception:
        return 0.0


startup_delay = _prebind_delay_seconds()
if startup_delay > 0:
    print(f">>> INITIALIZING PRE-BIND DELAY ({startup_delay:.1f}s) <<<", flush=True)
    time.sleep(startup_delay)
print(">>> BOOT PROBE: SYSTEM OK <<<", flush=True)


def _safe_uid() -> str:
    getuid = getattr(os, "getuid", None)
    if callable(getuid):
        try:
            return str(getuid())
        except Exception:
            return "unknown"
    return "n/a"


# Environment Diagnostics
path_preview = (os.getenv("PATH") or "")[:100]
print(f">>> CONTEXT: UID={_safe_uid()}, CWD={os.getcwd()}, PATH={path_preview}...", flush=True)
sys.stdout.flush()

try:
    print(">>> IMPORTING LIBS <<<", flush=True)
    import uvicorn
    from loguru import logger
    print(">>> LIBS OK <<<", flush=True)
except Exception as e:
    print(f"FATAL: CORE IMPORT FAILURE: {e}", file=sys.stderr, flush=True)
    sys.exit(1)
sys.stdout.flush()

if __name__ == "__main__":
    print(">>> Whisper AI Main Block Starting... <<<", flush=True)
    try:
        from utils.app_paths import DATA_ROOT, HF_HOME_DIR, HUGGINGFACE_HUB_CACHE_DIR, MODELS_DIR, PYTHON_USER_BASE, UPLOADS_DIR, ensure_app_dirs
        
        host = os.getenv("HOST", "0.0.0.0")
        port = int(os.getenv("PORT", "7860"))
        
        # HF Space optimization: default to low-power if running on HF
        if os.getenv("SPACE_ID") or os.getenv("HUGGINGFACE_SPACES"):
            logger.info("Hugging Face Space detected. Applying low-power defaults.")
            os.environ.setdefault("WHISPER_POWER_PROFILE", "low-power")
            os.environ.setdefault("WHISPER_STARTUP_VERIFICATION_ENABLED", "false")
            os.environ.setdefault("WHISPER_EAGER_KNOWLEDGE_BASE_ENABLED", "false")
            os.environ.setdefault("WHISPER_WARM_CHAT_RUNTIME_ENABLED", "false")
            os.environ.setdefault("WHISPER_DEFER_ROUTE_REGISTRATION", "true")
            os.environ.setdefault("WHISPER_PREBIND_DELAY_SECONDS", "0")

        print(">>> Creating mandatory application directories... <<<", flush=True)
        ensure_app_dirs()
        logger.info("Starting Whisper AI server...")
        logger.info(f"Server starting on http://{host}:{port}")
        
        uvicorn.run(
            "api.route:app",
            host=host,
            port=port,
            log_level="info"
        )
    except Exception as exc:
        print(f"FATAL RECOVERY: Application crashed during startup: {exc}", file=sys.stderr, flush=True)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
else:
    # This file should only be run as main
    pass
