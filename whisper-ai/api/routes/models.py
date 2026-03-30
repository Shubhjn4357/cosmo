"""
Whisper AI - Model Catalog API
Provides list of available LLM and Image models for mobile app download.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/models", tags=["models"])


class LLMModel(BaseModel):
    id: str
    name: str
    description: str
    size_mb: int
    ram_required_gb: float
    speed: str  # "fast", "medium", "slow"
    repo_id: str
    filename: str
    quantization: str


class ImageModel(BaseModel):
    id: str
    name: str
    description: str
    size_mb: int
    ram_required_gb: float
    speed: str  # "very_fast", "fast", "medium", "slow", "very_slow"
    repo_id: str
    filename: str
    quantization: str


# Verified GGUF models from HuggingFace - Optimized for Mobile & Server
# Organized by device capability: Ultra-Light -> Light -> Standard -> Power User
LLM_MODELS: List[LLMModel] = [
    # === ULTRA-LIGHT (1-2GB RAM, any phone) ===
    LLMModel(
        id="tinyllama-1.1b",
        name="TinyLlama 1.1B",
        description="Ultra-fast, works on any phone",
        size_mb=700,
        ram_required_gb=1.0,
        speed="fast",
        repo_id="TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF",
        filename="tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
        quantization="Q4_K_M"
    ),
    LLMModel(
        id="qwen-2.5-1.5b",
        name="Qwen 2.5 1.5B (Recommended)",
        description="🚀 Best for older phones. Fast & Smart.",
        size_mb=1000,
        ram_required_gb=1.5,
        speed="fast",
        repo_id="Qwen/Qwen2.5-1.5B-Instruct-GGUF",
        filename="qwen2.5-1.5b-instruct-q4_k_m.gguf",
        quantization="Q4_K_M"
    ),

    # === LIGHT (2-4GB RAM, mid-range phones) ===
    LLMModel(
        id="llama-3.2-3b",
        name="Llama 3.2 3B Instruct",
        description="⭐ Best Balance. Meta's latest small model.",
        size_mb=2000,
        ram_required_gb=2.5,
        speed="fast",
        repo_id="bartowski/Llama-3.2-3B-Instruct-GGUF",
        filename="Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        quantization="Q4_K_M"
    ),
    LLMModel(
        id="llama-3.2-3b-uncensored",
        name="Llama 3.2 3B Uncensored",
        description="🔓 Unfiltered Llama 3.2. fast & free.",
        size_mb=2000,
        ram_required_gb=2.5,
        speed="fast",
        repo_id="huihui-ai/Llama-3.2-3B-Instruct-abliterated-GGUF",
        filename="Llama-3.2-3B-Instruct-abliterated.Q4_K_M.gguf",
        quantization="Q4_K_M"
    ),
    LLMModel(
        id="phi-3.5-mini",
        name="Phi-3.5 Mini (3.8B)",
        description="🧠 Smartest small model. Great at reasoning.",
        size_mb=2400,
        ram_required_gb=3.5,
        speed="medium",
        repo_id="bartowski/Phi-3.5-mini-instruct-GGUF",
        filename="Phi-3.5-mini-instruct-Q4_K_M.gguf",
        quantization="Q4_K_M"
    ),
    
    # === STANDARD (4-8GB RAM, modern phones) ===
    LLMModel(
        id="mistral-7b-v0.3",
        name="Mistral 7B v0.3",
        description="Standard 7B model. Reliable workhorse.",
        size_mb=4300,
        ram_required_gb=5.5,
        speed="slow",
        repo_id="MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF",
        filename="Mistral-7B-Instruct-v0.3.Q4_K_M.gguf",
        quantization="Q4_K_M"
    ),
    LLMModel(
        id="qwen-2.5-7b",
        name="Qwen 2.5 7B Instruct",
        description="👑 Best 7B model. Amazing at coding & logic.",
        size_mb=4700,
        ram_required_gb=6,
        speed="slow",
        repo_id="bartowski/Qwen2.5-7B-Instruct-GGUF",
        filename="Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        quantization="Q4_K_M"
    ),
    LLMModel(
        id="deepseek-r1-distill-7b",
        name="DeepSeek R1 Distill 7B",
        description="🧠 Reasoning Expert. CoT baked in.",
        size_mb=4500,
        ram_required_gb=6,
        speed="slow",
        repo_id="bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF",
        filename="DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",
        quantization="Q4_K_M"
    ),
    LLMModel(
        id="llama-3.1-8b",
        name="Llama 3.1 8B Instruct",
        description="Meta's strong 8B. Good general knowledge.",
        size_mb=4900,
        ram_required_gb=6.5,
        speed="slow",
        repo_id="bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
        filename="Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        quantization="Q4_K_M"
    ),
    
    # === POWER USER (8GB+ RAM) ===
    LLMModel(
        id="gemma-2-9b",
        name="Gemma 2 9B",
        description="Google's open weight model. Very smart.",
        size_mb=5700,
        ram_required_gb=8,
        speed="very_slow",
        repo_id="bartowski/gemma-2-9b-it-GGUF",
        filename="gemma-2-9b-it-Q4_K_S.gguf",
        quantization="Q4_K_S"
    ),
    LLMModel(
        id="mistral-nemo-12b",
        name="Mistral Nemo 12B",
        description="Large 12B model. Requires high-end device.",
        size_mb=7200,
        ram_required_gb=10,
        speed="very_slow",
        repo_id="bartowski/Mistral-Nemo-Instruct-2407-GGUF",
        filename="Mistral-Nemo-Instruct-2407-Q4_K_M.gguf",
        quantization="Q4_K_M"
    ),
]


IMAGE_MODELS: List[ImageModel] = [
    # === RECOMMENDED DEFAULT (HF Inference API) ===
    ImageModel(
        id="dreamshaper-8",
        name="DreamShaper 8 (Default)",
        description="⭐ Best default! Uncensored, great for art & portraits.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="Lykon/dreamshaper-8",
        filename="dreamshaper_8.safetensors",
        quantization="fp16"
    ),
    
    # === UNCENSORED MODELS (HF Inference API) ===
    ImageModel(
        id="absolutereality",
        name="Absolute Reality",
        description="📷 Photorealistic, less filtered. Great for portraits.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="Lykon/AbsoluteReality",
        filename="absolutereality_v181.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="realistic-vision",
        name="Realistic Vision V5.1",
        description="📸 Realistic photos, less filtered.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="SG161222/Realistic_Vision_V5.1_noVAE",
        filename="Realistic_Vision_V5.1.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="anything-v5",
        name="Anything V5",
        description="🎌 Anime style, uncensored.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="stablediffusionapi/anything-v5",
        filename="anything-v5.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="rev-animated",
        name="ReV Animated",
        description="🎌 Anime/cartoon style, uncensored.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="stablediffusionapi/rev-animated",
        filename="rev-animated.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="openjourney",
        name="OpenJourney",
        description="🖼️ Midjourney-style, open source.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="prompthero/openjourney",
        filename="mdjrny-v4.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="deliberate-v3",
        name="Deliberate V3",
        description="🎭 Artistic, versatile, uncensored.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="XpucT/Deliberate",
        filename="Deliberate_v3.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="lyriel",
        name="Lyriel V16",
        description="✨ Fantasy/ethereal style, uncensored.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="stablediffusionapi/lyriel-v16",
        filename="lyriel_v16.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="protogen-x34",
        name="Protogen X3.4",
        description="🤖 Sci-fi/anime hybrid, uncensored.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="darkstorm2150/Protogen_x3.4_Official_Release",
        filename="ProtoGen_X3.4.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="epicrealism",
        name="epiCRealism",
        description="📷 Highly photorealistic people.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="emilianJR/epiCRealism",
        filename="epiCRealism_Natural_Sin_RC1_VAE.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="chilloutmix",
        name="ChilloutMix",
        description="👤 Realistic portraits, Asian aesthetic.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="emilianJR/chilloutmix_NiPrunedFp32Fix",
        filename="chilloutmix_NiPrunedFp32Fix.safetensors",
        quantization="fp16"
    ),
    
    # === FAST TURBO MODELS ===
    ImageModel(
        id="sdxl-turbo",
        name="SDXL Turbo",
        description="🚀 Fastest! 1-step generation.",
        size_mb=6500,
        ram_required_gb=8,
        speed="very_fast",
        repo_id="stabilityai/sdxl-turbo",
        filename="sd_xl_turbo_1.0.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="sd-turbo",
        name="SD Turbo",
        description="🚀 Fast 1-step, smaller than SDXL.",
        size_mb=2100,
        ram_required_gb=4,
        speed="very_fast",
        repo_id="stabilityai/sd-turbo",
        filename="sd_turbo.safetensors",
        quantization="fp16"
    ),
    
    # === LOCAL-ONLY MODELS (for download) ===
    ImageModel(
        id="ssd-1b",
        name="SSD-1B (Local Only)",
        description="⬇️ Download only - not on HF API. Apache 2.0.",
        size_mb=2600,
        ram_required_gb=4,
        speed="fast",
        repo_id="segmind/SSD-1B",
        filename="SSD-1B.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="pixart-sigma",
        name="PixArt-Σ (Local Only)",
        description="⬇️ Download only - not on HF API. Apache 2.0.",
        size_mb=2500,
        ram_required_gb=4,
        speed="fast",
        repo_id="PixArt-alpha/PixArt-Sigma",
        filename="PixArt-Sigma-XL-2-1024-MS.pth",
        quantization="fp16"
    ),
    
    # === FLUX GGUF MODELS (Local Only) ===
    # FLUX.1 Schnell GGUF variants from city96 - freely downloadable
    ImageModel(
        id="flux-schnell-q2",
        name="FLUX.1 Schnell Q2 (Compact)",
        description="⚡ Ultra-compact FLUX. 4GB size, runs on 6GB VRAM.",
        size_mb=4010,
        ram_required_gb=6,
        speed="fast",
        repo_id="city96/FLUX.1-schnell-gguf",
        filename="flux1-schnell-Q2_K.gguf",
        quantization="Q2_K"
    ),
    ImageModel(
        id="flux-schnell-q4",
        name="FLUX.1 Schnell Q4 (Balanced)",
        description="⚡ Best quality/size balance. Recommended for most users.",
        size_mb=6500,
        ram_required_gb=8,
        speed="fast",
        repo_id="city96/FLUX.1-schnell-gguf",
        filename="flux1-schnell-Q4_K_S.gguf",
        quantization="Q4_K_S"
    ),
    ImageModel(
        id="flux-schnell-q8",
        name="FLUX.1 Schnell Q8 (High Quality)",
        description="⚡ High quality FLUX with Q8 quantization.",
        size_mb=12300,
        ram_required_gb=14,
        speed="medium",
        repo_id="city96/FLUX.1-schnell-gguf",
        filename="flux1-schnell-Q8_0.gguf",
        quantization="Q8"
    ),
    
    # === STABLE DIFFUSION 1.5 (Free, no login) ===
    ImageModel(
        id="dreamshaper-8",
        name="DreamShaper 8 (SD 1.5)",
        description="🎨 Best all-rounder. Great for art & portraits.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="Lykon/dreamshaper-8",
        filename="dreamshaper_8.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="epicrealism",
        name="epiCRealism (SD 1.5)",
        description="📷 Photorealistic people. Best for realistic photos.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="emilianJR/epiCRealism",
        filename="epiCRealism_Natural_Sin_RC1_VAE.safetensors",
        quantization="fp16"
    ),
    ImageModel(
        id="deliberate-v3",
        name="Deliberate v3 (SD 1.5)",
        description="🎭 Versatile artistic model. Great for creative images.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="XpucT/Deliberate",
        filename="Deliberate_v3.safetensors",
        quantization="fp16"
    ),
    
    # === STABLE DIFFUSION GGUF (Free, CPU-friendly) ===
    ImageModel(
        id="sd15-gguf-q4",
        name="SD 1.5 GGUF Q4 (CPU-Friendly)",
        description="💻 Runs on CPU! Lower quality but accessible.",
        size_mb=2500,
        ram_required_gb=4,
        speed="slow",
        repo_id="gpustack/stable-diffusion-v1-5-GGUF",
        filename="stable-diffusion-v1-5-Q4_K.gguf",
        quantization="Q4_K"
    ),
    
    # === SDXL TURBO (Free, fast) ===
    ImageModel(
        id="sdxl-turbo",
        name="SDXL Turbo",
        description="🚀 Extremely fast (1 step). High quality, needs 8GB.",
        size_mb=6900,
        ram_required_gb=8,
        speed="very_fast",
        repo_id="stabilityai/sdxl-turbo",
        filename="sd_xl_turbo_1.0_fp16.safetensors",
        quantization="fp16"
    ),
    
    # === JUGGERNAUT (Free, high quality) ===
    ImageModel(
        id="juggernaut-xl-lightning",
        name="Juggernaut XL Lightning",
        description="👑 Top-tier realism. 4-step generation.",
        size_mb=6600,
        ram_required_gb=8,
        speed="medium",
        repo_id="RunDiffusion/Juggernaut-XL-Lightning",
        filename="Juggernaut_RunDiffusionPhoto_v2_Lightning_4Steps.safetensors",
        quantization="fp16"
    ),
    
    # === SD 3.5 GGUF (Free, latest) ===
    ImageModel(
        id="sd35-medium-q4",
        name="SD 3.5 Medium GGUF Q4",
        description="🆕 Latest SD 3.5 in compact GGUF format.",
        size_mb=8000,
        ram_required_gb=10,
        speed="medium",
        repo_id="city96/stable-diffusion-3.5-medium-gguf",
        filename="sd3.5_medium-Q4_K_S.gguf",
        quantization="Q4_K_S"
    ),
    
    # === UNCENSORED MODELS (Open Source, Free, No Filter) ===
    # These models have no safety filters and can generate unrestricted content
    
    # Pony Diffusion V6 XL - SDXL-based, versatile, SFW/NSFW capable
    ImageModel(
        id="pony-diffusion-v6",
        name="🔓 Pony Diffusion V6 XL",
        description="🔥 Uncensored SDXL. Anime/realistic/stylized. No filters.",
        size_mb=6500,
        ram_required_gb=8,
        speed="medium",
        repo_id="AstraliteHeart/pony-diffusion-v6-xl",
        filename="v6.safetensors",
        quantization="fp16"
    ),
    
    # AutismMix SDXL - Top-tier anime uncensored
    ImageModel(
        id="autismmix-sdxl",
        name="🔓 AutismMix SDXL",
        description="🎨 Best anime SDXL. Uncensored, high quality.",
        size_mb=6800,
        ram_required_gb=8,
        speed="medium",
        repo_id="eienmojiki/autismmix-sdxl-safetensor",
        filename="autismmixSDXL_autismmixConfetti.safetensors",
        quantization="fp16"
    ),
    
    # Hassaku XL - Japanese anime style, uncensored
    ImageModel(
        id="hassaku-xl",
        name="🔓 Hassaku XL (Anime)",
        description="🇯🇵 Japanese anime style. Uncensored SDXL.",
        size_mb=6700,
        ram_required_gb=8,
        speed="medium",
        repo_id="Jetstreamdan/hassakuXL",
        filename="hassakuXLPony_v13BetterEyes.safetensors",
        quantization="fp16"
    ),
    
    # CyberRealistic - Photorealistic uncensored
    ImageModel(
        id="cyberrealistic-v4",
        name="🔓 CyberRealistic v4",
        description="📷 Ultra-realistic uncensored. Best for photos.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="cyberdelia/CyberRealistic",
        filename="cyberrealistic_v40.safetensors",
        quantization="fp16"
    ),
    
    # Meina Mix - Anime uncensored SD 1.5
    ImageModel(
        id="meinamix-v11",
        name="🔓 MeinaMix v11 (Anime)",
        description="🎌 Top anime SD 1.5. Uncensored, runs on 4GB.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="Meina/MeinaMix_V11",
        filename="meinamix_meinaV11.safetensors",
        quantization="fp16"
    ),
    
    # AbsoluteReality - Photorealistic uncensored
    ImageModel(
        id="absolutereality-v1",
        name="🔓 AbsoluteReality v1.8",
        description="📸 Photorealistic uncensored. Great for portraits.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="Lykon/AbsoluteReality",
        filename="absolutereality_v181.safetensors",
        quantization="fp16"
    ),
    
    # Counterfeit V3 - Anime uncensored high quality
    ImageModel(
        id="counterfeit-v3",
        name="🔓 Counterfeit V3 (Anime)",
        description="🎨 High-quality anime. Vibrant colors, uncensored.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="gsdf/Counterfeit-V3.0",
        filename="Counterfeit-V3.0_fix_fp16.safetensors",
        quantization="fp16"
    ),
    
    # Anything V5 - Classic anime uncensored
    ImageModel(
        id="anything-v5",
        name="🔓 Anything V5 (Anime)",
        description="🌸 Classic anime model. Uncensored, popular.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="stablediffusionapi/anything-v5",
        filename="anythingV5_PrtRE.safetensors",
        quantization="fp16"
    ),
    
    # ChilloutMix - Photorealistic Asian portraits
    ImageModel(
        id="chilloutmix",
        name="🔓 ChilloutMix",
        description="📷 Asian-style photorealistic. Uncensored portraits.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="emilianJR/chilloutmix_NiPrunedFp32Fix",
        filename="chilloutmix_NiPrunedFp32Fix.safetensors",
        quantization="fp16"
    ),
    
    # ReV Animated - Anime/Semi-realistic uncensored
    ImageModel(
        id="rev-animated",
        name="🔓 ReV Animated v1.2",
        description="🎭 Semi-realistic anime. Uncensored, versatile.",
        size_mb=2100,
        ram_required_gb=4,
        speed="fast",
        repo_id="stablediffusionapi/rev-animated",
        filename="revAnimated_v122EOL.safetensors",
        quantization="fp16"
    ),
]


def _dedupe_by_id(items):
    unique = []
    seen = set()
    for item in items:
        if item.id in seen:
            continue
        unique.append(item)
        seen.add(item.id)
    return unique


@router.get("/llm", response_model=List[LLMModel])
async def get_llm_models():
    """Get list of available LLM models for on-device download."""
    return _dedupe_by_id(LLM_MODELS)


@router.get("/image", response_model=List[ImageModel])
async def get_image_models():
    """Get list of available image generation models."""
    return _dedupe_by_id(IMAGE_MODELS)


@router.get("/llm/{model_id}")
async def get_llm_model(model_id: str):
    """Get specific LLM model details."""
    for model in LLM_MODELS:
        if model.id == model_id:
            return model
    return {"error": "Model not found"}


# === 16GB CPU SERVER OPTIMIZATION ===

class ServerLLMConfig(BaseModel):
    """Optimal llama.cpp configuration for 16GB CPU servers"""
    model_config = {"protected_namespaces": ()}
    
    model_id: str
    model_name: str
    repo_id: str
    filename: str
    # llama.cpp optimization settings
    n_ctx: int  # Context window
    n_batch: int  # Batch size
    n_threads: int  # CPU threads
    n_gpu_layers: int  # GPU layers (0 for CPU-only)
    rope_freq_scale: float  # RoPE scaling
    flash_attn: bool  # Flash attention
    mmap: bool  # Memory mapping
    mlock: bool  # Lock in memory

# Optimal models for 16GB CPU servers with llama.cpp settings
SERVER_16GB_MODELS = [
    ServerLLMConfig(
        model_id="llama-3.1-8b",
        model_name="Llama 3.1 8B Instruct Q4_K_M",
        repo_id="bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
        filename="Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        n_ctx=8192,
        n_batch=512,
        n_threads=8,
        n_gpu_layers=0,
        rope_freq_scale=1.0,
        flash_attn=False,
        mmap=True,
        mlock=False,
    ),
    ServerLLMConfig(
        model_id="mistral-nemo-12b",
        model_name="Mistral Nemo 12B Q4_K_M",
        repo_id="bartowski/Mistral-Nemo-Instruct-2407-GGUF",
        filename="Mistral-Nemo-Instruct-2407-Q4_K_M.gguf",
        n_ctx=8192,
        n_batch=256,
        n_threads=8,
        n_gpu_layers=0,
        rope_freq_scale=1.0,
        flash_attn=False,
        mmap=True,
        mlock=False,
    ),
    ServerLLMConfig(
        model_id="qwen-2.5-7b",
        model_name="Qwen 2.5 7B Instruct Q5_K_M",
        repo_id="bartowski/Qwen2.5-7B-Instruct-GGUF",
        filename="Qwen2.5-7B-Instruct-Q5_K_M.gguf",
        n_ctx=8192,
        n_batch=512,
        n_threads=8,
        n_gpu_layers=0,
        rope_freq_scale=1.0,
        flash_attn=False,
        mmap=True,
        mlock=False,
    ),
    ServerLLMConfig(
        model_id="gemma-2-9b",
        model_name="Gemma 2 9B Q4_K_S",
        repo_id="bartowski/gemma-2-9b-it-GGUF",
        filename="gemma-2-9b-it-Q4_K_S.gguf",
        n_ctx=8192,
        n_batch=256,
        n_threads=8,
        n_gpu_layers=0,
        rope_freq_scale=1.0,
        flash_attn=False,
        mmap=True,
        mlock=False,
    ),
]


@router.get("/server/16gb", response_model=List[ServerLLMConfig])
async def get_server_16gb_models():
    """
    Get optimal LLM models and llama.cpp configurations for 16GB CPU servers.
    
    These settings are optimized for:
    - HuggingFace Spaces (free tier, 16GB RAM)
    - Render.com (free tier)
    - Railway.app
    - Any VPS with 16GB RAM and no GPU
    """
    return SERVER_16GB_MODELS


@router.get("/server/recommended")
async def get_recommended_server_model():
    """
    Get the single most recommended model for 16GB CPU deployment.
    
    Recommendation: Llama 3.1 8B Q4_K_M
    - Best balance of quality and speed
    - Fits comfortably in 16GB RAM
    - Well-optimized for inference
    """
    return {
        "recommended": SERVER_16GB_MODELS[0],
        "reason": "Best balance of quality, speed, and memory usage for 16GB CPU servers",
        "alternatives": [m.model_id for m in SERVER_16GB_MODELS[1:]],
        "deployment_tips": [
            "Use mmap=True to allow model pages to be swapped if needed",
            "Set n_threads to number of CPU cores (8 is common on cloud)",
            "n_ctx=8192 is good for most use cases, reduce to 4096 if memory is tight",
            "n_batch=512 balances speed and memory",
            "For faster first-token latency, preload the model on server start",
        ]
    }

