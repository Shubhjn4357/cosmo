# Whisper AI Mobile App

React Native/Expo app for Whisper AI - works on Android and Web.

## Setup

```bash
npm install
npx expo start
```

## Configuration

Create `.env` file from `.env.example` and add your:

- Supabase URL and anon key
- API Base URL (backend server)
- Google OAuth credentials

### Connecting to Backend

In Settings tab, enter your Whisper AI server URL:

```
https://shubhjn-whisper-ai.hf.space
```

## Features

- 💬 **Chat** - Talk to Whisper AI with optional RAG
- 🖼️ **Image** - Generate images from text
- 📄 **Files** - Upload and analyze documents
- ⚙️ **Settings** - Configure server connection
