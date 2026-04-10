FROM python:3.11-slim

ARG DEBIAN_FRONTEND=noninteractive
ARG INSTALL_GGUF_RUNTIME=false
ARG INSTALL_AIRLLM=false
ARG INSTALL_EMBEDDING_RUNTIME=true
ARG PYTORCH_INDEX_URL=https://download.pytorch.org/whl/cpu

# CRITICAL: PYTHONUSERBASE must NOT point to /data (a runtime volume mount).
# HF Spaces mounts the persistent volume at /data at runtime, which OVERWRITES
# any files written there during the Docker build — including pip packages.
# Packages must live in system site-packages (no PYTHONUSERBASE set here).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/home/user \
    PORT=7860 \
    HOST=0.0.0.0 \
    WHISPER_POWER_PROFILE=low-power \
    WHISPER_EAGER_KNOWLEDGE_BASE_ENABLED=false \
    WHISPER_STARTUP_VERIFICATION_ENABLED=false \
    WHISPER_WARM_CHAT_RUNTIME_ENABLED=false \
    WHISPER_DEFER_ROUTE_REGISTRATION=true \
    WHISPER_PREBIND_DELAY_SECONDS=0 \
    WHISPER_PERSIST_MODELS_DIR=false \
    WHISPER_BOOTSTRAP_GGUF_RUNTIME=false \
    WHISPER_BOOTSTRAP_APPROVED_MODELS=false \
    WHISPER_USE_PERSISTENT_VOLUME=true \
    WHISPER_PERSISTENT_VOLUME_ROOT=/data/whisper \
    WHISPER_DATA_ROOT=/app/data \
    WHISPER_MODELS_DIR=/app/data/models \
    WHISPER_UPLOADS_DIR=/app/data/uploads \
    HF_HOME=/app/data/runtime/huggingface \
    HUGGINGFACE_HUB_CACHE=/app/data/runtime/huggingface/hub \
    IMAGE_ENCODER_BACKEND=local \
    IMAGE_ENCODER_URL="https://shubhjn-image-encoder.hf.space" \
    AUTO_COLLECTION_ENABLED=true \
    AUTO_COLLECTION_INTERVAL_SECONDS=3600 \
    WHISPER_MAX_VISION_STORE=1000 \
    WHISPER_COMPLEX_TASK_ROUTING=true \
    WHISPER_COMPLEX_TASK_MODEL_ID="Qwen/Qwen3-Coder-Next" \
    WHISPER_COMPLEX_TASK_MAX_CONTEXT_TOKENS=16384 \
    WHISPER_COMPLEX_TASK_MAX_NEW_TOKENS=1024 \
    WHISPER_COMPLEX_TASK_TRUST_REMOTE_CODE=true \
    WHISPER_COMPLEX_TASK_THRESHOLD=0.55 \
    WHISPER_CURATED_TEXT_MAX_ROWS=25000 \
    WHISPER_CURATED_IMAGE_PROMPT_MAX_ROWS=50000 \
    WHISPER_IMAGE_PROMPT_PRIOR_ENABLED=true \
    WHISPER_IMAGE_PROMPT_PRIOR_MAX_PROMPTS=2000 \
    CLOUDFLARE_CRAWL_ENABLED=true \
    CLOUDFLARE_CRAWL_PLAN=free \
    CLOUDFLARE_REST_REQUESTS_PER_MINUTE=6 \
    CLOUDFLARE_CRAWL_JOBS_PER_DAY=5 \
    CLOUDFLARE_CRAWL_PAGES_PER_JOB=100 \
    CLOUDFLARE_CRAWL_POLL_INTERVAL_SECONDS=10 \
    CLOUDFLARE_CRAWL_MAX_POLLS=60 \
    LOCAL_CHAT_BACKEND="auto" \
    LOCAL_MAX_CONTEXT_TOKENS=4096 \
    LOCAL_MAX_NEW_TOKENS=512

RUN useradd -m -u 1000 user
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    cmake \
    curl \
    espeak-ng \
    git \
    libgl1 \
    libglib2.0-0 \
    libopenblas-dev \
    pkg-config \
    procps \
    ripgrep \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=user:user requirements.txt requirements-space.txt requirements-optional.txt ./

# Install all packages as root into system site-packages (safe from volume overwrites at runtime)
RUN python -m pip install "pip>=24.0" "setuptools<70.0.0" wheel && \
    pip install --no-cache-dir "numpy>=1.24.0,<2.0.0" && \
    pip install --no-cache-dir --index-url "$PYTORCH_INDEX_URL" torch==2.2.0 torchvision==0.17.0 && \
    pip install --no-cache-dir --no-build-isolation -r requirements-space.txt && \
    python -c "import numpy; assert tuple(int(x) for x in numpy.__version__.split('.')[:2]) < (2,0), f'NumPy {numpy.__version__} >= 2.0'" && \
    python -c "import datasets, torchvision, tqdm, fitz, pytesseract, docx, openpyxl, edge_tts; import shutil; assert shutil.which('tesseract'), 'tesseract missing'" && \
    if [ "$INSTALL_EMBEDDING_RUNTIME" = "true" ]; then \
      pip install --no-cache-dir "sentence-transformers>=3.0.0,<4.0.0"; \
    fi && \
    if [ "$INSTALL_GGUF_RUNTIME" = "true" ]; then \
      CMAKE_ARGS="-DLLAMA_BLAS=ON -DLLAMA_BLAS_VENDOR=OpenBLAS" pip install --no-cache-dir "llama-cpp-python>=0.3.0"; \
    fi && \
    if [ "$INSTALL_AIRLLM" = "true" ]; then \
      pip install --no-cache-dir "airllm>=2.11.0"; \
    fi

COPY --chown=user:user . .

# Pre-create app-layer data dirs inside /app (NOT /data which is a volume mount)
RUN mkdir -p \
        /app/data/models \
        /app/data/uploads \
        /app/data/runtime/huggingface/hub \
        /app/data/db && \
    chown -R user:user /app

USER user
EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=20s --start-period=120s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/health', timeout=10)" || exit 1

CMD ["python", "app.py"]
