# Fletcher

A voice-first bridge for OpenClaw using LiveKit, targeting sub-1.5-second voice-to-voice latency.

## Overview

Fletcher is a **standalone voice agent** that bridges a Flutter mobile client to the OpenClaw reasoning engine through a real-time audio pipeline built on the LiveKit Agents framework. It connects to the OpenClaw Gateway via its OpenAI-compatible completions API, handling the complete pipeline from speech-to-text through to text-to-speech.

> **Note:** We initially explored building Fletcher as an OpenClaw channel plugin (similar to Telegram or WhatsApp channels), but opted for the standalone voice agent approach instead. The standalone model is simpler to develop and deploy, avoids coupling to the Gateway process lifecycle, and talks to OpenClaw through the same public API any other client would use. See [Architecture Comparison](./docs/architecture-comparison.md) for background.

This repository contains:

1. **Voice Agent** (`apps/voice-agent`) — A standalone LiveKit agent that runs as an independent worker
2. **Brain Plugin** (`packages/livekit-agent-ganglia`) — LLM bridge to OpenClaw/Nanoclaw backends
3. **Example Flutter App** (`apps/mobile`) — A minimal mobile client for testing

## Architecture

### Voice Agent (`apps/voice-agent`)

The main entry point. A TypeScript LiveKit agent that:

- **Runtime:** Bun (TypeScript)
- **Framework:** `@livekit/agents`
- **Function:**
  - Runs as an independent LiveKit worker, accepting job dispatches
  - Handles real-time audio streams (STT → OpenClaw → TTS)
  - Uses Ganglia (`@knittt/livekit-agent-ganglia`) as the LLM bridge

### Example Mobile App (`apps/mobile`)

A minimal Flutter application for testing the voice agent. Not intended as a production app.

- **Framework:** Flutter (Dart)
- **Library:** `livekit_client`
- **Purpose:** Test client for voice agent development
- **Features:**
  - One-button interface to join a LiveKit room
  - "Amber Heartbeat" audio visualizer for voice intensity feedback

## Audio Pipeline (Target: <1.5s)

1. **Mobile App:** Captures audio → Streams to LiveKit Server
2. **Plugin:** Receives stream → Fast-STT (Deepgram/Groq) → OpenClaw Brain
3. **Plugin:** Brain Response → Fast-TTS (Cartesia/ElevenLabs Turbo) → LiveKit Server
4. **Mobile App:** Receives audio stream → Playback

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

## Getting Started

### Prerequisites

#### System-Level (install once)

**Docker & Docker Compose** — Required for running the local LiveKit server.

- **NixOS:** See the [NixOS Setup Guide](./docs/nixos-setup.md) for complete instructions (Docker, KVM for emulator acceleration, etc.).
- **macOS:** Install [Colima](https://github.com/abiosoft/colima) (recommended) or [Docker Desktop](https://docker.com/products/docker-desktop):
  ```bash
  brew install colima docker docker-compose
  colima start
  ```

**Nix (recommended)** — Provides all other development dependencies automatically.

- **NixOS:** Already installed.
- **macOS:** Install via the [Determinate Nix Installer](https://github.com/DeterminateSystems/nix-installer):
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
  ```

#### Repo-Level (provided by `nix develop`)

If you have Nix installed, all other dependencies are provided automatically:

- **Bun** — JavaScript runtime for the plugin (required)
- **Flutter** — For the example mobile app only (optional)
- **Android SDK & Studio** — For Android development (optional)

#### Without Nix

If you prefer not to use Nix, install these manually:

- **Bun:** https://bun.sh (required for plugin development)
- **Flutter:** https://flutter.dev/docs/get-started/install (only if testing with the example app)

### Quick Setup

If you use **Nix**, entering the development shell will automatically provide all necessary dependencies (Flutter, Android Studio, Bun, etc.):

```bash
nix develop
```

*Note: The first run will take some time to download Flutter, Android SDK, and other dependencies. Subsequent runs are nearly instant thanks to Nix store caching and nix-direnv's environment cache.*

#### Automatic Environment (Recommended)
To automatically load the environment when you `cd` into this directory, we **highly recommend** using `nix-direnv`. It provides instant environment switching and prevents your dependencies from being garbage collected.

**NixOS Installation:**
Add `direnv` and `nix-direnv` to your configuration or home-manager, then:
```bash
echo "use flake" > .envrc
direnv allow
```

#### Start Development

The quickest way to get everything running is the TUI dev launcher:

```bash
bun dev
```

This will audit your environment, prompt for any missing API keys (saving them to `.env`), start the local LiveKit server, generate a token, and launch the voice agent — all in one command.

If `adb` and `flutter` are on your PATH and a device is connected, it will also offer to build and install the debug APK to your phone.

#### Manual Setup

If you prefer to run services individually:

```bash
./scripts/setup.sh          # Start LiveKit + health check
bun run token:generate      # Generate a LiveKit token
bun run voice:dev           # Start the voice agent
```

## Local Infrastructure

Fletcher uses LiveKit for real-time audio. You can start a local LiveKit instance using Docker:

```bash
docker compose up -d
```

The server will be available at `http://localhost:7880`. Use the default keys provided in `livekit.yaml` for development.

## Project Roadmap

See the [tasks roadmap](./tasks/README.md) for development progress and next steps.

