"""
Sentence-transformers embedder with caching and CPU-friendly defaults.
"""

from __future__ import annotations

import os
import threading
from collections import OrderedDict
from typing import List

# numpy and sentence_transformers imports are deferred to avoid crashing at module
# import time when NumPy ABI is mismatched (cv2 / torch compiled against numpy 1.x).
from loguru import logger


_EMBEDDER_INSTANCE = None
_EMBEDDER_LOCK = threading.Lock()


class SentenceEmbedder:
    """
    Text embedder using sentence-transformers.
    Falls back to deterministic hash embeddings if the model is unavailable.
    """

    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2", dim: int = 384):
        self.dim = dim
        self.model_name = model_name
        self.device = os.getenv("COSMO_EMBEDDER_DEVICE", "cpu").strip() or "cpu"
        self.max_chars = max(128, int(os.getenv("COSMO_EMBEDDER_MAX_CHARS", "1600")))
        self.max_seq_length = max(64, int(os.getenv("COSMO_EMBEDDER_MAX_SEQ_LENGTH", "256")))
        self.batch_size = max(1, int(os.getenv("COSMO_EMBEDDER_BATCH_SIZE", "8")))
        self.normalize_embeddings = os.getenv("COSMO_EMBEDDER_NORMALIZE", "true").lower() == "true"
        self.cache_size = max(0, int(os.getenv("COSMO_EMBEDDER_CACHE_SIZE", "512")))
        self._cache: OrderedDict = OrderedDict()
        self._cache_lock = threading.Lock()
        self.model = None
        self.use_model = False

        try:
            from sentence_transformers import SentenceTransformer  # type: ignore
            logger.info("Loading sentence-transformers model: {}", model_name)
            self.model = SentenceTransformer(model_name, device=self.device)
            if hasattr(self.model, "max_seq_length"):
                self.model.max_seq_length = self.max_seq_length
            self.dim = self.model.get_sentence_embedding_dimension()
            self.use_model = True
            logger.info(
                "Sentence embedder loaded (dim={} device={} max_seq_length={} batch_size={})",
                self.dim,
                self.device,
                self.max_seq_length,
                self.batch_size,
            )
        except Exception as exc:
            logger.warning(
                "sentence-transformers unavailable, using fallback embedder: {}", exc
            )

    def _prepare_text(self, text: str) -> str:
        value = " ".join(str(text or "").split())
        if len(value) > self.max_chars:
            value = value[: self.max_chars]
        return value

    def _cache_get(self, text: str) -> object | None:
        if self.cache_size <= 0:
            return None
        with self._cache_lock:
            cached = self._cache.get(text)
            if cached is None:
                return None
            self._cache.move_to_end(text)
            return cached.copy()

    def _cache_put(self, text: str, embedding: np.ndarray) -> None:  # type: ignore
        if self.cache_size <= 0:
            return
        with self._cache_lock:
            self._cache[text] = embedding.copy()
            self._cache.move_to_end(text)
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)

    def embed(self, texts: List[str]) -> object:
        import numpy as np
        prepared = [self._prepare_text(text) for text in texts]

        if self.use_model and self.model is not None:
            cached_vectors: list[np.ndarray | None] = [self._cache_get(text) for text in prepared]  # type: ignore
            missing_pairs = [
                (index, text)
                for index, (text, cached) in enumerate(zip(prepared, cached_vectors))
                if cached is None
            ]

            if missing_pairs:
                missing_texts = [text for _, text in missing_pairs]
                encoded = self.model.encode(
                    missing_texts,
                    batch_size=self.batch_size,
                    convert_to_numpy=True,
                    normalize_embeddings=self.normalize_embeddings,
                    show_progress_bar=False,
                ).astype(np.float32)
                for (index, text), embedding in zip(missing_pairs, encoded):
                    cached_vectors[index] = embedding
                    self._cache_put(text, embedding)

            return np.stack([vector for vector in cached_vectors if vector is not None]).astype(np.float32)

        embeddings = []
        for text in prepared:
            import numpy as np
            text_hash = hash(text) % (2**32)
            np.random.seed(text_hash)
            embeddings.append(np.random.randn(self.dim).astype(np.float32))
        return np.array(embeddings)

    def embed_single(self, text: str) -> np.ndarray:  # type: ignore
        return self.embed([text])[0]  # type: ignore


def get_embedder(
    model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
    dim: int = 384,
) -> SentenceEmbedder:
    global _EMBEDDER_INSTANCE

    requested_model = os.getenv("COSMO_EMBEDDER_MODEL", model_name).strip() or model_name
    requested_dim = int(os.getenv("COSMO_EMBEDDER_DIM", str(dim)))
    with _EMBEDDER_LOCK:
        if _EMBEDDER_INSTANCE is None:
            _EMBEDDER_INSTANCE = SentenceEmbedder(requested_model, requested_dim)
        return _EMBEDDER_INSTANCE
