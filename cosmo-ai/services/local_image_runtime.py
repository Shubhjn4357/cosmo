"""
Local single-file image runtime for approved server checkpoints.

This intentionally supports only locally downloaded single-file checkpoints so
the server never falls back to paid remote inference APIs for image generation.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from loguru import logger


SUPPORTED_SINGLE_FILE_EXTENSIONS = {".safetensors", ".ckpt"}


def supports_single_file_runtime(filename: str) -> bool:
    return Path(filename or "").suffix.lower() in SUPPORTED_SINGLE_FILE_EXTENSIONS


class LocalImageRuntime:
    def __init__(self):
        self._lock = threading.Lock()
        self._pipeline: Any = None
        self._loaded_model_id: str | None = None
        self._loaded_artifact_path: str | None = None

    def _uses_sdxl(self, model: dict[str, Any], artifact_path: Path) -> bool:
        tags = {str(tag).lower() for tag in (model.get("tags") or [])}
        lowered = f"{model.get('id', '')} {artifact_path.name}".lower()
        return "sdxl" in tags or "xl" in lowered

    def _load_pipeline(self, model: dict[str, Any], artifact_path: Path):
        import torch
        from diffusers import StableDiffusionPipeline, StableDiffusionXLPipeline

        if not artifact_path.exists():
            raise RuntimeError(f"Image checkpoint not found: {artifact_path}")
        if not supports_single_file_runtime(artifact_path.name):
            raise RuntimeError(f"Unsupported local image checkpoint format: {artifact_path.suffix}")

        use_sdxl = self._uses_sdxl(model, artifact_path)
        pipeline_cls = StableDiffusionXLPipeline if use_sdxl else StableDiffusionPipeline

        logger.info("Loading local image runtime: {} from {}", model.get("id"), artifact_path)
        pipeline = pipeline_cls.from_single_file(
            str(artifact_path),
            torch_dtype=torch.float32,
            use_safetensors=artifact_path.suffix.lower() == ".safetensors",
            safety_checker=None,
            requires_safety_checker=False,
        )
        pipeline.to("cpu")
        pipeline.enable_attention_slicing()
        try:
            pipeline.set_progress_bar_config(disable=True)
        except Exception:
            pass
        return pipeline

    def _get_pipeline(self, model: dict[str, Any], artifact_path: Path):
        artifact_key = str(artifact_path.resolve())
        model_id = str(model.get("id") or artifact_path.stem)

        if (
            self._pipeline is not None
            and self._loaded_model_id == model_id
            and self._loaded_artifact_path == artifact_key
        ):
            return self._pipeline

        with self._lock:
            if (
                self._pipeline is not None
                and self._loaded_model_id == model_id
                and self._loaded_artifact_path == artifact_key
            ):
                return self._pipeline

            self._pipeline = self._load_pipeline(model, artifact_path)
            self._loaded_model_id = model_id
            self._loaded_artifact_path = artifact_key
            return self._pipeline

    def generate(
        self,
        *,
        model: dict[str, Any],
        artifact_path: str | Path,
        prompt: str,
        negative_prompt: str | None,
        width: int,
        height: int,
        num_steps: int,
        guidance_scale: float,
        seed: int,
    ):
        import torch

        checkpoint_path = Path(artifact_path)
        pipeline = self._get_pipeline(model, checkpoint_path)
        generator = torch.Generator(device="cpu").manual_seed(seed)
        result = pipeline(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=min(width, 1024),
            height=min(height, 1024),
            num_inference_steps=max(1, min(num_steps, 40)),
            guidance_scale=max(0.0, guidance_scale),
            generator=generator,
        )
        return result.images[0]


local_image_runtime = LocalImageRuntime()
