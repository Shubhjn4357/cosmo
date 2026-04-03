import os
import sys

# Force absolute line buffering for Hugging Face streaming logs
try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

print(">>> STDOUT PROBE: Whisper AI Entry Point Loading... <<<", flush=True)
sys.stdout.flush()

try:
    import uvicorn
    from loguru import logger
except Exception as e:
    print(f"FATAL: Early Import Failure: {e}", file=sys.stderr, flush=True)
    sys.exit(1)

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
