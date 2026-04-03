"""
Data collection service for legal public sources.

This route set collects text and image data from allowlisted public sources and
can feed locally-computed vision embeddings into the app's learning pipeline.
"""

from __future__ import annotations

import asyncio
import base64
import os
import random
from datetime import datetime
from io import BytesIO
from typing import Dict, List, Optional

import httpx
import numpy as np
from fastapi import APIRouter
from loguru import logger
from PIL import Image, ImageDraw
from pydantic import BaseModel

from api.routes.feed import store_vision_data

router = APIRouter()
AUTO_COLLECTION_TASK = None

TEST_MODE = os.getenv("WHISPER_TEST_MODE", "false").lower() == "true"
LOCAL_EMBEDDING_DIM = 512

TEXT_SOURCE_CATALOG = [
    {
        "name": "Wikipedia AI",
        "license": "CC BY-SA 3.0",
        "type": "encyclopedia",
        "url": "https://en.wikipedia.org/wiki/Artificial_intelligence",
    },
    {
        "name": "Wikipedia ML",
        "license": "CC BY-SA 3.0",
        "type": "encyclopedia",
        "url": "https://en.wikipedia.org/wiki/Machine_learning",
    },
    {
        "name": "Wikipedia NLP",
        "license": "CC BY-SA 3.0",
        "type": "encyclopedia",
        "url": "https://en.wikipedia.org/wiki/Natural_language_processing",
    },
    {
        "name": "Wikipedia Deep Learning",
        "license": "CC BY-SA 3.0",
        "type": "encyclopedia",
        "url": "https://en.wikipedia.org/wiki/Deep_learning",
    },
    {
        "name": "Wikipedia Random",
        "license": "CC BY-SA 3.0",
        "type": "encyclopedia",
        "url": "https://en.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json",
    },
    {
        "name": "Project Gutenberg",
        "license": "Public Domain",
        "type": "books",
        "url": "https://www.gutenberg.org/cache/epub/feeds/today.rss",
    },
    {
        "name": "ZenQuotes",
        "license": "Free API",
        "type": "quotes",
        "url": "https://zenquotes.io/api/random",
    },
]

IMAGE_SOURCE_CATALOG = [
    {
        "name": "NASA Space Search",
        "license": "Public Domain",
        "type": "space imagery",
        "url": "https://images-api.nasa.gov/search?media_type=image&q=space",
    },
    {
        "name": "NASA Earth Search",
        "license": "Public Domain",
        "type": "space imagery",
        "url": "https://images-api.nasa.gov/search?media_type=image&q=earth",
    },
    {
        "name": "NASA Mars Search",
        "license": "Public Domain",
        "type": "space imagery",
        "url": "https://images-api.nasa.gov/search?media_type=image&q=mars",
    },
    {
        "name": "Met Museum Public Domain",
        "license": "CC0",
        "type": "art",
        "url": "https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=public+domain",
    },
    {
        "name": "National Gallery Open Access",
        "license": "Open Access",
        "type": "art",
        "url": "https://api.nga.gov/iiif/presentation/v3/search?q=open+access",
    },
]

DATA_SOURCES = {
    "text": [source["url"] for source in TEXT_SOURCE_CATALOG],
    "images": [source["url"] for source in IMAGE_SOURCE_CATALOG],
}

try:
    from model.hybrid_vision import get_hybrid_model

    VISION_MODEL_AVAILABLE = True
except ImportError:
    VISION_MODEL_AVAILABLE = False
    logger.warning("Vision model not available for training")


collection_stats = {
    "text_collected": 0,
    "images_collected": 0,
    "encoded_locally": 0,
    "remote_mirrors": 0,
    "last_collection": None,
    "last_backend": None,
}


class DataCollectionRequest(BaseModel):
    """Request to collect data."""

    source_type: str = "both"
    count: int = 10
    auto_feed: bool = True


def _collection_backend() -> str:
    backend = os.getenv("IMAGE_ENCODER_BACKEND", "local").strip().lower()
    if backend not in {"local", "auto", "remote"}:
        return "local"
    return backend


def _image_encoder_url() -> Optional[str]:
    value = os.getenv("IMAGE_ENCODER_URL", "").strip()
    return value or None


def _auto_collection_interval_seconds() -> int:
    return max(60, int(os.getenv("AUTO_COLLECTION_INTERVAL_SECONDS", str(60 * 60))))


def _source_domain(url: str) -> str:
    try:
        return url.split("/")[2]
    except Exception:
        return "unknown"


def _synthetic_text_results(count: int) -> List[Dict]:
    samples = [
        {
            "text": "Python emphasizes readability and batteries-included tooling for practical software engineering.",
            "author": "synthetic",
            "url": "test://text/python",
            "source": "SyntheticDocs",
            "type": "text",
        },
        {
            "text": "Retrieval augmented generation improves freshness by separating model weights from current knowledge.",
            "author": "synthetic",
            "url": "test://text/rag",
            "source": "SyntheticDocs",
            "type": "text",
        },
        {
            "text": "Vector databases are useful for semantic recall, but they still need explicit provenance and rebuild controls.",
            "author": "synthetic",
            "url": "test://text/vectors",
            "source": "SyntheticDocs",
            "type": "text",
        },
    ]
    return samples[: max(1, min(count, len(samples)))]


def _synthetic_image_results(count: int) -> List[Dict]:
    samples = [
        {
            "url": "test://image/nasa-space",
            "title": "Synthetic NASA Space",
            "source": "SyntheticNASA",
            "api_url": "test://catalog/nasa-space",
            "type": "image",
        },
        {
            "url": "test://image/museum-art",
            "title": "Synthetic Museum Art",
            "source": "SyntheticMuseum",
            "api_url": "test://catalog/museum-art",
            "type": "image",
        },
        {
            "url": "test://image/clouds",
            "title": "Synthetic Cloud Study",
            "source": "SyntheticGallery",
            "api_url": "test://catalog/clouds",
            "type": "image",
        },
    ]
    return samples[: max(1, min(count, len(samples)))]


def _build_synthetic_image_bytes(seed_text: str) -> bytes:
    image = Image.new("RGB", (96, 96), color=(15, 23, 42))
    draw = ImageDraw.Draw(image)
    color_seed = abs(hash(seed_text)) % 255
    draw.rectangle((8, 8, 88, 88), outline=(color_seed, 160, 200), width=4)
    draw.text((14, 36), seed_text[:10], fill=(240, 245, 250))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


async def fetch_url_data(url: str) -> Optional[Dict]:
    """
    Generic URL fetcher for the allowlisted source catalog.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, follow_redirects=True)
            if response.status_code != 200:
                return None

            try:
                data = response.json()
            except ValueError:
                if "wikipedia.org/wiki/" in url:
                    topic = url.split("/wiki/")[-1].split("?")[0]
                    return {
                        "url": url,
                        "topic": topic.replace("_", " "),
                        "source": "Wikipedia",
                        "type": "text",
                    }
                return None

            image_url = None
            title = "Image"

            if isinstance(data, dict):
                image_url = (
                    data.get("url")
                    or data.get("urls", {}).get("regular")
                    or data.get("primaryImage")
                    or data.get("image_url")
                )
                title = (
                    data.get("title")
                    or data.get("description")
                    or data.get("alt_description")
                    or "Image"
                )

                if not image_url and "collection" in data:
                    items = data.get("collection", {}).get("items", [])
                    if items:
                        item = items[0]
                        links = item.get("links") or []
                        if links:
                            image_url = links[0].get("href")
                        item_data = item.get("data") or []
                        if item_data:
                            title = item_data[0].get("title", title)

                if not image_url and "objectIDs" in data:
                    object_ids = data.get("objectIDs") or []
                    if object_ids:
                        base_url = url.split("/search")[0] if "/search" in url else url
                        object_url = f"{base_url}/objects/{object_ids[0]}"
                        object_response = await client.get(object_url)
                        if object_response.status_code == 200:
                            object_data = object_response.json()
                            image_url = object_data.get("primaryImage")
                            title = object_data.get("title", title)

            elif isinstance(data, list) and data:
                first = data[0]
                if isinstance(first, dict):
                    if "q" in first or "text" in first:
                        return {
                            "text": first.get("q") or first.get("text"),
                            "author": first.get("a") or first.get("author"),
                            "url": url,
                            "source": _source_domain(url),
                            "type": "text",
                        }
                    image_url = first.get("url") or first.get("urls", {}).get("regular")
                    title = first.get("title") or first.get("description") or title

            if image_url:
                return {
                    "url": image_url,
                    "title": title,
                    "source": _source_domain(url),
                    "api_url": url,
                    "type": "image",
                }
    except Exception as exc:
        logger.debug(f"Could not fetch {url}: {exc}")

    return None


async def collect_images_from_sources(count: int = 5) -> List[Dict]:
    """Collect images from configured public sources."""
    if TEST_MODE:
        return _synthetic_image_results(count)

    collected: List[Dict] = []
    image_urls = list(DATA_SOURCES["images"])
    urls_to_try = random.sample(image_urls, min(max(count * 2, 1), len(image_urls)))

    for url in urls_to_try:
        if len(collected) >= count:
            break
        result = await fetch_url_data(url)
        if result and result.get("type") == "image":
            collected.append(result)
            logger.info(f"Collected image from {result.get('source')}: {result.get('title', '')[:40]}")

    logger.info(f"Collected {len(collected)} images from {len({item['source'] for item in collected})} sources")
    return collected


async def collect_text_from_sources(count: int = 10) -> List[Dict]:
    """Collect text from configured public sources."""
    if TEST_MODE:
        return _synthetic_text_results(count)

    collected: List[Dict] = []
    text_urls = list(DATA_SOURCES["text"])
    urls_to_try = random.sample(text_urls, min(max(count, 1), len(text_urls)))

    for url in urls_to_try:
        result = await fetch_url_data(url)
        if result and result.get("type") == "text":
            collected.append(result)
            logger.info(f"Collected text from {result.get('source')}")

    logger.info(f"Collected {len(collected)} texts")
    return collected


async def _download_image_bytes(image_url: str) -> Optional[bytes]:
    if image_url.startswith("test://"):
        return _build_synthetic_image_bytes(image_url.rsplit("/", 1)[-1])

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(image_url, follow_redirects=True)
            if response.status_code != 200:
                logger.warning(f"Failed to download image from {image_url}: {response.status_code}")
                return None
            return response.content
    except Exception as exc:
        logger.error(f"Image download failed: {exc}")
        return None


def _local_text_representation(image_data: Dict) -> str:
    title = image_data.get("title") or "Untitled image"
    source = image_data.get("source") or "unknown source"
    return f"{title}. Imported from {source} for local vision learning."


def _compute_local_image_embedding(image_bytes: bytes) -> List[float]:
    with Image.open(BytesIO(image_bytes)) as image:
        rgb_image = image.convert("RGB")
        resampling = getattr(Image, "Resampling", Image).BILINEAR
        rgb_small = rgb_image.resize((8, 8), resampling)
        gray_small = rgb_image.convert("L").resize((16, 16), resampling)

        rgb = np.asarray(rgb_small, dtype=np.float32) / 255.0
        gray = np.asarray(gray_small, dtype=np.float32) / 255.0

    gray_features = gray.reshape(-1)
    rgb_features = rgb.reshape(-1)
    histogram_features = [
        np.histogram(channel, bins=16, range=(0.0, 1.0), density=True)[0].astype(np.float32)
        for channel in (rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2], gray)
    ]
    embedding = np.concatenate([gray_features, rgb_features, *histogram_features]).astype(np.float32)

    if embedding.shape[0] != LOCAL_EMBEDDING_DIM:
        embedding = embedding[:LOCAL_EMBEDDING_DIM]
    if embedding.shape[0] < LOCAL_EMBEDDING_DIM:
        embedding = np.pad(embedding, (0, LOCAL_EMBEDDING_DIM - embedding.shape[0]))

    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm
    return embedding.astype(np.float32).tolist()


async def _mirror_to_remote_encoder(image_bytes: bytes, image_encoder_url: str) -> Dict:
    payload = {
        "image_base64": base64.b64encode(image_bytes).decode("ascii"),
        "send_to_whisper": False,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(f"{image_encoder_url.rstrip('/')}/encode", json=payload)
        if response.status_code != 200:
            return {
                "success": False,
                "status_code": response.status_code,
                "detail": response.text[:200],
            }
        body = response.json()
        return {
            "success": True,
            "status_code": response.status_code,
            "dimension": body.get("dimension"),
        }


async def encode_image_for_learning(image_data: Dict) -> Optional[Dict]:
    """
    Encode an image for local learning and optionally mirror it to a remote encoder.
    """
    image_bytes = await _download_image_bytes(image_data["url"])
    if image_bytes is None:
        return None

    embedding = _compute_local_image_embedding(image_bytes)
    text_representation = _local_text_representation(image_data)
    stored = store_vision_data(
        embedding=embedding,
        text_representation=text_representation,
        source=f"collector:{image_data.get('source', 'unknown')}",
        image_url=image_data.get("url"),
        preview_bytes=image_bytes,
        metadata={
            "title": image_data.get("title"),
            "catalog_url": image_data.get("api_url"),
            "collection_type": image_data.get("type"),
            "backend": "collector",
        },
    )

    remote_mirror = None
    backend_mode = _collection_backend()
    image_encoder_url = _image_encoder_url()
    if image_encoder_url and backend_mode in {"auto", "remote"}:
        try:
            remote_mirror = await _mirror_to_remote_encoder(image_bytes, image_encoder_url)
        except Exception as exc:
            remote_mirror = {
                "success": False,
                "detail": str(exc),
            }

    collection_stats["encoded_locally"] += 1
    if remote_mirror and remote_mirror.get("success"):
        collection_stats["remote_mirrors"] += 1

    backend_name = "local"
    if remote_mirror and remote_mirror.get("success"):
        backend_name = "local+remote_mirror"

    return {
        "backend": backend_name,
        "dimension": len(embedding),
        "sent_to_whisper": True,
        "stored_count": stored["stored_count"],
        "text_representation": text_representation,
        "preview_url": stored["entry"].get("preview_url"),
        "image_url": stored["entry"].get("image_url"),
        "remote_mirror": remote_mirror,
    }


async def _run_collection(request: DataCollectionRequest) -> Dict:
    results = {"text": [], "images": [], "encoded": [], "status": "collecting"}

    if request.source_type in {"text", "both"}:
        texts = await collect_text_from_sources(min(request.count, 10))
        results["text"] = texts
        collection_stats["text_collected"] += len(texts)

    if request.source_type in {"images", "both"}:
        images = await collect_images_from_sources(min(request.count, 20))
        results["images"] = images
        collection_stats["images_collected"] += len(images)

        if request.auto_feed:
            for image_data in images[: request.count]:
                encoded = await encode_image_for_learning(image_data)
                if encoded:
                    results["encoded"].append(
                        {
                            "source": image_data["source"],
                            "title": image_data["title"],
                            "dimension": encoded["dimension"],
                            "sent_to_whisper": encoded["sent_to_whisper"],
                            "backend": encoded["backend"],
                            "stored_count": encoded["stored_count"],
                            "preview_url": encoded["preview_url"],
                            "image_url": encoded["image_url"],
                            "remote_mirror": encoded["remote_mirror"],
                        }
                    )

    collection_stats["last_collection"] = datetime.now().isoformat()
    collection_stats["last_backend"] = _collection_backend()

    return {
        "success": True,
        "collected": {
            "text": len(results["text"]),
            "images": len(results["images"]),
            "encoded_and_learned": len(results["encoded"]),
        },
        "data": results,
        "message": f"Collected {len(results['text'])} texts and {len(results['images'])} images",
        "image_encoder_backend": _collection_backend(),
        "image_encoder_url": _image_encoder_url(),
    }


@router.post("/collect")
async def collect_data(request: DataCollectionRequest):
    """Collect public data and optionally feed image samples into the local learner."""
    try:
        return await _run_collection(request)
    except Exception as exc:
        logger.error(f"Collection failed: {exc}")
        return {
            "success": False,
            "error": str(exc),
        }


@router.get("/stats")
async def get_collection_stats():
    """Get collection statistics and active backend settings."""
    return {
        "total_text_collected": collection_stats["text_collected"],
        "total_images_collected": collection_stats["images_collected"],
        "encoded_locally": collection_stats["encoded_locally"],
        "remote_mirrors": collection_stats["remote_mirrors"],
        "last_collection": collection_stats["last_collection"],
        "backend": {
            "mode": _collection_backend(),
            "image_encoder_url": _image_encoder_url(),
            "remote_configured": _image_encoder_url() is not None,
            "test_mode": TEST_MODE,
        },
        "sources": {
            "text": [source["name"] for source in TEXT_SOURCE_CATALOG],
            "images": [source["name"] for source in IMAGE_SOURCE_CATALOG],
        },
        "all_legal": True,
    }


@router.get("/config")
async def get_collection_config():
    """Get collection backend configuration."""
    return {
        "backend": _collection_backend(),
        "image_encoder_url": _image_encoder_url(),
        "remote_configured": _image_encoder_url() is not None,
        "auto_collection_enabled": os.getenv("AUTO_COLLECTION_ENABLED", "true").lower() == "true",
        "auto_collection_interval_seconds": _auto_collection_interval_seconds(),
        "test_mode": TEST_MODE,
        "text_source_count": len(TEXT_SOURCE_CATALOG),
        "image_source_count": len(IMAGE_SOURCE_CATALOG),
    }


@router.get("/sources")
async def list_sources():
    """List the active allowlisted collection sources."""
    return {
        "text_sources": TEXT_SOURCE_CATALOG,
        "image_sources": IMAGE_SOURCE_CATALOG,
        "note": "All collection sources are explicit allowlisted public or open-license endpoints.",
    }


async def auto_collect_loop():
    """Automatically collect data on a fixed interval."""
    interval_seconds = _auto_collection_interval_seconds()

    while True:
        try:
            await asyncio.sleep(interval_seconds)
            logger.info("Auto-collecting public data")
            await _run_collection(DataCollectionRequest(source_type="both", count=10, auto_feed=True))
            await learn_from_collected_data()
        except Exception as exc:
            logger.error(f"Auto-collection failed: {exc}")


async def learn_from_collected_data():
    """
    Process collected data and reinforce recent vision samples into the hybrid model.
    """
    if not VISION_MODEL_AVAILABLE:
        logger.warning("Vision model not loaded; skipping learning")
        return

    try:
        hybrid_model = get_hybrid_model()

        from api.routes.feed import vision_data_store

        if len(vision_data_store) < 10:
            logger.info(f"Not enough data to learn yet ({len(vision_data_store)}/10)")
            return

        learned_count = 0
        for item in vision_data_store[-200:]:
            try:
                hybrid_model.add_vision_embedding(
                    item["embedding"],
                    item["text"],
                    {"source": item["source"], "reinforced": True},
                )
                learned_count += 1
            except Exception as exc:
                logger.error(f"Failed to learn from sample: {exc}")

        stats = hybrid_model.get_stats()
        logger.info(
            "Reinforced %s samples into the hybrid model (concepts=%s dim=%s)",
            learned_count,
            stats["unique_concepts"],
            stats["embedding_dimension"],
        )
    except Exception as exc:
        logger.error(f"Learning failed: {exc}")


async def start_auto_collection_task():
    """Start automatic data collection."""
    global AUTO_COLLECTION_TASK
    if TEST_MODE:
        return
    if os.getenv("AUTO_COLLECTION_ENABLED", "true").lower() != "true":
        logger.info("Auto-collection disabled by configuration")
        return
    if AUTO_COLLECTION_TASK and not AUTO_COLLECTION_TASK.done():
        logger.info("Auto-collection loop already running")
        return
    AUTO_COLLECTION_TASK = asyncio.create_task(auto_collect_loop())
    logger.info("Auto-collection started")


async def stop_auto_collection_task():
    """Stop automatic data collection."""
    global AUTO_COLLECTION_TASK
    if AUTO_COLLECTION_TASK is None:
        return
    if AUTO_COLLECTION_TASK.done():
        AUTO_COLLECTION_TASK = None
        return

    AUTO_COLLECTION_TASK.cancel()
    try:
        await AUTO_COLLECTION_TASK
    except asyncio.CancelledError:
        logger.info("Auto-collection loop stopped")
    finally:
        AUTO_COLLECTION_TASK = None


@router.post("/learn")
async def trigger_learning():
    """Manually trigger reinforcement from collected vision samples."""
    await learn_from_collected_data()

    if VISION_MODEL_AVAILABLE:
        hybrid_model = get_hybrid_model()
        return {
            "success": True,
            "learned": True,
            "stats": hybrid_model.get_stats(),
            "message": "Learning completed",
        }

    return {
        "success": False,
        "message": "Vision model not available",
    }
