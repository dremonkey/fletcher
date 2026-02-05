# Fletcher

A high-performance voice-first bridge for OpenClaw using LiveKit.

## Overview

Fletcher enables real-time voice interactions with OpenClaw through a LiveKit-powered audio pipeline, targeting sub-1.5 second latency for natural conversations.

## Architecture

### OpenClaw LiveKit Plugin (Backend)

- **Runtime:** Bun (TypeScript)
- **Library:** `livekit-server-sdk`
- **Function:**
  - Acts as a participant in a LiveKit room
  - Handles real-time audio streams (STT � OpenClaw Logic � TTS)
  - Integrates with the Vercel AI SDK for orchestration

### Fletcher App (Mobile)

- **Framework:** Flutter (Dart)
- **Library:** `livekit_client`
- **Function:**
  - Simple, one-button (or no-button) interface to join a family room
  - Displays voice intensity via the "Amber Heartbeat" visualizer

## Audio Pipeline (Target: <1.5s)

1. **Mobile App:** Captures audio � Streams to LiveKit Server
2. **Plugin:** Receives stream � Fast-STT (Deepgram/Groq) � OpenClaw Brain
3. **Plugin:** Brain Response � Fast-TTS (Cartesia/ElevenLabs Turbo) � LiveKit Server
4. **Mobile App:** Receives audio stream � Playback

## Setup Requirements

### LiveKit Server

You have two options for running the LiveKit server:

1. **Local Development:** Run LiveKit server locally using the provided `docker-compose` configuration
2. **LiveKit Cloud:** Use the free tier of [LiveKit Cloud](https://livekit.io/) for development and testing

### AI Service Keys (BYOK)

Fletcher uses a bring-your-own-key (BYOK) model for AI services. You'll need to provide your own API keys for:

- **Speech-to-Text:** Deepgram or Groq
- **Text-to-Speech:** Cartesia or ElevenLabs Turbo
- **OpenClaw Brain:** As required by your OpenClaw configuration

## Open Source

- **License:** MIT
- **Repository:** `dremonkey/openclaw-plugin-livekit`
- **Contribution:** Docker Compose configuration provided for plug-and-play community setup

## Architecture Options

Fletcher can be built in three different ways:

1. **External Agent** - Standalone service that communicates with OpenClaw via API/MCP
2. **OpenClaw Channel Plugin** ⭐ - Deep integration as a native OpenClaw channel (like Telegram/WhatsApp)
3. **OpenClaw Tool Plugin** - Voice capabilities as tools the agent can invoke

See the [Architecture Comparison](./docs/architecture-comparison.md) for detailed analysis and recommendations.

**Recommended Approach:** Build as an OpenClaw Channel Plugin for deep integration, automatic conversation management, and unified deployment.

## Getting Started

See the [tasks roadmap](./tasks/README.md) for development progress and next steps.
