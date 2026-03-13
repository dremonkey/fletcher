# Epic 24: WebRTC ACP Relay

**Status:** ✅ Complete
**Goal:** Build a lightweight LiveKit participant that bridges mobile data channel messages to ACP agent subprocesses over stdio, enabling text-mode conversations without the voice pipeline.

## Purpose

Fletcher's voice agent pipeline (STT → LLM → TTS) is powerful but expensive. Many interactions — especially text-based ones — don't need audio processing at all. The relay provides a direct path from the mobile client to an ACP-compatible agent (e.g., ACPX/Claude Code) via LiveKit data channels:

```
Mobile App ──data channel──▶ Relay ──stdio JSON-RPC──▶ ACP Agent
         ◀──data channel──         ◀──stdio JSON-RPC──
```

The relay joins LiveKit rooms as a non-agent participant, forwards JSON-RPC messages bidirectionally, and manages ACP subprocess lifecycle. It's the foundation for the dual-mode architecture (Epic 22) where voice and chat modes share the same LiveKit room.

## Architecture

- **Transport:** LiveKit data channel (topic `"relay"`, reliable mode)
- **Protocol:** JSON-RPC 2.0 over newline-delimited stdio (ACP transport)
- **Topology:** One ACP subprocess per room, one relay process serving multiple rooms
- **Lifecycle:** Join-on-demand via webhook or HTTP signal, idle timeout for cleanup

## Tasks

### Core Infrastructure ✅
- [x] [LiveKit Participant](./_closed/livekit-participant.md) — Replace raw WebSocket with `@livekit/rtc-node` room participant; token self-generation; multi-room support
- [x] [ACP stdio Client](./_closed/acp-stdio-client.md) — Spawn ACP agent subprocess; JSON-RPC 2.0 over stdin/stdout; initialize/session/prompt lifecycle

### Bridge & Forwarding ✅
- [x] [Data Channel ↔ ACP Bridge](./_closed/data-channel-acp-bridge.md) — Wire data channel to ACP client; sessionId injection; mode check; opaque message forwarding

### Room Lifecycle ✅
- [x] [Room Lifecycle](./_closed/room-lifecycle.md) — Join-on-demand via `POST /relay/join`; idle timeout; graceful shutdown
- [x] [Participant Left Webhook](./_closed/participant-left-webhook.md) — Tear down bridge when last human participant leaves
- [x] [Reset Idle Timer on Incoming Messages](./_closed/touch-on-incoming.md) — Call `touchRoom()` on mobile messages to prevent premature idle timeout

### Resilience ✅
- [x] [Lazy ACP Re-init](./_closed/lazy-acp-reinit.md) — Detect ACP subprocess death; re-initialize on next mobile message; 30-minute default idle timeout
- [x] [Rejoin Rooms on Restart](./_closed/rejoin-rooms-on-restart.md) — Query LiveKit `RoomServiceClient` on startup; auto-join orphaned rooms with human participants

### Observability ✅
- [x] [Health & Observability](./_closed/health-observability.md) — `/health` with room/ACP counts; `/rooms` endpoint; pino structured logging

## Dependencies

- Epic 4 (Ganglia) — session key routing for ACP `_meta`
- Epic 22 (Dual-Mode) — consumer of the relay; builds chat mode on top of this infrastructure

## Key Decisions

- **Opaque forwarding:** The relay does not interpret ACP content — it forwards messages between mobile and ACP transparently. Only `sessionId` is injected.
- **One subprocess per room:** Each LiveKit room gets its own ACP agent process, providing isolation and simple lifecycle management.
- **Stateless design:** LiveKit is the source of truth for room state. The relay can restart and recover by querying the LiveKit server API.
- **localhost-only HTTP:** The relay's HTTP server binds to `127.0.0.1` — no auth needed since it's co-located with the token server.
