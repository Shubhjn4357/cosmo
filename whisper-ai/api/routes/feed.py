"""
Vision feed routes.

This route persists learned vision embeddings under the managed data root,
stores optional preview thumbnails under uploads, and exposes a lightweight
retrieval-based local vision response when a trained decoder is unavailable.
"""

from __future__ import annotations

import base64
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from loguru import logger
from pydantic import BaseModel

from model.hybrid_vision import get_hybrid_model
from utils.app_paths import DATA_ROOT, UPLOADS_DIR, ensure_app_dirs

router = APIRouter()

VISION_DATA_DIR = DATA_ROOT / "vision"
VISION_DATA_PATH = VISION_DATA_DIR / "feed.jsonl"
VISION_PREVIEWS_DIR = UPLOADS_DIR / "vision-feed"
MAX_VISION_STORE = int(os.getenv("WHISPER_MAX_VISION_STORE", "1000"))

vision_data_store: list[dict[str, Any]] = []
_vision_bootstrapped = False


def _ensure_vision_dirs():
    ensure_app_dirs()
    VISION_DATA_DIR.mkdir(parents=True, exist_ok=True)
    VISION_PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)


def _decode_data_url(data_url: str) -> bytes:
    if "," not in data_url:
        raise ValueError("Malformed image data URL")
    _, encoded = data_url.split(",", 1)
    return base64.b64decode(encoded)


def _write_preview_file(preview_bytes: bytes) -> str:
    _ensure_vision_dirs()
    preview_name = f"{uuid.uuid4().hex}.png"
    preview_path = VISION_PREVIEWS_DIR / preview_name
    preview_path.write_bytes(preview_bytes)
    return f"/static/vision-feed/{preview_name}"


def _normalize_entry(entry: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(entry)
    normalized["embedding"] = [float(value) for value in (entry.get("embedding") or [])]
    normalized["text"] = str(entry.get("text") or "")
    normalized["source"] = str(entry.get("source") or "image-encoder")
    normalized["dimension"] = int(entry.get("dimension") or len(normalized["embedding"]))
    normalized["timestamp"] = entry.get("timestamp") or datetime.now().isoformat()
    if entry.get("preview_url"):
        normalized["preview_url"] = entry["preview_url"]
    if entry.get("image_url"):
        normalized["image_url"] = entry["image_url"]
    if entry.get("metadata"):
        normalized["metadata"] = dict(entry["metadata"])
    else:
        normalized["metadata"] = {}
    return normalized


def _append_vision_entry(entry: dict[str, Any]):
    _ensure_vision_dirs()
    with VISION_DATA_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _trim_persisted_entries():
    if not VISION_DATA_PATH.exists():
        return
    lines = VISION_DATA_PATH.read_text(encoding="utf-8").splitlines()
    if len(lines) <= MAX_VISION_STORE:
        return
    trimmed = lines[-MAX_VISION_STORE:]
    VISION_DATA_PATH.write_text("\n".join(trimmed) + "\n", encoding="utf-8")


def _bootstrap_vision_store():
    global _vision_bootstrapped
    if _vision_bootstrapped:
        return

    _ensure_vision_dirs()
    vision_data_store.clear()

    if VISION_DATA_PATH.exists():
        with VISION_DATA_PATH.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = _normalize_entry(json.loads(line))
                    vision_data_store.append(entry)
                except Exception as exc:
                    logger.warning(f"Skipping malformed vision feed row: {exc}")

    if len(vision_data_store) > MAX_VISION_STORE:
        del vision_data_store[:-MAX_VISION_STORE]

    get_hybrid_model().bootstrap_memory(vision_data_store)
    _vision_bootstrapped = True


def store_vision_data(
    embedding: List[float],
    text_representation: str,
    source: str = "image-encoder",
    *,
    image_url: Optional[str] = None,
    image_data_url: Optional[str] = None,
    preview_bytes: Optional[bytes] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> dict:
    """Store a vision embedding, persist it, and feed it into the hybrid model."""
    _bootstrap_vision_store()

    preview_url = None
    if preview_bytes:
        preview_url = _write_preview_file(preview_bytes)
    elif image_data_url:
        preview_url = _write_preview_file(_decode_data_url(image_data_url))

    vision_entry = _normalize_entry(
        {
            "embedding": embedding,
            "text": text_representation,
            "source": source,
            "dimension": len(embedding),
            "timestamp": datetime.now().isoformat(),
            "preview_url": preview_url,
            "image_url": image_url,
            "metadata": metadata or {},
        }
    )

    vision_data_store.append(vision_entry)
    if len(vision_data_store) > MAX_VISION_STORE:
        del vision_data_store[:-MAX_VISION_STORE]

    _append_vision_entry(vision_entry)
    _trim_persisted_entries()

    hybrid_model = get_hybrid_model()
    entry_metadata = dict(vision_entry.get("metadata") or {})
    entry_metadata.setdefault("timestamp", vision_entry["timestamp"])
    if preview_url:
        entry_metadata["preview_url"] = preview_url
    if image_url:
        entry_metadata["image_url"] = image_url
    hybrid_model.add_vision_embedding(
        embedding,
        text_representation,
        entry_metadata,
    )

    return {
        "entry": vision_entry,
        "stored_count": len(vision_data_store),
        "model_knowledge": hybrid_model.get_stats(),
        "persisted_path": str(VISION_DATA_PATH),
    }


class VisionFeedRequest(BaseModel):
    """Vision data from a local or remote image encoder."""

    embedding: List[float]
    text_representation: str
    source: str = "image-encoder"
    image_url: Optional[str] = None
    image_data_url: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


@router.post("/vision")
async def receive_vision_data(data: VisionFeedRequest):
    """
    Receive encoded image data and feed it into local vision memory.
    """
    try:
        stored = store_vision_data(
            embedding=data.embedding,
            text_representation=data.text_representation,
            source=data.source,
            image_url=data.image_url,
            image_data_url=data.image_data_url,
            metadata=data.metadata,
        )

        logger.info(f"Received and learned vision data from {data.source} ({len(data.embedding)}D embedding)")

        return {
            "success": True,
            "message": "Vision data received and learned",
            "stored_count": stored["stored_count"],
            "persisted_path": stored["persisted_path"],
            "entry": {
                "preview_url": stored["entry"].get("preview_url"),
                "image_url": stored["entry"].get("image_url"),
                "source": stored["entry"].get("source"),
                "timestamp": stored["entry"].get("timestamp"),
            },
            "model_knowledge": stored["model_knowledge"],
        }
    except Exception as exc:
        logger.error(f"Failed to process vision data: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/vision/stats")
async def vision_stats():
    """Get statistics about persisted vision data and model knowledge."""
    _bootstrap_vision_store()
    hybrid_model = get_hybrid_model()

    return {
        "storage": {
            "total_images": len(vision_data_store),
            "max_capacity": MAX_VISION_STORE,
            "embedding_dimension": vision_data_store[0]["dimension"] if vision_data_store else 0,
            "sources": sorted({item["source"] for item in vision_data_store}),
            "persisted_path": str(VISION_DATA_PATH),
            "persisted_entries": len(vision_data_store),
            "preview_directory": str(VISION_PREVIEWS_DIR),
        },
        "model": hybrid_model.get_stats(),
        "capabilities": {
            "can_learn": True,
            "can_generate": True,
            "generation_method": "hybrid (trained decoder + retrieval memory)",
        },
    }


@router.get("/vision/sample")
async def get_vision_sample(count: int = 5):
    """Get a sample of stored vision data."""
    _bootstrap_vision_store()
    samples = vision_data_store[-count:] if vision_data_store else []
    return {
        "samples": [
            {
                "text": item["text"],
                "dimension": item["dimension"],
                "source": item["source"],
                "timestamp": item.get("timestamp"),
                "preview_url": item.get("preview_url"),
                "image_url": item.get("image_url"),
            }
            for item in samples
        ],
        "total_available": len(vision_data_store),
    }


class VisionGenerateRequest(BaseModel):
    user_id: Optional[str] = None
    session_id: Optional[str] = None


@router.post("/upload")
async def upload_feed_files(
    files: List[UploadFile] = File(...),
    source: str = Form(default="mobile_app"),
):
    """
    Upload mixed files from the mobile app and feed them into knowledge or vision memory.
    """
    from api.route import get_app_state
    from api.routes.analytics import analytics as request_analytics
    from api.routes.collect import _compute_local_image_embedding
    from api.routes.files import FileReader

    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required")

    app_state = get_app_state()
    upload_dir = UPLOADS_DIR / "feed-upload"
    upload_dir.mkdir(parents=True, exist_ok=True)

    processed: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for upload in files:
        filename = Path(upload.filename or f"upload-{uuid.uuid4().hex}").name
        temp_path = upload_dir / f"{uuid.uuid4().hex}-{filename}"

        try:
            content = await upload.read()
            if not content:
                raise ValueError("Uploaded file is empty")

            temp_path.write_bytes(content)
            file_type = FileReader.detect_type(filename)
            if file_type == "unknown":
                raise ValueError("Unsupported file type")

            if file_type == "image":
                embedding = _compute_local_image_embedding(content)
                stored = store_vision_data(
                    embedding=embedding,
                    text_representation=f"{filename} uploaded from {source}",
                    source=source,
                    preview_bytes=content,
                    metadata={
                        "filename": filename,
                        "file_type": file_type,
                        "uploaded_via": "feed-upload",
                    },
                )
                processed.append(
                    {
                        "filename": filename,
                        "file_type": file_type,
                        "stored": "vision",
                        "preview_url": stored["entry"].get("preview_url"),
                    }
                )
                continue

            result = await FileReader.read(temp_path, file_type)
            text_content = str(result.get("content") or "").strip()
            if not text_content:
                raise ValueError("No readable content extracted")

            chunks_indexed = 0
            if app_state.rag is not None:
                chunks_indexed = app_state.rag.index_document(text_content, source=f"{source}:{filename}")
                if chunks_indexed:
                    request_analytics.record_knowledge_added(chunks_indexed)
                    if app_state.vectordb is not None:
                        app_state.vectordb.save()

            processed.append(
                {
                    "filename": filename,
                    "file_type": file_type,
                    "stored": "knowledge",
                    "characters": len(text_content),
                    "chunks_indexed": chunks_indexed,
                }
            )
        except Exception as exc:
            errors.append({"filename": filename, "error": str(exc)})
        finally:
            if temp_path.exists():
                temp_path.unlink()

    return {
        "success": bool(processed),
        "processed": len(processed),
        "failed": len(errors),
        "results": processed,
        "errors": errors,
        "source": source,
    }


@router.post("/vision/generate")
async def generate_from_learning(
    prompt: str,
    use_pretrained: bool = True,
    use_trained_model: bool = False,
    request: Optional[VisionGenerateRequest] = None,
):
    """
    Generate an image using learned knowledge or return retrieval matches.
    """
    _bootstrap_vision_store()
    hybrid_model = get_hybrid_model()

    if request and request.user_id:
        logger.info(f"Vision generation requested by user: {request.user_id}")

    return await hybrid_model.generate_image(
        prompt,
        use_pretrained=use_pretrained,
        use_trained_model=use_trained_model,
    )
