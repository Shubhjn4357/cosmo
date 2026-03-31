"""
Canonical approved model catalog for Whisper server and mobile clients.

The catalog intentionally separates:
- safe default text/image models
- explicit 18+ / unrestricted models
- remote API models vs downloadable artifacts
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal


ProviderType = Literal["downloadable", "hf_inference", "hybrid"]
GenerationMode = Literal["text", "image", "image_edit"]


def _hf_download_url(repo_id: str, filename: str) -> str:
    return f"https://huggingface.co/{repo_id}/resolve/main/{filename}"


@dataclass(frozen=True)
class TextModelSpec:
    id: str
    name: str
    description: str
    repo_id: str
    filename: str
    size_mb: int
    ram_required_gb: float
    speed: str
    quantization: str
    recommended: bool = False
    adult: bool = False
    supports_local: bool = True
    supports_server: bool = True
    roles: tuple[str, ...] = ("chat",)
    auto_bootstrap: bool = True

    @property
    def provider(self) -> ProviderType:
        return "downloadable"

    @property
    def download_url(self) -> str:
        return _hf_download_url(self.repo_id, self.filename)

    def to_payload(self) -> dict:
        return {
            **asdict(self),
            "provider": self.provider,
            "download_url": self.download_url,
            "kind": "text",
        }


@dataclass(frozen=True)
class ImageModelSpec:
    id: str
    name: str
    description: str
    provider: ProviderType
    repo_id: str
    generation_mode: GenerationMode
    filename: str = ""
    size_mb: int = 0
    ram_required_gb: float = 0.0
    speed: str = "medium"
    quantization: str = ""
    recommended: bool = False
    adult: bool = False
    supports_local: bool = False
    supports_server: bool = True
    supports_text_prompt: bool = True
    auto_bootstrap: bool = False
    tags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def download_url(self) -> str:
        if not self.filename:
            return ""
        return _hf_download_url(self.repo_id, self.filename)

    @property
    def downloadable(self) -> bool:
        return bool(self.filename) and self.provider in {"downloadable", "hybrid"}

    def to_payload(self) -> dict:
        return {
            **asdict(self),
            "download_url": self.download_url,
            "downloadable": self.downloadable,
            "kind": "image",
        }


APPROVED_TEXT_MODELS: tuple[TextModelSpec, ...] = (
    TextModelSpec(
        id="qwen3-1.7b-q4km",
        name="Qwen3 1.7B GGUF",
        description="Best tiny default for fast general chat, coding, and memory-light CPU serving.",
        repo_id="unsloth/Qwen3-1.7B-GGUF",
        filename="Qwen3-1.7B-Q4_K_M.gguf",
        size_mb=1500,
        ram_required_gb=2.2,
        speed="fast",
        quantization="Q4_K_M",
        recommended=True,
        roles=("chat", "coding", "assistant"),
    ),
    TextModelSpec(
        id="llama-3.2-1b-q4km",
        name="Llama 3.2 1B GGUF",
        description="Ultra-light fallback for low-memory phones and the lightest server path.",
        repo_id="llmware/llama-3.2-1b-gguf",
        filename="Llama-3.2-1B-Instruct-Q4_K_M.gguf",
        size_mb=820,
        ram_required_gb=1.4,
        speed="very_fast",
        quantization="Q4_K_M",
        roles=("chat", "fallback"),
    ),
    TextModelSpec(
        id="qwen3-4b-q4km",
        name="Qwen3 4B Instruct GGUF",
        description="Higher-quality small instruct model when more RAM is available.",
        repo_id="prithivMLmods/Qwen3-4B-Instruct-2507-GGUF",
        filename="Qwen3-4B-Instruct-2507.Q4_K_M.gguf",
        size_mb=2900,
        ram_required_gb=4.4,
        speed="medium",
        quantization="Q4_K_M",
        roles=("chat", "coding", "assistant"),
    ),
    TextModelSpec(
        id="gemma-3-4b-q4km",
        name="Gemma 3 4B IT GGUF",
        description="Strong general-purpose small open model with clean instruction following.",
        repo_id="unsloth/gemma-3-4b-it-GGUF",
        filename="gemma-3-4b-it-Q4_K_M.gguf",
        size_mb=3000,
        ram_required_gb=4.5,
        speed="medium",
        quantization="Q4_K_M",
        roles=("chat", "assistant"),
    ),
    TextModelSpec(
        id="deepseek-r1-distill-qwen-7b-q4km",
        name="DeepSeek R1 Distill Qwen 7B GGUF",
        description="Reasoning-first server model for deeper answers and better structured planning.",
        repo_id="lmstudio-community/DeepSeek-R1-Distill-Qwen-7B-GGUF",
        filename="DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",
        size_mb=4700,
        ram_required_gb=6.8,
        speed="slow",
        quantization="Q4_K_M",
        roles=("chat", "reasoning", "coding"),
    ),
    TextModelSpec(
        id="nsfw-rp-3.2-1b-q4km",
        name="NSFW RP 3.2 1B GGUF",
        description="Tiny unrestricted roleplay model for low-memory adult chat mode.",
        repo_id="Novaciano/NSFW_RP-3.2-1B-GGUF",
        filename="NSFW_RP-3.2-1B-Q4_K_M.gguf",
        size_mb=820,
        ram_required_gb=1.5,
        speed="very_fast",
        quantization="Q4_K_M",
        adult=True,
        roles=("roleplay", "adult", "chat"),
    ),
    TextModelSpec(
        id="llama-3.2-3b-abliterated-q4km",
        name="Llama 3.2 3B Abliterated GGUF",
        description="Main unrestricted small model for adult chat and uncensored assistant behavior.",
        repo_id="QuantFactory/Llama-3.2-3B-Instruct-abliterated-GGUF",
        filename="Llama-3.2-3B-Instruct-abliterated.Q4_K_M.gguf",
        size_mb=2100,
        ram_required_gb=3.4,
        speed="fast",
        quantization="Q4_K_M",
        adult=True,
        roles=("adult", "chat", "roleplay"),
    ),
    TextModelSpec(
        id="rogue-creative-7b-q4km",
        name="Rogue Creative Uncensored 7B GGUF",
        description="Higher-quality adult roleplay and creative writing model for unrestricted server mode.",
        repo_id="DavidAU/L3.2-Rogue-Creative-Instruct-Uncensored-Abliterated-7B-GGUF",
        filename="L3.2-Rogue-Creative-Instruct-Uncensored-Abliterated-7B-D_AU-Q4_k_m.gguf",
        size_mb=4800,
        ram_required_gb=6.9,
        speed="slow",
        quantization="Q4_K_M",
        adult=True,
        roles=("adult", "roleplay", "creative"),
    ),
)


APPROVED_IMAGE_MODELS: tuple[ImageModelSpec, ...] = (
    ImageModelSpec(
        id="flux-schnell",
        name="FLUX.1 Schnell",
        description="Fastest practical default for server text-to-image requests.",
        provider="hf_inference",
        repo_id="black-forest-labs/FLUX.1-schnell",
        filename="flux1-schnell.safetensors",
        generation_mode="image",
        size_mb=12000,
        ram_required_gb=12.0,
        speed="fast",
        quantization="fp16",
        recommended=True,
        supports_local=False,
        supports_server=True,
        supports_text_prompt=True,
        auto_bootstrap=False,
        tags=("default", "fast"),
    ),
    ImageModelSpec(
        id="flux-schnell-gguf-q4ks",
        name="FLUX.1 Schnell GGUF Q4",
        description="Compact downloadable FLUX model for background preparation and CPU-friendly storage.",
        provider="downloadable",
        repo_id="city96/FLUX.1-schnell-gguf",
        filename="flux1-schnell-Q4_K_S.gguf",
        generation_mode="image",
        size_mb=6500,
        ram_required_gb=8.0,
        speed="medium",
        quantization="Q4_K_S",
        recommended=True,
        supports_local=True,
        supports_server=True,
        supports_text_prompt=True,
        auto_bootstrap=True,
        tags=("downloadable", "flux"),
    ),
    ImageModelSpec(
        id="qwen-image",
        name="Qwen-Image",
        description="Latest higher-quality image model family for better text rendering and detailed prompts.",
        provider="hf_inference",
        repo_id="Qwen/Qwen-Image",
        generation_mode="image",
        size_mb=0,
        ram_required_gb=0.0,
        speed="medium",
        recommended=True,
        supports_local=False,
        supports_server=True,
        supports_text_prompt=True,
        auto_bootstrap=False,
        tags=("quality", "text-rendering"),
    ),
    ImageModelSpec(
        id="flux-kontext-dev",
        name="FLUX.1 Kontext Dev",
        description="Instruction-based image editing model. Included for future edit flows after startup.",
        provider="hf_inference",
        repo_id="black-forest-labs/FLUX.1-Kontext-dev",
        filename="flux1-kontext-dev.safetensors",
        generation_mode="image_edit",
        size_mb=12000,
        ram_required_gb=12.0,
        speed="medium",
        quantization="fp16",
        recommended=True,
        supports_local=False,
        supports_server=True,
        supports_text_prompt=False,
        auto_bootstrap=False,
        tags=("edit", "instruction"),
    ),
    ImageModelSpec(
        id="pony-diffusion-v6-xl",
        name="Pony Diffusion V6 XL",
        description="Main unrestricted SDXL family for adult and roleplay image generation.",
        provider="downloadable",
        repo_id="LyliaEngine/Pony_Diffusion_V6_XL",
        filename="ponyDiffusionV6XL_v6StartWithThisOne.safetensors",
        generation_mode="image",
        size_mb=6900,
        ram_required_gb=8.5,
        speed="medium",
        quantization="fp16",
        adult=True,
        supports_local=True,
        supports_server=True,
        supports_text_prompt=True,
        auto_bootstrap=True,
        tags=("adult", "sdxl"),
    ),
    ImageModelSpec(
        id="pony-diffusion-v6-xl-gguf-q8",
        name="Pony Diffusion V6 XL GGUF",
        description="Downloadable unrestricted image GGUF path for future local and CPU experiments.",
        provider="downloadable",
        repo_id="morikomorizz/Pony-Diffusion-V6-XL-GGUF",
        filename="pony_diffusion_v6_xl_Q8_0.gguf",
        generation_mode="image",
        size_mb=8400,
        ram_required_gb=9.0,
        speed="slow",
        quantization="Q8_0",
        adult=True,
        supports_local=True,
        supports_server=True,
        supports_text_prompt=True,
        auto_bootstrap=True,
        tags=("adult", "gguf"),
    ),
    ImageModelSpec(
        id="cyberrealistic-v9",
        name="CyberRealistic V9",
        description="Photorealistic unrestricted image model for adult and realistic prompts.",
        provider="downloadable",
        repo_id="cyberdelia/CyberRealistic",
        filename="CyberRealistic_V9_FP16.safetensors",
        generation_mode="image",
        size_mb=2200,
        ram_required_gb=4.0,
        speed="fast",
        quantization="fp16",
        adult=True,
        supports_local=True,
        supports_server=True,
        supports_text_prompt=True,
        auto_bootstrap=True,
        tags=("adult", "photo"),
    ),
)


TEXT_MODEL_BY_ID = {model.id: model for model in APPROVED_TEXT_MODELS}
IMAGE_MODEL_BY_ID = {model.id: model for model in APPROVED_IMAGE_MODELS}


DEFAULT_TEXT_MODEL_ID = "qwen3-1.7b-q4km"
DEFAULT_ADULT_TEXT_MODEL_ID = "llama-3.2-3b-abliterated-q4km"
DEFAULT_IMAGE_MODEL_ID = "flux-schnell"
DEFAULT_ADULT_IMAGE_MODEL_ID = "cyberrealistic-v9"


def list_text_models(include_adult: bool = True) -> list[dict]:
    return [
        model.to_payload()
        for model in APPROVED_TEXT_MODELS
        if include_adult or not model.adult
    ]


def list_image_models(include_adult: bool = True, include_edit: bool = True) -> list[dict]:
    models = []
    for model in APPROVED_IMAGE_MODELS:
        if not include_adult and model.adult:
            continue
        if not include_edit and model.generation_mode == "image_edit":
            continue
        models.append(model.to_payload())
    return models


def get_text_model(model_id: str) -> TextModelSpec | None:
    return TEXT_MODEL_BY_ID.get(model_id)


def get_image_model(model_id: str) -> ImageModelSpec | None:
    return IMAGE_MODEL_BY_ID.get(model_id)


def bootstrap_text_models() -> tuple[TextModelSpec, ...]:
    return tuple(model for model in APPROVED_TEXT_MODELS if model.auto_bootstrap)


def bootstrap_image_models() -> tuple[ImageModelSpec, ...]:
    return tuple(model for model in APPROVED_IMAGE_MODELS if model.auto_bootstrap)

