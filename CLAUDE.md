# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Fletcher is a high-performance voice-first bridge for OpenClaw using LiveKit, targeting sub-1.5 second latency for real-time voice conversations. It's built as an **OpenClaw Channel Plugin** that integrates voice capabilities directly into OpenClaw, similar to Telegram and WhatsApp channels.

## Project Structure

Fletcher is a Bun monorepo with two main components:

### Backend: OpenClaw Channel Plugin (`packages/openclaw-channel-livekit`)
- **Runtime:** Bun + TypeScript
- **Purpose:** Acts as a participant in LiveKit rooms, handling real-time audio streams
- **Audio Pipeline:** STT (Deepgram/Groq) → OpenClaw Logic → TTS (Cartesia/ElevenLabs)
- **Integration:** Implements OpenClaw channel plugin interface via the `openclaw` field in package.json
- **Key Files:**
  - `src/channel.ts` - Main channel implementation
  - `src/pipeline/` - STT, TTS, and audio buffering logic
  - `src/livekit/` - LiveKit connection, audio, and participant management

### Frontend: Flutter Mobile App (`apps/mobile`)
- **Framework:** Flutter (Dart)
- **Purpose:** Simple voice interface with one-button room joining
- **Features:** "Amber Heartbeat" audio visualizer for voice intensity
- **Integration:** Uses `livekit_client` package to connect to LiveKit rooms

## Common Commands

### Monorepo Management
```bash
# Install all dependencies
bun install

# Format all code
bun run format
```

### Plugin Development
```bash
# Build the OpenClaw channel plugin
bun run build
# OR: bun --cwd packages/openclaw-channel-livekit run build

# Run plugin in watch mode
bun run plugin:dev
# OR: bun --cwd packages/openclaw-channel-livekit run dev

# Run plugin tests
bun run test
# OR: bun --cwd packages/openclaw-channel-livekit run test

# Lint plugin code
bun run lint
# OR: bun --cwd packages/openclaw-channel-livekit run lint
```

### Mobile App Development
```bash
# Run Flutter app in development
bun run mobile:dev
# OR: cd apps/mobile && flutter run

# Build Android APK
bun run mobile:build:android
# OR: cd apps/mobile && flutter build apk

# Build iOS app
bun run mobile:build:ios
# OR: cd apps/mobile && flutter build ios

# Run Flutter tests
cd apps/mobile && flutter test

# Get Flutter dependencies
cd apps/mobile && flutter pub get
```

### Local Infrastructure
```bash
# Start LiveKit server locally
docker compose up -d

# Stop LiveKit server
docker compose down

# View LiveKit logs
docker compose logs -f livekit
```

The local LiveKit server runs at `http://localhost:7880` with development credentials:
- API Key: `devkey`
- API Secret: `secret`

## Architecture Notes

### OpenClaw Channel Plugin Pattern

Fletcher integrates as an OpenClaw channel plugin, which means:
- **Deep Integration:** Direct access to OpenClaw core, skills, tools, and memory
- **Automatic Management:** OpenClaw handles conversation state and routing
- **Single Deployment:** Runs within the OpenClaw Gateway process
- **Plugin Metadata:** Defined in `package.json` under the `openclaw` field:
  ```json
  "openclaw": {
    "extensions": ["dist/index.js"],
    "channel": {
      "id": "livekit",
      "label": "LiveKit Voice",
      "blurb": "Real-time voice conversations with <1.5s latency"
    }
  }
  ```

### Audio Pipeline Architecture

The plugin orchestrates a real-time audio pipeline:

1. **Mobile App** → Captures audio → Streams to LiveKit Server
2. **Plugin** → Receives audio stream → Fast-STT (Deepgram/Groq) → OpenClaw Brain
3. **Plugin** → Brain response → Fast-TTS (Cartesia/ElevenLabs) → LiveKit Server
4. **Mobile App** → Receives audio stream → Playback

**Latency Target:** <1.5 seconds end-to-end

### Key Components

- **`src/channel.ts`** - Implements the OpenClaw channel interface
- **`src/livekit/connection.ts`** - Manages LiveKit room connection and lifecycle
- **`src/livekit/participant.ts`** - Handles participant join/leave events
- **`src/livekit/audio.ts`** - Manages audio track subscription and publishing
- **`src/pipeline/stt.ts`** - Speech-to-text streaming (Deepgram/Groq)
- **`src/pipeline/tts.ts`** - Text-to-speech synthesis (Cartesia/ElevenLabs)
- **`src/pipeline/buffer.ts`** - Audio buffering and chunking for optimal latency
- **`src/config.ts`** - Configuration management for API keys and service selection

### Monorepo Setup

- **Package Manager:** Bun with workspace support
- **Workspaces:** `packages/*` for shared TypeScript packages
- **Linker:** Isolated linker mode for strict dependency resolution (`"linker": "isolated"`)
- **TypeScript:** Shared base config in `tsconfig.base.json`, extended by packages
- **Strict Mode:** Bun strict mode enabled for type safety

### Configuration Files

- **`livekit.yaml`** - LiveKit server configuration (development keys)
- **`docker-compose.yml`** - Local LiveKit server and ingress setup
- **`tsconfig.base.json`** - Shared TypeScript configuration
- **`package.json`** - Root workspace configuration with script shortcuts

## Development Workflow

### Plugin Source Files

Source files are currently scaffolded but empty. When implementing:
- Follow the OpenClaw channel plugin API
- Use TypeBox (`@sinclair/typebox`) for runtime schema validation
- Integrate with `livekit-server-sdk` for room management
- Use streaming APIs for STT/TTS to minimize latency

### Testing Strategy

- Plugin tests run with `bun test` in the plugin package
- Flutter tests run with `flutter test` in the mobile app
- Integration testing requires a running LiveKit server

### Deployment

The plugin is designed to:
- Publish to npm as `@openclaw/channel-livekit`
- Be discoverable by OpenClaw Gateway
- Be installable via OpenClaw's plugin system
- Run as part of the OpenClaw Gateway process (not standalone)

## External Dependencies

### Required Services (BYOK - Bring Your Own Key)

- **Speech-to-Text:** Deepgram or Groq API key
- **Text-to-Speech:** Cartesia or ElevenLabs Turbo API key
- **OpenClaw:** Configured OpenClaw instance with required brain/LLM access

### LiveKit Server

You can run LiveKit in two ways:
1. **Local:** `docker compose up -d` (uses `livekit.yaml` config)
2. **Cloud:** Free tier at livekit.io for development

### Development Tools

- **Bun:** >=1.0.0 (JavaScript runtime)
- **Flutter:** ^3.7.1 (mobile framework)
- **Docker & Docker Compose:** For local LiveKit server
- **Nix (Optional):** Reproducible dev environment via `flake.nix`

## Project Status

This is an active development project. See `tasks/README.md` for the current roadmap and development phases. The architecture follows the Channel Plugin approach (Epic 2) for deep OpenClaw integration.
