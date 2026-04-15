---
title: Image Encoder
emoji: 🖼️
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
---

# Image Encoder

CLIP-based image encoding service for AI learning.

## Features
- Lazy model loading by default
- Vision-only CLIP path when supported by the installed `transformers` version
- Optional CPU int8 dynamic quantization
- Optional preload and optional keepalive
- Auto-send to Cosmo AI backend

## Recommended environment variables

```bash
COSMO_AI_URL=https://your-cosmo-ai-space.hf.space
IMAGE_ENCODER_MODEL_ID=openai/clip-vit-base-patch32
IMAGE_ENCODER_DEVICE=cpu
IMAGE_ENCODER_THREADS=4
IMAGE_ENCODER_MAX_IMAGE_DIM=384
IMAGE_ENCODER_PRELOAD=false
IMAGE_ENCODER_QUANTIZE=true
IMAGE_ENCODER_KEEPALIVE=false
```

## API

See `/docs` for OpenAPI documentation.
