FROM python:3.12-slim

ARG INSTALL_GGUF_RUNTIME=false
ARG INSTALL_AIRLLM=false

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/home/user \
    PYTHONUSERBASE=/data/whisper/runtime/python-user-base \
    PATH=/data/whisper/runtime/python-user-base/bin:/home/user/.local/bin:$PATH \
    HF_HOME=/data/.cache/huggingface \
    HUGGINGFACE_HUB_CACHE=/data/.cache/huggingface/hub \
    WHISPER_DATA_ROOT=/data/whisper \
    WHISPER_MODELS_DIR=/data/whisper/models \
    WHISPER_UPLOADS_DIR=/data/whisper/uploads \
    WHISPER_BOOTSTRAP_GGUF_RUNTIME=true \
    PORT=7860 \
    HOST=0.0.0.0

RUN useradd -m -u 1000 user
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    pkg-config \
    git \
    curl \
    libgl1 \
    libglib2.0-0 \
    libopenblas-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=user:user requirements.txt requirements-optional.txt ./

RUN python -m pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt && \
    if [ "$INSTALL_GGUF_RUNTIME" = "true" ]; then \
      CMAKE_ARGS="-DLLAMA_BLAS=ON -DLLAMA_BLAS_VENDOR=OpenBLAS" pip install --no-cache-dir llama-cpp-python==0.3.16; \
    fi && \
    if [ "$INSTALL_AIRLLM" = "true" ]; then \
      pip install --no-cache-dir airllm==2.11.0; \
    fi

COPY --chown=user:user . .

RUN mkdir -p /data/whisper /data/whisper/models /data/whisper/uploads /data/.cache/huggingface && \
    chown -R user:user /data /app

USER user

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/api/health', timeout=5)"

CMD ["python", "app.py"]
