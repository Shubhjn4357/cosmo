"""
Dynamic quantization helpers for the scratch-built Whisper transformer.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import torch
import torch.nn as nn

from model.transformer import MicroTransformer, TransformerConfig


def quantize_micro_transformer(model: MicroTransformer) -> nn.Module:
    model = model.cpu().eval()
    return torch.quantization.quantize_dynamic(model, {nn.Linear}, dtype=torch.qint8)


def export_quantized_checkpoint(model: MicroTransformer, path: str | Path):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    quantized = quantize_micro_transformer(model)
    torch.save(
        {
            "config": model.config.__dict__,
            "state_dict": quantized.state_dict(),
            "quantized": True,
        },
        target,
    )


def load_quantized_checkpoint(path: str | Path, device: str = "cpu") -> nn.Module:
    checkpoint: dict[str, Any] = torch.load(path, map_location="cpu")
    config = TransformerConfig(**checkpoint["config"])
    model = MicroTransformer(config)
    quantized = quantize_micro_transformer(model)
    quantized.load_state_dict(checkpoint["state_dict"])
    quantized.eval()
    return quantized.to(device) if hasattr(quantized, "to") else quantized
