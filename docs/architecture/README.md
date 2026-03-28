# Fletcher Architecture

Architecture documentation for Fletcher, an open-source mobile ACP (Agent Communication Protocol) client with voice and text support. Fletcher bridges any ACP-compatible agent to a mobile device via LiveKit's WebRTC infrastructure.

## Reading Order

Start with the system overview, then follow each group in order. Each group builds on the previous one.

### Start Here

| Document | Summary |
|----------|---------|
| [System Overview](system-overview.md) | Three-layer architecture, monorepo structure, package dependencies, deployment topology |

### Core Protocol

The relay is the foundation. Text mode works with just the relay and mobile app — everything else is additive. Read these to understand how messages flow.

| Document | Summary |
|----------|---------|
| [Relay Lifecycle](relay-lifecycle.md) | Room lifecycle, deferred teardown, health-gated re-bind, ACP failure recovery |
| [Data Channel Protocol](data-channel-protocol.md) | Wire format: ACP content pipeline, ContentBlock model, transcription streams, chunking |
| [Session Routing](session-routing.md) | SessionKey resolution (owner/guest/room), wire protocol, conversation persistence |

### Mobile Client

The Flutter app that consumes the core protocol.

| Document | Summary |
|----------|---------|
| [Mobile Client](mobile-client.md) | Services, widgets, state model, connection lifecycle, reconnection |
| [Network Connectivity](network-connectivity.md) | Tailscale-aware URL resolution, CGNAT detection, health diagnostics |
| [Macro Shortcuts](macro-shortcuts.md) | Programmable 3x3 button grid, command pool, ACP discovery, dispatch flow |

### Voice Mode (Optional)

Adds real-time speech on top of the core protocol. The voice agent joins rooms on demand and routes through the relay.

| Document | Summary |
|----------|---------|
| [Voice Pipeline](voice-pipeline.md) | End-to-end audio flow: STT → LLM → TTS, latency budget, AgentSession orchestration |
| [Brain Plugin](brain-plugin.md) | Ganglia LLM bridge — relay backend, session routing, streaming, logging |

### Operations

Deployment, configuration, and development workflow.

| Document | Summary |
|----------|---------|
| [Infrastructure](infrastructure.md) | Docker Compose, LiveKit config, Nix flake, Tailscale, environment variable reference |
| [Developer Workflow](developer-workflow.md) | TUI launcher, manual workflow, testing, startup sequence |

### Appendix

Migration notes.

| Document | Summary |
|----------|---------|
| [Relay Claude Code Migration](relay-claude-code/acp-harness-migration.md) | ACP backend swap from OpenClaw to Claude Code — impact analysis, risk matrix, rollback |

## Quick Reference

### Key Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@fletcher/relay` | `apps/relay/` | ACP bridge (data channel ↔ ACP subprocess over stdio) |
| `@fletcher/voice-agent` | `apps/voice-agent/` | Standalone LiveKit agent runner |
| `@knittt/livekit-agent-ganglia` | `packages/livekit-agent-ganglia/` | LLM bridge — routes voice pipeline to ACP via relay |
| `@fletcher/tui` | `packages/tui/` | Developer TUI launcher |
| Flutter app | `apps/mobile/` | Mobile ACP client |

### Key Ports

| Port | Service |
|------|---------|
| 7880 | LiveKit (HTTP/WS) |
| 7881 | LiveKit (RTC/TCP) |
| 7882 | Token Server (JWT generation) |
| 7890 | Relay HTTP (localhost only) |
| 5000 | Piper TTS sidecar |
| 50000-60000 | LiveKit (WebRTC UDP) |

### Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `ACP_COMMAND` / `ACP_ARGS` | ACP subprocess command (default: `openclaw acp`) |
| `LIVEKIT_URL` | LiveKit WebSocket URL |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit authentication |
| `DEEPGRAM_API_KEY` | Speech-to-text (voice mode) |
| `FLETCHER_OWNER_IDENTITY` | Owner session routing |

See [Infrastructure](infrastructure.md) for the complete environment variable reference.
