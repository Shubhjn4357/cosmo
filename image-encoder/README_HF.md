---
title: Image Encoder
emoji: 🖼️
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
---

# Image Encoder Microservice

Converts images to CLIP embeddings for AI learning.

## Features

- Lazy model loading by default
- Vision-only CLIP path when available
- Optional CPU int8 dynamic quantization
- Optional preload and optional keepalive
- Auto-sends to Whisper AI

## Recommended environment variables

```bash
WHISPER_AI_URL=https://your-whisper-ai-space.hf.space
IMAGE_ENCODER_MODEL_ID=openai/clip-vit-base-patch32
IMAGE_ENCODER_DEVICE=cpu
IMAGE_ENCODER_THREADS=4
IMAGE_ENCODER_MAX_IMAGE_DIM=384
IMAGE_ENCODER_PRELOAD=false
IMAGE_ENCODER_QUANTIZE=true
IMAGE_ENCODER_KEEPALIVE=false
```

## Usage

```bash
curl -X POST https://YOUR-SPACE-URL/encode \
  -H "Content-Type: application/json" \
  -d '{"image_base64": "...", "send_to_whisper": true}'
```

See `/docs` for API documentation.
