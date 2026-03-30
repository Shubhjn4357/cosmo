# Image Encoder Microservice 🖼️

**Standalone service for vision-language learning**

## What It Does

Converts any image into:

- ✅ 512-dimensional CLIP embeddings
- ✅ Text representation for LLMs
- ✅ Auto-sends to whisper-ai for learning
- ✅ Runs on FREE HuggingFace CPU tier

## Quick Deploy

1. Create HuggingFace Space:

   - Name: `image-encoder`
   - SDK: **Docker**
   - Hardware: **CPU basic** (free tier)

2. Upload files from `/image-encoder/` folder

3. Update `WHISPER_AI_URL` in `app.py` to your whisper-ai URL

4. Deploy! ✅

## How It Works

```
[User uploads image]
    ↓
[image-encoder processes with CLIP]
    ↓
[Converts to embedding + text]
    ↓
[Sends to whisper-ai /api/feed/vision]
    ↓
[Whisper-AI stores and learns]
```

## API Usage

### Encode Image

```python
import requests
import base64

# Read image
with open("photo.jpg", "rb") as f:
    img_data = base64.b64encode(f.read()).decode()

# Encode and send to whisper-ai
response = requests.post(
    "https://YOUR-USERNAME-image-encoder.hf.space/encode",
    json={
        "image_base64": img_data,
        "send_to_whisper": True  # Auto-send to whisper-ai
    }
)

print(response.json())
```

### Upload File

```python
files = {"file": open("image.png", "rb")}
response = requests.post(
    "https://YOUR-USERNAME-image-encoder.hf.space/encode/upload",
    files=files,
    params={"send_to_whisper": True}
)
```

## Features

### ✅ CPU Optimized

- Uses CLIP-vit-base-patch32 (150MB)
- Fast inference on free CPU
- No GPU needed

### ✅ Auto Keepalive

- Pings itself every 20 minutes
- Prevents space from sleeping
- Always available

### ✅ Whisper-AI Integration

- Automatic data sending
- Vision feed endpoint
- Learning from visual data

## Whisper-AI Integration

Whisper-AI now has `/api/feed/vision` endpoint that:

- ✅ Receives image embeddings
- ✅ Stores up to 1000 images
- ✅ Provides stats and samples
- ✅ Enables vision-language learning

Check stats:

```bash
curl https://shubhjn-whisper-ai.hf.space/api/feed/vision/stats
```

## Architecture

```
┌─────────────────┐      ┌──────────────────┐
│ image-encoder   │──────▶│   whisper-ai     │
│  (CPU Space)    │ REST  │   (Main App)     │
│                 │ API   │                  │
│ • CLIP Model    │       │ • LLM            │
│ • Encoding      │       │ • Chat           │
│ • Keepalive     │       │ • Vision Feed    │
└─────────────────┘       └──────────────────┘
```

## Free & Independent

- 🆓 Both services run on FREE HuggingFace tier
- 🔓 No restrictions, no API limits
- 🚀 Independent microservices
- ♾️ Keepalive prevents sleeping

Deploy and enjoy vision-enabled AI! 🎉
