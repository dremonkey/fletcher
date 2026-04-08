# Infrastructure

Fletcher runs on Docker Compose with host networking, managed by Nix for development toolchain reproducibility. This document covers the deployment configuration, LiveKit server setup, Nix environment, and the complete environment variable reference.

## Docker Compose

The `docker-compose.yml` defines four services:

### LiveKit Server

```yaml
livekit:
  image: livekit/livekit-server:latest
  network_mode: host
  volumes:
    - ./livekit.yaml:/etc/livekit.yaml
  restart: unless-stopped
```

**Why host networking:** LiveKit requires direct access to UDP ports 50000-60000 for WebRTC media. Docker's port mapping adds overhead and can break ICE negotiation. Host networking is required, not optional.

### Piper TTS Sidecar

```yaml
piper:
  image: waveoffire/piper-tts-server
  network_mode: host
  restart: unless-stopped
  deploy:
    resources:
      reservations:
        devices:
          - driver: cdi
            device_ids:
              - nvidia.com/gpu=all
            capabilities: [gpu]
```

A lightweight local TTS engine used as a fallback when cloud TTS providers (ElevenLabs, Google) fail due to rate limits or errors. Runs on port 5000 and accepts POST requests with JSON `{ "text": "...", "voice": "..." }`, returning WAV audio. See [Voice Pipeline](voice-pipeline.md) for the tiered TTS strategy.

**GPU requirement:** The `waveoffire/piper-tts-server` image bundles ONNX Runtime with CUDA. It requires GPU passthrough via CDI (Container Device Interface). On NixOS, enable `hardware.nvidia-container-toolkit.enable = true;` in your system configuration and run `nixos-rebuild switch`. The CDI generator service creates the device spec at `/var/run/cdi/nvidia-container-toolkit.json`. Without this, the container crashes with "CUDA driver version is insufficient for CUDA runtime version".

### Token Server

```yaml
token-server:
  build:
    context: .
    dockerfile: apps/voice-agent/Dockerfile
  command: ["run", "scripts/token-server.ts"]
  network_mode: host
  env_file: .env
  environment:
    LIVEKIT_URL: ws://localhost:7880
    TOKEN_SERVER_PORT: 7882
  restart: unless-stopped
```

A lightweight HTTP endpoint that generates LiveKit JWT tokens on demand. The mobile client calls `GET /token?room=<name>&identity=<id>` to get a fresh token for any room name. This keeps API secrets off the device and enables dynamic room names.

**Separate from voice-agent:** The token server is a distinct service so tokens are available even during voice-agent restarts. It reuses the same Docker image (which already has `livekit-server-sdk` installed) but overrides the entrypoint to run `scripts/token-server.ts`.

### Voice Agent

```yaml
voice-agent:
  build:
    context: .
    dockerfile: apps/voice-agent/Dockerfile
  network_mode: host
  env_file: .env
  environment:
    LIVEKIT_URL: ws://localhost:7880
    PIPER_URL: http://localhost:5000
    GANGLIA_TYPE: relay
    DEBUG: ganglia:*
    LOG_LEVEL: debug
  restart: unless-stopped
```

The agent Dockerfile is a multi-stage Bun build:
1. Install workspace dependencies with `bun install --frozen-lockfile`
2. Build the Ganglia package with `tsc`
3. Copy built artifacts to a slim runtime image
4. Entrypoint: `bun run apps/voice-agent/src/agent.ts dev`

## LiveKit Configuration

`livekit.yaml` configures the LiveKit SFU:

| Setting | Value | Purpose |
|---------|-------|---------|
| `port` | 7880 | HTTP/WebSocket API |
| `rtc.tcp_port` | 7881 | RTC over TCP fallback |
| `rtc.port_range_start` | 50000 | WebRTC UDP media range start |
| `rtc.port_range_end` | 60000 | WebRTC UDP media range end |
| `rtc.node_ip` | 100.87.219.109 | Tailscale IP — forces stable ICE candidates |
| `rtc.use_external_ip` | true | Advertise `node_ip` to clients |
| `room.departure_timeout` | 120 | Seconds to keep room alive after last participant leaves |
| `keys.devkey` | `9B8mAgLb7...` | API key and secret for development |

**Tailscale IP pinning:** Setting `node_ip` to a Tailscale address ensures that ICE candidates use a routable IP accessible from both LAN and Tailscale VPN. Without this, LiveKit may advertise a LAN IP that's unreachable when the mobile device is on Tailscale, or vice versa.

**Departure timeout:** WiFi→5G is a "break before make" transition — WiFi drops before 5G activates, creating a 40-80s connectivity gap (including Tailscale tunnel re-establishment). The default 20s `departure_timeout` closed the room before the client could reconnect. 120s provides comfortable margin. The voice agent logs participant disconnect/reconnect events for observability during these windows.

## Nix Development Environment

`flake.nix` provides a reproducible development shell with:

| Tool | Purpose |
|------|---------|
| `bun` | JavaScript/TypeScript runtime |
| `flutter` | Mobile app framework |
| `jdk17` | Android build toolchain |
| `docker` / `docker-compose` | Container orchestration |
| `androidSdk` | Android SDK with build tools, platforms, NDK |

### Android SDK Components

- Build tools: 34.0.0, 35.0.0, 36.0.0
- Platforms: 34, 36
- ABIs: x86_64, arm64-v8a
- NDK: 28.2.13676358
- Emulator + system images (Linux only)

### Environment Variables Set by Nix

| Variable | Purpose |
|----------|---------|
| `ANDROID_HOME` | Nix-managed Android SDK path |
| `ANDROID_SDK_ROOT` | Same as `ANDROID_HOME` |
| `ANDROID_NDK_HOME` | NDK bundle path |
| `JAVA_HOME` | JDK17 home |
| `LD_LIBRARY_PATH` | GPU and C++ runtime libraries (Linux) |
| `VK_ICD_FILENAMES` | Vulkan ICD config for emulator GPU |

### NixOS Prerequisites

The following NixOS configuration options must be enabled for the full stack:

```nix
# configuration.nix
programs.nix-ld.enable = true;                    # Run unpatched binaries (Android tools, Bun)
hardware.nvidia-container-toolkit.enable = true;   # GPU passthrough for Piper TTS container
```

After changing these, run `sudo nixos-rebuild switch` and restart Docker (`sudo systemctl restart docker`).

### Bootstrap

The `scripts/bootstrap.sh` script initializes a fresh checkout:
1. Verify Nix is installed
2. Run `bun install`
3. Accept Android SDK licenses
4. List available AVDs
5. Run `pod install` on macOS (if iOS directory exists)

## Tailscale Integration

Fletcher uses Tailscale for reliable networking between the dev machine and mobile devices, especially over 5G where LAN addresses are unreachable.

**Server side:** LiveKit's `node_ip` is set to the Tailscale IP so ICE candidates work across network boundaries.

**Client side:** The mobile app detects Tailscale at runtime by scanning for IPs in the CGNAT range (`100.64.0.0/10`) and switches URLs accordingly.

**TUI side:** The TUI launcher detects both LAN and Tailscale IPs and writes them to `apps/mobile/.env` as `LIVEKIT_URL` and `LIVEKIT_URL_TAILSCALE`.

See [Network Connectivity](network-connectivity.md) for the full URL resolution logic.

## Environment Variable Reference

### LiveKit

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LIVEKIT_URL` | Yes | — | LiveKit WebSocket URL (`ws://` or `wss://`) |
| `LIVEKIT_API_KEY` | Yes | — | LiveKit API key (matches `keys` in `livekit.yaml`) |
| `LIVEKIT_API_SECRET` | Yes | — | LiveKit API secret |
| `LIVEKIT_ROOM` | No | `fletcher-dev` | Default room name |
| `LIVEKIT_URL_TAILSCALE` | No | — | Alternate URL for Tailscale VPN (mobile `.env`) |
| `TOKEN_SERVER_PORT` | No | `7882` | Token endpoint HTTP port |
| `DEPARTURE_TIMEOUT_S` | No | `120` | Room departure timeout — must match `livekit.yaml` (mobile `.env`) |

### LiveKit Cloud (Optional)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LIVEKIT_CLOUD_URL` | No | — | LiveKit Cloud WebSocket URL |
| `LIVEKIT_CLOUD_API_KEY` | No | — | Cloud API key |
| `LIVEKIT_CLOUD_API_SECRET` | No | — | Cloud API secret |

### Ganglia

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GANGLIA_TYPE` | No | `relay` | Backend selection (relay is the only backend) |

### Voice Providers

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEEPGRAM_API_KEY` | Yes | — | Deepgram STT API key |
| `TTS_PROVIDER` | No | `elevenlabs` | TTS backend: `elevenlabs` or `google` |
| `ELEVENLABS_API_KEY` | If `TTS_PROVIDER=elevenlabs` | — | ElevenLabs TTS API key |
| `ELEVENLABS_VOICE_ID` | No | SDK default | ElevenLabs voice ID |
| `GOOGLE_API_KEY` | If `TTS_PROVIDER=google` | — | Google AI Studio API key |
| `GOOGLE_TTS_VOICE` | No | `Kore` | Gemini TTS voice name |
| `PIPER_URL` | No | — | Piper TTS sidecar URL for local fallback (enables FallbackAdapter) |
| `PIPER_VOICE` | No | sidecar default | Piper voice name |

### Session & Identity

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FLETCHER_OWNER_IDENTITY` | No | — | Participant identity that maps to owner session (e.g., `device-<ANDROID_ID>`) |
| `FLETCHER_ACK_SOUND` | No | `builtin` | Acknowledgment sound on EOU: `builtin`, file path, or `disabled` |

### Logging & Debug

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_LEVEL` | No | `info` | Pino log level |
| `NODE_ENV` | No | — | `production` disables pretty-printing |
| `DEBUG` | No | — | Debug namespaces (e.g., `ganglia:*`) |

## Port Reference

| Port | Protocol | Service | Purpose |
|------|----------|---------|---------|
| 7880 | TCP | LiveKit | HTTP API + WebSocket signaling |
| 7881 | TCP | LiveKit | RTC over TCP (fallback) |
| 50000-60000 | UDP | LiveKit | WebRTC media streams |
| 5000 | TCP | Piper | TTS sidecar HTTP API |
| 7882 | TCP | Token Server | JWT token generation endpoint |
| 18789 | TCP | OpenClaw Gateway | Gateway HTTP API (if using OpenClaw backend) |

## Related Documents

- [System Overview](system-overview.md) — deployment topology diagram
- [Network Connectivity](network-connectivity.md) — Tailscale URL resolution
- [Developer Workflow](developer-workflow.md) — starting services and deploying to devices
