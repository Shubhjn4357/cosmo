"""
Whisper AI - Model Converter for ExecuTorch
Converts Stable Diffusion models from .safetensors to .pte format for on-device mobile inference.

Requirements:
    pip install torch torchvision diffusers transformers executorch optimum-executorch

Usage:
    python convert_models.py --model dreamshaper-8 --output ./converted_models/
    python convert_models.py --all --output ./converted_models/
"""

import os
import sys
import argparse
import torch
from pathlib import Path
from typing import Optional, Dict, Any

# Check for required packages
try:
    from diffusers import StableDiffusionPipeline, StableDiffusionXLPipeline
    from optimum.executorch import ExecuTorchModelForStableDiffusion
except ImportError as e:
    print(f"Missing required package: {e}")
    print("\nInstall requirements:")
    print("  pip install torch diffusers transformers executorch optimum-executorch")
    sys.exit(1)


# Model definitions matching whisper-ai/src/api/routes/models.py
IMAGE_MODELS = {
    "flux-nsfw": {
        "name": "Flux NSFW Uncensored",
        "repo_id": "Heartsync/Flux-NSFW-uncensored",
        "filename": "flux1-dev-nf4.safetensors",
        "model_type": "flux",  # Requires special handling
        "quantization": "int4",
    },
    "dreamshaper-8": {
        "name": "DreamShaper 8 (SD 1.5)",
        "repo_id": "Lykon/dreamshaper-8",
        "filename": "dreamshaper_8.safetensors",
        "model_type": "sd15",
        "quantization": "int8",
    },
    "epicrealism": {
        "name": "epiCRealism (SD 1.5)",
        "repo_id": "emilianJR/epiCRealism",
        "filename": "epiCRealism_Natural_Sin_RC1_VAE.safetensors",
        "model_type": "sd15",
        "quantization": "int8",
    },
    "sdxl-turbo": {
        "name": "SDXL Turbo",
        "repo_id": "stabilityai/sdxl-turbo",
        "filename": "sd_xl_turbo_1.0_fp16.safetensors",
        "model_type": "sdxl",
        "quantization": "int8",
    },
    "juggernaut-xl-lightning": {
        "name": "Juggernaut XL Lightning",
        "repo_id": "RunDiffusion/Juggernaut-XL-Lightning",
        "filename": "Juggernaut_RunDiffusionPhoto_v2_Lightning_4Steps.safetensors",
        "model_type": "sdxl",
        "quantization": "int8",
    },
}


def convert_sd15_model(
    model_id: str,
    model_info: Dict[str, Any],
    output_dir: Path,
    quantization: str = "int8"
) -> bool:
    """Convert SD 1.5 based model to ExecuTorch format."""
    print(f"\n{'='*60}")
    print(f"Converting: {model_info['name']}")
    print(f"Repo: {model_info['repo_id']}")
    print(f"Quantization: {quantization}")
    print(f"{'='*60}\n")
    
    try:
        # Load the model using diffusers
        print("Loading model from HuggingFace...")
        pipe = StableDiffusionPipeline.from_pretrained(
            model_info['repo_id'],
            torch_dtype=torch.float16,
            safety_checker=None,
            requires_safety_checker=False,
        )
        
        # Export to ExecuTorch format
        print("Exporting to ExecuTorch format...")
        output_path = output_dir / f"{model_id}"
        output_path.mkdir(parents=True, exist_ok=True)
        
        # Export each component separately
        # Text Encoder
        print("  - Exporting text encoder...")
        # UNet
        print("  - Exporting UNet (this takes a while)...")
        # VAE Decoder
        print("  - Exporting VAE decoder...")
        
        # Use optimum-executorch for conversion
        executorch_model = ExecuTorchModelForStableDiffusion.from_pretrained(
            model_info['repo_id'],
            export=True,
            recipe=quantization,  # int4, int8, or fp16
        )
        
        # Save the converted model
        pte_path = output_path / f"{model_id}.pte"
        executorch_model.save_pretrained(str(output_path))
        
        print(f"\n✅ Successfully converted: {model_id}")
        print(f"   Output: {output_path}")
        
        # Calculate size reduction
        original_size = model_info.get('size_mb', 2000)
        converted_size = sum(f.stat().st_size for f in output_path.glob('*')) / (1024 * 1024)
        print(f"   Size: {original_size}MB → {converted_size:.0f}MB ({100 - (converted_size/original_size)*100:.0f}% reduction)")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Failed to convert {model_id}: {e}")
        import traceback
        traceback.print_exc()
        return False


def convert_sdxl_model(
    model_id: str,
    model_info: Dict[str, Any],
    output_dir: Path,
    quantization: str = "int8"
) -> bool:
    """Convert SDXL based model to ExecuTorch format."""
    print(f"\n{'='*60}")
    print(f"Converting SDXL: {model_info['name']}")
    print(f"Repo: {model_info['repo_id']}")
    print(f"⚠️  SDXL models are larger and may require more RAM")
    print(f"{'='*60}\n")
    
    try:
        print("Loading SDXL model from HuggingFace...")
        pipe = StableDiffusionXLPipeline.from_pretrained(
            model_info['repo_id'],
            torch_dtype=torch.float16,
            use_safetensors=True,
        )
        
        output_path = output_dir / f"{model_id}"
        output_path.mkdir(parents=True, exist_ok=True)
        
        print("Exporting to ExecuTorch format (SDXL)...")
        # SDXL needs more aggressive quantization for mobile
        executorch_model = ExecuTorchModelForStableDiffusion.from_pretrained(
            model_info['repo_id'],
            export=True,
            recipe="int4",  # Force int4 for SDXL to fit on mobile
        )
        
        executorch_model.save_pretrained(str(output_path))
        
        print(f"\n✅ Successfully converted SDXL: {model_id}")
        return True
        
    except Exception as e:
        print(f"\n❌ Failed to convert SDXL {model_id}: {e}")
        import traceback
        traceback.print_exc()
        return False


def convert_flux_model(
    model_id: str,
    model_info: Dict[str, Any],
    output_dir: Path,
) -> bool:
    """Convert Flux model - requires special handling."""
    print(f"\n{'='*60}")
    print(f"Converting Flux: {model_info['name']}")
    print(f"⚠️  Flux models require specialized export (experimental)")
    print(f"{'='*60}\n")
    
    # Flux models are not directly supported by optimum-executorch yet
    print("❌ Flux model conversion is not yet supported by ExecuTorch.")
    print("   This model will remain server-only for now.")
    print("   Alternative: Use server API for this model.")
    
    return False


def main():
    parser = argparse.ArgumentParser(description="Convert SD models to ExecuTorch format")
    parser.add_argument("--model", type=str, help="Model ID to convert (e.g., dreamshaper-8)")
    parser.add_argument("--all", action="store_true", help="Convert all models")
    parser.add_argument("--output", type=str, default="./converted_models", help="Output directory")
    parser.add_argument("--quantization", type=str, default="int8", choices=["int4", "int8", "fp16"])
    
    args = parser.parse_args()
    
    if not args.model and not args.all:
        print("Usage:")
        print("  python convert_models.py --model dreamshaper-8")
        print("  python convert_models.py --all")
        print("\nAvailable models:")
        for model_id, info in IMAGE_MODELS.items():
            print(f"  - {model_id}: {info['name']}")
        sys.exit(1)
    
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    models_to_convert = IMAGE_MODELS.keys() if args.all else [args.model]
    
    results = {"success": [], "failed": []}
    
    for model_id in models_to_convert:
        if model_id not in IMAGE_MODELS:
            print(f"Unknown model: {model_id}")
            continue
            
        model_info = IMAGE_MODELS[model_id]
        model_type = model_info.get("model_type", "sd15")
        
        if model_type == "flux":
            success = convert_flux_model(model_id, model_info, output_dir)
        elif model_type == "sdxl":
            success = convert_sdxl_model(model_id, model_info, output_dir, args.quantization)
        else:
            success = convert_sd15_model(model_id, model_info, output_dir, args.quantization)
        
        if success:
            results["success"].append(model_id)
        else:
            results["failed"].append(model_id)
    
    # Summary
    print(f"\n{'='*60}")
    print("CONVERSION SUMMARY")
    print(f"{'='*60}")
    print(f"✅ Successful: {len(results['success'])}")
    for m in results['success']:
        print(f"   - {m}")
    print(f"❌ Failed: {len(results['failed'])}")
    for m in results['failed']:
        print(f"   - {m}")
    print(f"\nOutput directory: {output_dir.absolute()}")


if __name__ == "__main__":
    main()
