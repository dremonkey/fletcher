# Fletcher Architecture

Architecture documentation for Fletcher, an OpenClaw channel plugin for real-time voice conversations via LiveKit.

## Reading Order

Start with the system overview, then follow the links based on what you need to understand.

| # | Document | Summary |
|---|----------|---------|
| 1 | [System Overview](system-overview.md) | Three-layer architecture, monorepo structure, deployment topology, two entry points |
| 2 | [Voice Pipeline](voice-pipeline.md) | End-to-end audio flow from speech to speech, latency budget, AgentSession orchestration |
| 3 | [Brain Plugin](brain-plugin.md) | Ganglia LLM bridge — factory system, OpenClaw/Nanoclaw backends, streaming, logging |
| 4 | [Session Routing](session-routing.md) | SessionKey resolution (owner/guest/room), wire protocol, conversation persistence |
| 5 | [Channel Plugin](channel-plugin.md) | OpenClaw plugin interface, six adapters, VoiceAgent lifecycle, Sovereign Pairing |
| 6 | [Data Channel Protocol](data-channel-protocol.md) | Transcription streams, status/artifact events, chunking protocol |
| 7 | [Mobile Client](mobile-client.md) | Flutter app services, widgets, state model, connection lifecycle, reconnection |
| 8 | [Infrastructure](infrastructure.md) | Docker Compose, LiveKit config, Nix flake, Tailscale, environment variable reference |
| 9 | [Developer Workflow](developer-workflow.md) | TUI launcher, manual workflow, testing, startup sequence |
| 10 | [Network Connectivity](network-connectivity.md) | Tailscale-aware URL resolution, CGNAT detection, health diagnostics |

## Quick Reference

### Key Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@openclaw/channel-livekit` | `packages/openclaw-channel-livekit/` | OpenClaw channel plugin (Layer 1) |
| `@knittt/livekit-agent-ganglia` | `packages/livekit-agent-ganglia/` | LLM bridge to OpenClaw/Nanoclaw (Layer 3) |
| `@fletcher/voice-agent` | `apps/voice-agent/` | Standalone LiveKit agent runner |
| `@fletcher/tui` | `packages/tui/` | Developer TUI launcher |
| Flutter app | `apps/mobile/` | Mobile voice client |

### Key Ports

| Port | Service |
|------|---------|
| 7880 | LiveKit (HTTP/WS) |
| 7881 | LiveKit (RTC/TCP) |
| 50000-60000 | LiveKit (WebRTC UDP) |
| 18789 | OpenClaw/Nanoclaw Gateway |

### Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `GANGLIA_TYPE` | Backend selection: `openclaw` or `nanoclaw` |
| `OPENCLAW_API_KEY` | Gateway authentication |
| `DEEPGRAM_API_KEY` | Speech-to-text |
| `CARTESIA_API_KEY` | Text-to-speech |
| `FLETCHER_OWNER_IDENTITY` | Owner session routing |

See [Infrastructure](infrastructure.md) for the complete environment variable reference.
