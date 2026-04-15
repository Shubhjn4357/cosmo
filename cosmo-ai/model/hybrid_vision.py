"""
Hybrid vision-language model.

This keeps a lightweight local memory of vision embeddings and can:
- persist and search learned visual memories
- use a trained local vision checkpoint when available
- fall back to retrieval-based responses when a real generator is unavailable
"""

from __future__ import annotations

import base64
import re
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from loguru import logger


def _checkpoint_dir() -> Path:
    configured = (Path.cwd() / "checkpoints").resolve()
    return configured


def _tokenize_text(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


class HybridVisionModel:
    """
    Lightweight local vision memory and optional trained-image decoder wrapper.
    """

    def __init__(self):
        self.vision_memory: list[dict[str, Any]] = []
        self.text_to_vision_map: dict[str, list[int]] = {}
        self.learning_enabled = True
        self.trained_model = None
        self.trained_model_path = None
        self._model_load_attempted = False

    def reset_memory(self):
        self.vision_memory = []
        self.text_to_vision_map = {}

    def bootstrap_memory(self, entries: list[dict[str, Any]]):
        self.reset_memory()
        for entry in entries:
            metadata = dict(entry.get("metadata") or {})
            metadata.setdefault("timestamp", entry.get("timestamp"))
            if entry.get("preview_url"):
                metadata["preview_url"] = entry["preview_url"]
            if entry.get("image_url"):
                metadata["image_url"] = entry["image_url"]
            self.add_vision_embedding(
                entry.get("embedding") or [],
                entry.get("text") or "",
                metadata,
                log_entry=False,
            )
        if entries:
            logger.info("Bootstrapped {} vision memories from persisted storage", len(entries))

    def _load_trained_model(self):
        """Load a trained vision model if available."""
        import torch

        model_path = _checkpoint_dir() / "best_model.pt"
        if model_path.exists():
            try:
                from .transformer import MicroTransformer, TransformerConfig
                from .vision_decoder import create_vision_aware_model

                checkpoint = torch.load(model_path, map_location="cpu")
                config = TransformerConfig()
                text_model = MicroTransformer(config)

                vision_model = create_vision_aware_model(text_model, image_size=64)
                vision_model.load_state_dict(checkpoint["model_state_dict"])
                vision_model.eval()

                self.trained_model = vision_model
                self.trained_model_path = str(model_path)
                logger.info("Loaded trained vision model from {}", model_path)
            except Exception as exc:
                logger.warning(f"Failed to load trained model: {exc}")
                self.trained_model = None
        else:
            logger.info("No trained vision model found")

    def _generate_with_trained_model(self, prompt: str) -> Dict[str, Any]:
        """Generate an image using the trained local vision model."""
        import torch
        from PIL import Image

        if self.trained_model is None:
            return {
                "method": "error",
                "message": "Trained model not available",
                "prompt": prompt,
            }

        try:
            from .tokenizer import CosmoTokenizer, create_pretrained_tokenizer

            tokenizer_path = _checkpoint_dir() / "tokenizer.json"
            if tokenizer_path.exists():
                tokenizer = CosmoTokenizer.load(str(tokenizer_path))
            else:
                tokenizer = create_pretrained_tokenizer()

            tokens = tokenizer.encode(prompt, add_special_tokens=True)
            encoded = torch.tensor([tokens], dtype=torch.long)

            with torch.no_grad():
                text_emb = self.trained_model.text_model.token_embedding(encoded)
                text_emb = text_emb.mean(dim=1)
                image_tensor = self.trained_model.generate_image(text_emb)

            image_np = (
                ((image_tensor[0].cpu() + 1) * 127.5)
                .clamp(0, 255)
                .byte()
                .permute(1, 2, 0)
                .numpy()
            )
            pil_image = Image.fromarray(image_np.astype("uint8"), "RGB")

            buffered = BytesIO()
            pil_image.save(buffered, format="PNG")
            img_b64 = base64.b64encode(buffered.getvalue()).decode()

            return {
                "method": "trained_model",
                "message": "Generated using trained vision model",
                "prompt": prompt,
                "generated_image": f"data:image/png;base64,{img_b64}",
                "size": "64x64",
                "model_path": self.trained_model_path,
            }
        except Exception as exc:
            logger.error(f"Error generating with trained model: {exc}")
            return {
                "method": "error",
                "message": f"Generation failed: {str(exc)}",
                "prompt": prompt,
            }

    def add_vision_embedding(
        self,
        embedding: List[float],
        text: str,
        metadata: Dict[str, Any],
        *,
        log_entry: bool = True,
    ):
        """Store a vision embedding with associated text and metadata."""
        normalized_embedding = np.array(embedding, dtype=np.float32)
        self.vision_memory.append(
            {
                "embedding": normalized_embedding,
                "text": text,
                "metadata": metadata,
                "timestamp": metadata.get("timestamp"),
            }
        )

        if text not in self.text_to_vision_map:
            self.text_to_vision_map[text] = []
        self.text_to_vision_map[text].append(len(self.vision_memory) - 1)

        if log_entry:
            logger.info("Stored vision embedding ({} total)", len(self.vision_memory))

    def find_similar_embeddings(self, query_embedding: np.ndarray, top_k: int = 5) -> List[Dict[str, Any]]:
        """Find similar vision embeddings using cosine similarity."""
        if not self.vision_memory:
            return []

        similarities = []
        for idx, memory in enumerate(self.vision_memory):
            numerator = float(np.dot(query_embedding, memory["embedding"]))
            denominator = float(np.linalg.norm(query_embedding) * np.linalg.norm(memory["embedding"])) or 1.0
            similarities.append((idx, numerator / denominator, memory))

        similarities.sort(key=lambda item: item[1], reverse=True)
        return [
            {
                "index": idx,
                "similarity": float(score),
                "text": memory["text"],
                "metadata": memory["metadata"],
            }
            for idx, score, memory in similarities[:top_k]
        ]

    def search_memories(self, prompt: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Search stored memories with lightweight lexical matching."""
        if not self.vision_memory:
            return []

        prompt_tokens = _tokenize_text(prompt)
        scored: list[tuple[float, int, dict[str, Any]]] = []

        for idx, memory in enumerate(self.vision_memory):
            text = str(memory.get("text") or "")
            text_tokens = _tokenize_text(text)
            overlap = len(prompt_tokens & text_tokens)
            union = len(prompt_tokens | text_tokens) or 1
            score = overlap / union if prompt_tokens else 0.0
            if prompt.lower() in text.lower():
                score += 0.35
            score += min(0.1, idx / max(len(self.vision_memory), 1) * 0.1)
            if score > 0:
                scored.append((score, idx, memory))

        if not scored:
            newest = self.vision_memory[-top_k:]
            return [
                {
                    "index": len(self.vision_memory) - len(newest) + offset,
                    "score": 0.0,
                    "text": memory["text"],
                    "metadata": memory["metadata"],
                }
                for offset, memory in enumerate(reversed(newest))
            ]

        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            {
                "index": idx,
                "score": float(score),
                "text": memory["text"],
                "metadata": memory["metadata"],
            }
            for score, idx, memory in scored[:top_k]
        ]

    async def generate_image(
        self,
        prompt: str,
        use_pretrained: bool = True,
        use_trained_model: bool = False,
    ) -> Dict[str, Any]:
        """Generate an image or return the nearest learned visual memories."""
        if use_trained_model and not self._model_load_attempted:
            self._load_trained_model()
            self._model_load_attempted = True

        if use_trained_model and self.trained_model is not None:
            logger.info("Generating with trained model")
            return self._generate_with_trained_model(prompt)

        if use_pretrained:
            return {
                "method": "pretrained",
                "message": "Using pretrained image generation endpoint",
                "prompt": prompt,
                "note": "See /api/image/generate endpoint",
            }

        logger.info("Returning retrieval-based vision memories for prompt")
        examples = self.search_memories(prompt, top_k=5)
        return {
            "method": "retrieval",
            "message": "Returning nearest learned visual memories",
            "prompt": prompt,
            "knowledge_base_size": len(self.vision_memory),
            "retrieval_examples": examples,
            "generated_image": examples[0]["metadata"].get("preview_url") if examples else None,
            "note": "This is retrieval over learned memories, not a full generative decoder output.",
        }

    def get_stats(self) -> Dict[str, Any]:
        """Get model statistics."""
        return {
            "vision_memories": len(self.vision_memory),
            "unique_concepts": len(self.text_to_vision_map),
            "embedding_dimension": len(self.vision_memory[0]["embedding"]) if self.vision_memory else 0,
            "learning_enabled": self.learning_enabled,
            "generation_method": "hybrid (trained decoder + retrieval memory)",
            "trained_model_available": self.trained_model is not None,
            "trained_model_path": self.trained_model_path,
        }


_hybrid_model = None


def get_hybrid_model() -> HybridVisionModel:
    global _hybrid_model
    if _hybrid_model is None:
        _hybrid_model = HybridVisionModel()
    return _hybrid_model
