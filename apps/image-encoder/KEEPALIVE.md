# Image Encoder - Keepalive Configuration

## How Keepalive Works

The image-encoder has a **built-in keepalive mechanism** that prevents HuggingFace Spaces from pausing.

## Features

### 🔄 Automatic Self-Ping

- Pings itself every **30 minutes** via HTTP
- Starts automatically on service startup
- Runs in background (non-blocking)

### 🎯 How It Works

```
[Service starts]
    ↓
[Wait 2 minutes for full startup]
    ↓
[Every 30 minutes:]
    ↓
[GET /ping endpoint]
    ↓
[Logs success/failure]
    ↓
[Repeat forever]
```

### 📊 Monitoring

View keepalive status in logs:

```
🏓 Keepalive started - will ping https://your-space.hf.space/ping every 30 minutes
🏓 Keepalive ping successful
```

### 🚀 Manual Trigger

You can manually trigger keepalive:

```bash
curl -X POST https://YOUR-USERNAME-image-encoder.hf.space/keepalive/trigger
```

This also pings cosmo-ai to keep both services alive!

## Environment Variables

Set `SPACE_HOST` to your HuggingFace Space URL (optional):

```
SPACE_HOST=https://username-image-encoder.hf.space
```

If not set, auto-detects from HuggingFace environment.

## Why Every 30 Minutes?

- HuggingFace pauses spaces after **48 hours** of no activity
- HTTP requests count as activity
- 30-minute interval is safe and efficient
- Conserves resources while staying active

## Failsafe

If a ping fails:

- ❌ Logs the error
- ✅ Continues trying
- ✅ Doesn't crash the service

The keepalive loop is resilient and won't stop even if individual pings fail.

## Combined with Cosmo-AI

Both services can keep each other alive:

1. **image-encoder** pings itself every 30 min
2. **cosmo-ai** has its own HF model keepalive
3. They ping each other when exchanging data

Result: **Both services stay active 24/7 on free tier!** 🎉
