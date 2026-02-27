# @openclaw/channel-livekit [DEPRECATED]

> **This package is deprecated.** The standalone voice agent (`apps/voice-agent`) combined with `@knittt/livekit-agent-ganglia` provides the same functionality with less complexity. See reasoning below.

## Why deprecated?

This package wraps the LiveKit voice pipeline (STT → LLM → TTS) as an OpenClaw **channel plugin** — implementing config, security, messaging, gateway, outbound, and status adapters. However, `livekit-agent-ganglia` already handles the brain connection to OpenClaw, and the standalone voice agent in `apps/voice-agent` runs the same STT/TTS pipeline independently.

The two pipelines are identical:

```
# This package (channel plugin)
deepgram.STT → ganglia LLM (→ OpenClaw) → cartesia.TTS

# apps/voice-agent (standalone)
deepgram.STT → ganglia LLM (→ OpenClaw) → cartesia.TTS
```

### What this package added (and why it's not needed)

| Feature | Channel plugin | Without it |
|---|---|---|
| **Multi-account config** | openclaw.json CRUD for multiple LiveKit workspaces | Deploy separate agent instances per workspace, or use env vars |
| **DM policy / access control** | Allowlist/pairing system (`dmPolicy`) | LiveKit has token-based access control — enforce at token issuance |
| **Gateway lifecycle** | OpenClaw gateway manages agent start/stop | LiveKit Agents SDK handles worker registration, dispatching, and graceful shutdown natively |
| **Outbound sendText** | OpenClaw can proactively push TTS to a room | Conversation flow is user-speaks → agent-responds, which ganglia already handles |
| **Status/health checks** | Monitoring via OpenClaw's status system | LiveKit has its own observability |

All of this is OpenClaw plugin ceremony — config schemas, adapter interfaces, lifecycle hooks. None of it adds voice functionality. The actual voice pipeline is identical in both places, and ganglia already handles the OpenClaw brain connection.

## Replacement

Use `apps/voice-agent` + `@knittt/livekit-agent-ganglia` instead:

```
apps/voice-agent          — LiveKit agent runner (STT/TTS pipeline, room management)
packages/livekit-agent-ganglia — LLM plugin bridging LiveKit to OpenClaw/Nanoclaw
```
