# Fletcher

An open-source mobile [ACP](https://github.com/anthropics/acp) (Agent Communication Protocol) client with voice and text support.

## Overview

Fletcher is a **mobile frontend for any ACP-compatible agent**. Point it at an ACP server — OpenClaw, Claude Code, or your own — and you get a full mobile client with voice conversations, text chat, tool-call visibility, artifact rendering, and session management. The agent is a config flag (`ACP_COMMAND`); the client handles everything else.

The core architecture has three pieces:

1. **Relay** (`apps/relay`) — The ACP bridge. A lightweight LiveKit participant that forwards JSON-RPC 2.0 messages between the mobile client's data channel and an ACP subprocess over stdio. Backend-agnostic — any ACP server plugs in.
2. **Mobile App** (`apps/mobile`) — Flutter client with dual-mode input (voice + text), inline tool-call cards, thinking blocks, artifact viewer, and connection resilience for real-world mobile use.
3. **Voice Agent** (`apps/voice-agent`) — Optional. A LiveKit agent that adds real-time voice mode: Deepgram STT → LLM reasoning → TTS, targeting sub-1.5s voice-to-voice latency. Joins on demand, disconnects when idle.

The relay is the foundation. Text mode works without the voice agent. Voice mode adds a richer interaction path when you want to talk instead of type.

## Architecture

### Relay (`apps/relay`) — The Core

The relay joins LiveKit rooms as a non-agent participant and bridges ACP messages between mobile and an agent subprocess. It is a transparent passthrough — it does not parse or transform message content.

- **Runtime:** Bun (TypeScript)
- **Protocol:** JSON-RPC 2.0 over LiveKit data channels ↔ ACP over stdio
- **Backend:** Configured via `ACP_COMMAND` / `ACP_ARGS` (default: `openclaw acp`)
- **Features:** Auto-discovery of orphaned rooms, deferred teardown on network switches, lazy ACP recovery, idle timeout

### Mobile App (`apps/mobile`)

The mobile ACP client.

- **Framework:** Flutter (Dart)
- **Library:** `livekit_client`
- **Features:**
  - Dual-mode input: voice (via LiveKit agent) and text (via relay)
  - Inline tool-call cards, thinking blocks, artifact viewer (diffs, code, search results)
  - Connection resilience: survives WiFi↔5G, Bluetooth changes, backgrounding
  - On-demand agent dispatch, hold mode, session resumption

### Voice Agent (`apps/voice-agent`) — Optional

Adds real-time voice conversations. A TypeScript LiveKit agent that:

- **Runtime:** Bun (TypeScript)
- **Framework:** `@livekit/agents`
- **Function:**
  - Joins rooms on demand, disconnects when idle (hold mode)
  - Handles real-time audio: STT (Deepgram) → LLM (via relay ACP bridge) → TTS
  - Uses Ganglia (`@knittt/livekit-agent-ganglia`) as the LLM bridge

### Brain Plugin (`packages/livekit-agent-ganglia`)

Bridges the voice pipeline to ACP backends. Pluggable — routes through the relay by default (`GANGLIA_TYPE=relay`), or directly to Nanoclaw for local development.

## Supported ACP Backends

Any ACP-compatible agent works. Tested backends:

| Backend | `ACP_COMMAND` | Auth |
|---------|---------------|------|
| [OpenClaw](https://github.com/openclaw) | `openclaw acp` | `OPENCLAW_API_KEY` |
| [Claude Code](https://github.com/anthropics/claude-code) (via `claude-agent-acp`) | `claude-agent-acp` | `ANTHROPIC_API_KEY` |
| Custom | Any stdio ACP server | Varies |

## Setup Requirements

### LiveKit Server

You have two options for running the LiveKit server:

1. **Local Development:** Run LiveKit server locally using the provided `docker-compose` configuration
2. **LiveKit Cloud:** Use the free tier of [LiveKit Cloud](https://livekit.io/) for development and testing

### AI Service Keys (BYOK — voice mode only)

Voice mode uses a bring-your-own-key model for STT/TTS providers. Text mode (via relay) only needs the ACP backend's credentials.

- **Speech-to-Text:** Deepgram (required for voice mode)
- **Text-to-Speech:** Google, ElevenLabs, or local Piper (required for voice mode)
- **ACP Backend:** As required by your chosen agent (e.g., `ANTHROPIC_API_KEY` for Claude Code)

## Open Source

- **License:** MIT
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

This starts four services:

| Service | Port | Purpose |
|---------|------|---------|
| `livekit` | 7880 (TCP) | WebSocket signaling + WebRTC media (UDP 50000-60000) |
| `token-server` | 7882 (TCP) | HTTP endpoint for JWT tokens (dynamic room support) |
| `piper` | 5000 (TCP) | Local TTS engine |
| `voice-agent` | — | LiveKit agent worker (connects to LiveKit internally) |

Use the default keys provided in `livekit.yaml` for development.

**NixOS firewall:** Ports 7880, 7881, 7882 (TCP) and 50000-60000 (UDP) must be open for LAN clients. Tailscale traffic bypasses the firewall. See [Networking Guide](./docs/troubleshooting/networking.md).

## Encrypted Files

Field-test raw logs (`docs/field-tests/*.txt`) are encrypted with [git-crypt](https://github.com/AGWA/git-crypt) because they may contain PII (names, IP addresses, full conversation transcripts). To read them:

```bash
# Obtain the symmetric key file from a project maintainer, then:
git-crypt unlock ./git-crypt-key
```

The curated bug logs (`docs/field-tests/*-buglog.md`) are **not** encrypted and are readable without unlocking.

## Why Fletcher?

ACP defines how agents communicate, but there's no mobile client for the protocol. If you build an ACP agent today, there's no way to use it from a phone. Fletcher fills that gap — any ACP agent gets a mobile app for free, with voice and text input, tool-call visibility, artifact rendering, and session management.

The agent is just a config flag. The client handles everything else.

## Project Roadmap

See the [tasks roadmap](./tasks/README.md) for development progress and next steps.

