"""
Image encoder microservice.

This service stays lightweight by default:
- lazy-loads the vision encoder instead of preloading on boot
- prefers the vision-only CLIP path when available
- constrains CPU thread usage
- optionally applies dynamic int8 quantization on CPU
- keeps self-ping disabled unless explicitly enabled
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import threading
from typing import Dict, List

import httpx
import numpy as np
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from PIL import Image
from pydantic import BaseModel


def _env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default).lower()).strip().lower() == "true"


def _recommended_threads() -> int:
    cpu_count = max(1, os.cpu_count() or 1)
    return min(4, cpu_count)


COSMO_AI_URL = os.getenv("COSMO_AI_URL", "https://shubhjn-cosmo-ai.hf.space").strip().rstrip("/")
IMAGE_ENCODER_MODEL_ID = os.getenv("IMAGE_ENCODER_MODEL_ID", "openai/clip-vit-base-patch32").strip()
IMAGE_ENCODER_DEVICE = os.getenv("IMAGE_ENCODER_DEVICE", "cpu").strip() or "cpu"
IMAGE_ENCODER_THREADS = max(1, int(os.getenv("IMAGE_ENCODER_THREADS", str(_recommended_threads()))))
IMAGE_ENCODER_MAX_IMAGE_DIM = max(224, int(os.getenv("IMAGE_ENCODER_MAX_IMAGE_DIM", "384")))
IMAGE_ENCODER_PRELOAD = _env_bool("IMAGE_ENCODER_PRELOAD", False)
IMAGE_ENCODER_KEEPALIVE = _env_bool("IMAGE_ENCODER_KEEPALIVE", False)
IMAGE_ENCODER_QUANTIZE = _env_bool("IMAGE_ENCODER_QUANTIZE", IMAGE_ENCODER_DEVICE == "cpu")
IMAGE_ENCODER_KEEPALIVE_INTERVAL_SECONDS = max(
    300,
    int(os.getenv("IMAGE_ENCODER_KEEPALIVE_INTERVAL_SECONDS", str(30 * 60))),
)


def apply_local_tuning() -> None:
    os.environ.setdefault("OMP_NUM_THREADS", str(IMAGE_ENCODER_THREADS))
    os.environ.setdefault("OPENBLAS_NUM_THREADS", str(IMAGE_ENCODER_THREADS))
    os.environ.setdefault("MKL_NUM_THREADS", str(IMAGE_ENCODER_THREADS))
    os.environ.setdefault("NUMEXPR_NUM_THREADS", str(IMAGE_ENCODER_THREADS))
    os.environ.setdefault("VECLIB_MAXIMUM_THREADS", str(IMAGE_ENCODER_THREADS))
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


apply_local_tuning()

# Try to import a leaner vision-only CLIP path first.
try:
    import torch
    from transformers import CLIPImageProcessor, CLIPVisionModelWithProjection

    CLIP_VISION_ONLY_AVAILABLE = True
except ImportError:
    torch = None
    CLIPImageProcessor = None
    CLIPVisionModelWithProjection = None
    CLIP_VISION_ONLY_AVAILABLE = False

try:
    if torch is None:
        import torch
except ImportError:
    torch = None

try:
    from transformers import CLIPModel, CLIPProcessor

    CLIP_FULL_AVAILABLE = True
except ImportError:
    CLIP_FULL_AVAILABLE = False
    CLIPModel = None
    CLIPProcessor = None

CLIP_AVAILABLE = torch is not None and (CLIP_VISION_ONLY_AVAILABLE or CLIP_FULL_AVAILABLE)
if not CLIP_AVAILABLE:
    logger.warning("transformers/torch vision encoder dependencies are unavailable")


if CLIP_AVAILABLE and torch is not None:
    try:
        torch.set_num_threads(IMAGE_ENCODER_THREADS)
    except Exception:
        pass
    try:
        torch.set_num_interop_threads(min(2, IMAGE_ENCODER_THREADS))
    except Exception:
        pass


app = FastAPI(
    title="Image Encoder Service",
    description="Lightweight image encoding service for Cosmo AI",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EncodeRequest(BaseModel):
    image_base64: str
    send_to_cosmo: bool = False


class EncodeResponse(BaseModel):
    embedding: List[float]
    text_representation: str
    dimension: int
    sent_to_cosmo: bool = False


_MODEL_LOCK = threading.Lock()
_clip_model = None
_clip_processor = None
_clip_backend = "unloaded"


def _resize_for_encoding(image: Image.Image) -> Image.Image:
    image = image.convert("RGB")
    resampling = getattr(Image, "Resampling", Image).LANCZOS
    image.thumbnail((IMAGE_ENCODER_MAX_IMAGE_DIM, IMAGE_ENCODER_MAX_IMAGE_DIM), resampling)
    return image


def _apply_dynamic_quantization(model):
    if not (CLIP_AVAILABLE and torch is not None and IMAGE_ENCODER_DEVICE == "cpu" and IMAGE_ENCODER_QUANTIZE):
        return model, False

    try:
        quantized_model = torch.ao.quantization.quantize_dynamic(model, {torch.nn.Linear}, dtype=torch.qint8)
        return quantized_model, True
    except Exception as exc:
        logger.warning("Dynamic quantization skipped: {}", exc)
        return model, False


def load_clip_model():
    global _clip_model, _clip_processor, _clip_backend

    if not CLIP_AVAILABLE:
        raise RuntimeError("CLIP encoder dependencies are not installed")

    if _clip_model is not None and _clip_processor is not None:
        return _clip_model, _clip_processor, _clip_backend

    with _MODEL_LOCK:
        if _clip_model is not None and _clip_processor is not None:
            return _clip_model, _clip_processor, _clip_backend

        logger.info(
            "Loading image encoder model={} device={} preload={} quantize={} max_dim={}",
            IMAGE_ENCODER_MODEL_ID,
            IMAGE_ENCODER_DEVICE,
            IMAGE_ENCODER_PRELOAD,
            IMAGE_ENCODER_QUANTIZE,
            IMAGE_ENCODER_MAX_IMAGE_DIM,
        )

        backend_name = "clip_full"
        if CLIP_VISION_ONLY_AVAILABLE:
            model = CLIPVisionModelWithProjection.from_pretrained(IMAGE_ENCODER_MODEL_ID)
            processor = CLIPImageProcessor.from_pretrained(IMAGE_ENCODER_MODEL_ID)
            backend_name = "clip_vision_projection"
        elif CLIP_FULL_AVAILABLE:
            model = CLIPModel.from_pretrained(IMAGE_ENCODER_MODEL_ID)
            processor = CLIPProcessor.from_pretrained(IMAGE_ENCODER_MODEL_ID)
        else:
            raise RuntimeError("No compatible CLIP image encoder backend is available")

        if IMAGE_ENCODER_DEVICE != "cpu":
            model = model.to(IMAGE_ENCODER_DEVICE)

        model.eval()
        model, quantized = _apply_dynamic_quantization(model)
        if quantized:
            backend_name = f"{backend_name}+int8"

        _clip_model = model
        _clip_processor = processor
        _clip_backend = backend_name
        logger.info("Image encoder ready with backend={}", _clip_backend)

    return _clip_model, _clip_processor, _clip_backend


def _encode_with_loaded_model(image: Image.Image) -> Dict[str, object]:
    model, processor, backend = load_clip_model()
    prepared_image = _resize_for_encoding(image)

    if backend.startswith("clip_vision_projection"):
        inputs = processor(images=prepared_image, return_tensors="pt")
        pixel_values = inputs["pixel_values"]
        if IMAGE_ENCODER_DEVICE != "cpu":
            pixel_values = pixel_values.to(IMAGE_ENCODER_DEVICE)

        with torch.inference_mode():
            outputs = model(pixel_values=pixel_values)
            image_features = outputs.image_embeds
    else:
        inputs = processor(images=prepared_image, return_tensors="pt")
        if IMAGE_ENCODER_DEVICE != "cpu":
            inputs = {key: value.to(IMAGE_ENCODER_DEVICE) for key, value in inputs.items()}

        with torch.inference_mode():
            image_features = model.get_image_features(**inputs)

    embedding = image_features[0].detach().cpu().numpy().astype(np.float32)
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    text_repr = create_text_representation(prepared_image, embedding)
    return {
        "embedding": embedding.tolist(),
        "text_representation": text_repr,
        "dimension": int(embedding.shape[0]),
        "backend": backend,
    }


def encode_image(image: Image.Image) -> Dict[str, object]:
    if not CLIP_AVAILABLE:
        raise RuntimeError("CLIP encoder is unavailable")
    return _encode_with_loaded_model(image)


def create_text_representation(image: Image.Image, embedding: np.ndarray) -> str:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    luminance = float(rgb.mean())
    channel_means = rgb.mean(axis=(0, 1))
    channel_variance = float(rgb.var())
    aspect_ratio = image.width / max(1, image.height)
    chunks = np.array_split(embedding, 12)

    lines = [
        "<vision_input>",
        f"Image size: {image.width}x{image.height}",
        f"Aspect ratio: {aspect_ratio:.2f}",
        f"Brightness: {luminance:.3f}",
        f"Color balance rgb=({channel_means[0]:.3f}, {channel_means[1]:.3f}, {channel_means[2]:.3f})",
        f"Visual variance: {channel_variance:.4f}",
        "Embedding groups:",
    ]
    for index, chunk in enumerate(chunks, start=1):
        lines.append(
            f"- Group {index}: mean={float(chunk.mean()):.4f}, std={float(chunk.std()):.4f}, peak={float(np.max(np.abs(chunk))):.4f}"
        )
    lines.append("</vision_input>")
    return "\n".join(lines)


async def send_to_cosmo_ai(embedding: List[float], text: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{COSMO_AI_URL}/api/feed/vision",
                json={
                    "embedding": embedding,
                    "text_representation": text,
                    "source": "image-encoder",
                },
            )
            return response.status_code == 200
    except Exception as exc:
        logger.error("Failed to send image embedding to cosmo-ai: {}", exc)
        return False


def _service_url() -> str:
    service_url = os.getenv("SPACE_HOST", "http://localhost:7860")
    if not service_url.startswith("http"):
        service_url = f"https://{service_url}"
    return service_url.rstrip("/")


async def keepalive_loop():
    await asyncio.sleep(120)
    service_url = _service_url()
    logger.info(
        "Image encoder keepalive enabled; pinging {} every {}s",
        service_url,
        IMAGE_ENCODER_KEEPALIVE_INTERVAL_SECONDS,
    )

    while True:
        try:
            await asyncio.sleep(IMAGE_ENCODER_KEEPALIVE_INTERVAL_SECONDS)
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{service_url}/ping")
                if response.status_code == 200:
                    logger.info("Image encoder keepalive ping succeeded")
                else:
                    logger.warning("Image encoder keepalive ping returned {}", response.status_code)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Image encoder keepalive failed: {}", exc)


@app.on_event("startup")
async def startup():
    logger.info(
        "Image Encoder Service starting model={} device={} preload={} keepalive={}",
        IMAGE_ENCODER_MODEL_ID,
        IMAGE_ENCODER_DEVICE,
        IMAGE_ENCODER_PRELOAD,
        IMAGE_ENCODER_KEEPALIVE,
    )

    if IMAGE_ENCODER_PRELOAD and CLIP_AVAILABLE:
        load_clip_model()

    if IMAGE_ENCODER_KEEPALIVE:
        asyncio.create_task(keepalive_loop())
    else:
        logger.info("Image encoder keepalive disabled by configuration")


@app.get("/")
async def root():
    return {
        "service": "image-encoder",
        "version": "1.1.0",
        "status": "running",
        "model": IMAGE_ENCODER_MODEL_ID if CLIP_AVAILABLE else "unavailable",
        "backend": _clip_backend,
        "clip_available": CLIP_AVAILABLE,
        "model_loaded": _clip_model is not None,
        "device": IMAGE_ENCODER_DEVICE,
        "threads": IMAGE_ENCODER_THREADS,
        "max_image_dim": IMAGE_ENCODER_MAX_IMAGE_DIM,
        "dynamic_quantization": IMAGE_ENCODER_QUANTIZE and IMAGE_ENCODER_DEVICE == "cpu",
        "cosmo_ai": COSMO_AI_URL,
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "clip_available": CLIP_AVAILABLE,
        "clip_backend": _clip_backend,
        "model_loaded": _clip_model is not None,
        "model_id": IMAGE_ENCODER_MODEL_ID,
        "device": IMAGE_ENCODER_DEVICE,
        "threads": IMAGE_ENCODER_THREADS,
        "keepalive_enabled": IMAGE_ENCODER_KEEPALIVE,
    }


@app.post("/encode", response_model=EncodeResponse)
async def encode_endpoint(request: EncodeRequest, background_tasks: BackgroundTasks):
    try:
        image_data = base64.b64decode(request.image_base64)
        image = Image.open(io.BytesIO(image_data))
        result = encode_image(image)

        sent = False
        if request.send_to_cosmo:
            background_tasks.add_task(
                send_to_cosmo_ai,
                result["embedding"],
                result["text_representation"],
            )
            sent = True

        return EncodeResponse(
            embedding=result["embedding"],
            text_representation=result["text_representation"],
            dimension=result["dimension"],
            sent_to_cosmo=sent,
        )
    except Exception as exc:
        logger.error("Encoding failed: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/encode/upload")
async def encode_upload(file: UploadFile = File(...), send_to_cosmo: bool = False):
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        result = encode_image(image)

        if send_to_cosmo:
            await send_to_cosmo_ai(result["embedding"], result["text_representation"])

        return result
    except Exception as exc:
        logger.error("Upload encoding failed: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/ping")
async def ping():
    return {"status": "alive", "service": "image-encoder"}


@app.post("/keepalive/trigger")
async def trigger_keepalive():
    results = {"self": False, "cosmo_ai": False}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{_service_url()}/ping")
            results["self"] = response.status_code == 200

            response = await client.get(f"{COSMO_AI_URL}/api/ping")
            results["cosmo_ai"] = response.status_code == 200
    except Exception as exc:
        logger.error("Keepalive trigger failed: {}", exc)

    return {
        "triggered": True,
        "results": results,
        "message": "Keepalive pings sent",
    }
