# Fletcher Architecture

Architecture documentation for Fletcher, an open-source mobile ACP (Agent Communication Protocol) client with voice and text support. Fletcher bridges any ACP-compatible agent to a mobile device via LiveKit's WebRTC infrastructure.

## Reading Order

Start with the system overview, then follow the links based on what you need to understand.

| # | Document | Summary |
|---|----------|---------|
| 1 | [System Overview](system-overview.md) | Two-layer architecture, monorepo structure, deployment topology |
| 2 | [Voice Pipeline](voice-pipeline.md) | End-to-end audio flow from speech to speech, latency budget, AgentSession orchestration |
| 3 | [Brain Plugin](brain-plugin.md) | Ganglia LLM bridge — factory system, OpenClaw/Nanoclaw backends, streaming, logging |
| 4 | [Session Routing](session-routing.md) | SessionKey resolution (owner/guest/room), wire protocol, conversation persistence |
| 5 | [Data Channel Protocol](data-channel-protocol.md) | Transcription streams, status/artifact events, chunking protocol |
| 6 | [Mobile Client](mobile-client.md) | Flutter app services, widgets, state model, connection lifecycle, reconnection |
| 7 | [Infrastructure](infrastructure.md) | Docker Compose, LiveKit config, Nix flake, Tailscale, environment variable reference |
| 8 | [Developer Workflow](developer-workflow.md) | TUI launcher, manual workflow, testing, startup sequence |
| 9 | [Network Connectivity](network-connectivity.md) | Tailscale-aware URL resolution, CGNAT detection, health diagnostics |
| 10 | [Mic Grab Protection](009-mic-grab-protection.md) | BUG-009: device-change guard when muted, two mute modes, pending-change deferral |
| 11 | [Macro Shortcuts](macro-shortcuts.md) | Programmable 3x3 button grid, command pool, ACP discovery, dispatch flow |
| 12 | [Relay Lifecycle](relay-lifecycle.md) | Room lifecycle, deferred teardown, health-gated re-bind, ACP failure recovery |

## Quick Reference

### Key Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@knittt/livekit-agent-ganglia` | `packages/livekit-agent-ganglia/` | LLM bridge to OpenClaw/Nanoclaw |
| `@fletcher/voice-agent` | `apps/voice-agent/` | Standalone LiveKit agent runner |
| `@fletcher/relay` | `apps/relay/` | Text-mode ACP bridge (data channel ↔ OpenClaw) |
| `@fletcher/tui` | `packages/tui/` | Developer TUI launcher |
| Flutter app | `apps/mobile/` | Mobile voice client |

### Key Ports

| Port | Service |
|------|---------|
| 7880 | LiveKit (HTTP/WS) |
| 7881 | LiveKit (RTC/TCP) |
| 7890 | Relay HTTP (localhost only) |
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
