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

- **Bun** — JavaScript runtime for the OpenClaw plugin backend
- **Flutter** — UI toolkit for the mobile application
- **Android SDK & Studio** — For Android development

#### Without Nix

If you prefer not to use Nix, install these manually:

- **Bun:** https://bun.sh
- **Flutter:** https://flutter.dev/docs/get-started/install

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

#### Initialize Services
After entering the shell, run the setup script to check prerequisites and start the local infrastructure:

```bash
./scripts/setup.sh
```

## Local Infrastructure

Fletcher uses LiveKit for real-time audio. You can start a local LiveKit instance using Docker:

```bash
docker compose up -d
```

The server will be available at `http://localhost:7880`. Use the default keys provided in `livekit.yaml` for development.

## Project Roadmap

See the [tasks roadmap](./tasks/README.md) for development progress and next steps.

