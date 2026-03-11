# Fletcher Relay — Execution Plan (LiveKit Non-Agent Participant + OpenClaw)

**Date:** 2026-03-10  
**Status:** 📋 SPEC DRAFT — Ready for Review  
**Objective:** Provide a complete, implementation-ready spec for the Fletcher Relay component that enables Epic 22 (Dual-Mode Architecture) on the Fletcher side.

---

## Context

The Fletcher Relay is the **backend for Chat Mode** in the dual-mode architecture. It:
- Joins LiveKit rooms as a **non-agent participant** using `@livekit/rtc-node`
- Communicates with the Flutter app over a **LiveKit data channel** using **JSON-RPC 2.0**
- Proxies requests to the **OpenClaw Gateway** (local instance)
- Provides **60x cost savings** over voice agent for text interactions
- Enables **ICE restart** for seamless network handoffs (WiFi ↔ 5G)

This plan addresses the implementation phase for the relay itself. The Flutter integration (Epic 22 tasks 042-051) depends on this being complete.

---

## Architecture Summary

```
Mobile (Flutter)
    ↓ WebRTC (LiveKit data channel, topic: "relay")
Fletcher Relay (Bun, @livekit/rtc-node)
    ├─ LiveKit Participant Manager (join/leave rooms on demand)
    ├─ Data Channel Router (JSON-RPC 2.0 protocol handler)
    ├─ Session Manager (conversation state, session key routing)
    ├─ OpenClaw Bridge (HTTP client → local Gateway)
    └─ HTTP Server (health, completions for Ganglia)
    ↓ HTTP
OpenClaw Gateway (local, user's instance)
```

**Key files:**
- `tasks/22-dual-mode/EPIC.md` (repo root) — Fletcher dual-mode spec (depends on relay)
- `apps/relay/docs/architecture.md` — Relay transport rationale
- `apps/relay/tasks/relay-websocket/EPIC.md` — **OUTDATED** (WebSocket-based, needs rewrite)

---

## Execution Phases

### Phase 1: Foundation & Transport (Relay-Side Only)
**Goal:** Get the relay running as a LiveKit participant with basic JSON-RPC handling.  
**Deliverable:** A Bun process that can join a LiveKit room, receive messages on the data channel, and echo them back.

| Task | File | Summary | Blocks |
|------|------|---------|--------|
| R-001 | `001-scaffold-relay-project.md` | Init `fletcher-relay` repo: Bun + TypeScript + deps | All |
| R-002 | `002-livekit-participant.md` | `@livekit/rtc-node` participant manager (join/leave) | R-003, R-004 |
| R-003 | `003-data-channel-transport.md` | Subscribe to `relay` data channel topic, send/receive bytes | R-005 |
| R-004 | `004-jsonrpc-protocol.md` | JSON-RPC 2.0 parser/serializer + error codes | R-005 |
| R-005 | `005-rpc-dispatcher.md` | Method routing (`session/new`, `session/message`, etc.) | R-006 |

**Acceptance:** `bun run src/index.ts` joins a test LiveKit room, echoes JSON-RPC requests back to sender.

---

### Phase 2: OpenClaw Integration
**Goal:** Wire the relay to talk to the local OpenClaw Gateway.  
**Deliverable:** Relay can create OpenClaw sessions, stream messages, and proxy responses back to the client.

| Task | File | Summary | Blocks |
|------|------|---------|--------|
| R-006 | `006-openclaw-http-client.md` | HTTP client for OpenClaw Gateway API (`/v1/sessions`, `/v1/chat/completions`) | R-008 |
| R-007 | `007-session-types.md` | TypeScript types for session state (sessionId, sessionKey, OpenClaw session metadata) | R-008 |
| R-008 | `008-session-manager.md` | Session lifecycle: create, resume, cancel, list; map sessionId ↔ OpenClaw session | R-009 |
| R-009 | `009-message-streaming.md` | Handle OpenClaw SSE stream, convert to `session/update` JSON-RPC notifications | R-010 |
| R-010 | `010-session-persistence.md` | Store session state in SQLite (survives relay restarts) | — |

**Acceptance:** Relay receives `session/new`, creates OpenClaw session, streams response deltas to client via `session/update`, marks session complete.

---

### Phase 3: Lifecycle & Health
**Goal:** Make the relay production-ready with idle timeout, health endpoints, and error recovery.  
**Deliverable:** Relay can handle reconnections, timeouts, and expose health status.

| Task | File | Summary | Blocks |
|------|------|---------|--------|
| R-011 | `011-idle-timeout.md` | Disconnect from LiveKit room after 5 min inactivity per room | R-012 |
| R-012 | `012-token-server-signal.md` | Expose HTTP endpoint for token server to signal "join room X" | — |
| R-013 | `013-health-endpoints.md` | `GET /health`, `GET /sessions` (for debugging/monitoring) | — |
| R-014 | `014-error-recovery.md` | Handle OpenClaw timeout, LiveKit disconnect, malformed JSON-RPC | — |

**Acceptance:** Relay auto-disconnects after idle, rejoins on next token request. Health endpoint shows room/session status.

---

### Phase 4: Ganglia Compatibility (Voice Mode Support)
**Goal:** Allow voice sessions to route through the relay too (optional, enables unified backend switching).  
**Deliverable:** Relay exposes OpenAI-compatible `/v1/chat/completions` endpoint for Ganglia.

| Task | File | Summary | Blocks |
|------|------|---------|--------|
| R-015 | `015-completions-endpoint.md` | HTTP `POST /v1/chat/completions` → proxy to OpenClaw Gateway | — |
| R-016 | `016-ganglia-redirect-config.md` | Update Ganglia config to point at relay instead of OpenClaw directly | — |

**Acceptance:** `livekit-agent` with Ganglia can call relay's `/v1/chat/completions` endpoint. Voice mode works unchanged.

---

### Phase 5: Advanced Features (Post-MVP)
**Goal:** Enable richer interactions (artifacts, background tasks, session push).  
**Deliverable:** Relay supports artifact delivery, push notifications for background tasks.

| Task | File | Summary | Blocks |
|------|------|---------|--------|
| R-017 | `017-artifact-delivery.md` | Parse OpenClaw artifact responses, send as `session/update` with `type: "artifact"` | — |
| R-018 | `018-session-push.md` | Buffer completed background task events, push on reconnect | — |
| R-019 | `019-backend-abstraction.md` | Support `RELAY_BACKEND=openclaw` or `RELAY_BACKEND=claude` (Agent SDK) | — |

**Acceptance:** Client receives artifacts inline with messages. Background tasks push results when client reconnects.

---

## Critical Gaps in Current Specs (Blocking Implementation)

### 🚨 Gap 1: OpenClaw Gateway API Contract
**What's missing:** Exact HTTP endpoints, request/response schemas, session key handling.  
**Needed:**
- `POST /v1/sessions` — create session (params? returns sessionKey?)
- `POST /v1/chat/completions` — send message (how to include sessionKey? headers? body?)
- SSE stream format — what does a delta look like? How are artifacts encoded?
- Error responses — what HTTP codes? What JSON structure?

**Resolution:** Need to read OpenClaw Gateway source or docs to specify the exact API. Alternatively, specify a minimal contract and verify against running instance.

**Action:** Create `apps/relay/docs/openclaw-api-contract.md` with verified API spec.

---

### 🚨 Gap 2: Data Channel Topic & Message Routing
**What's missing:** Exact data channel topic name, message envelope format.  
**Needed:**
- Topic name: `"relay"` (assumed, not specified)
- Message format: raw JSON-RPC string? or wrapped in envelope like `{ type: "rpc", payload: {...} }`?
- How does mobile differentiate relay messages from `ganglia-events` (artifacts in voice mode)?

**Current state:** Epic 22 mentions "parallel `relay` topic" but doesn't specify if it's a separate channel or same channel with routing.

**Action:** Define in `apps/relay/docs/data-channel-protocol.md`.

---

### 🚨 Gap 3: Token Server Signal API
**What's missing:** HTTP endpoint spec for token server → relay "join room X" signal.  
**Needed:**
- Endpoint: `POST /relay/join` (example)
- Request body: `{ roomName: string, userId?: string }`
- Response: `{ success: boolean }`
- Security: localhost-only? shared secret?

**Action:** Specify in `apps/relay/docs/token-server-integration.md`.

---

### 🚨 Gap 4: Room Metadata for Agent/Relay Coordination
**What's missing:** Schema for room metadata to signal which mode is active.  
**Needed:**
- Metadata key: `mode` (example)
- Values: `"voice"` (agent active), `"chat"` (relay active), `"idle"` (neither)
- Who sets it: agent on connect? relay on first message?
- Conflict resolution: what if both try to handle at once?

**Action:** Define in `apps/relay/docs/room-coordination.md`.

---

### 🚨 Gap 5: Session Persistence Schema
**What's missing:** What exactly gets persisted? Where? SQLite schema.  
**Needed:**
- Table: `sessions` (columns: `sessionId`, `sessionKey`, `openclawSessionId`, `roomName`, `userId`, `lastActivity`, `state`)
- Indices: by `sessionId`, by `sessionKey`, by `roomName`
- Cleanup policy: delete after N days inactive?

**Action:** Define in `apps/relay/docs/session-persistence.md`.

---

### 🚨 Gap 6: Error Recovery Strategies
**What's missing:** Specific failure modes and retry logic.  
**Needed:**
- OpenClaw unreachable → retry? surface error to client immediately?
- LiveKit disconnect → buffer messages? drop them?
- Malformed JSON-RPC → return `PARSE_ERROR` (-32700) or drop silently?
- Session not found on `session/message` → return error or auto-create?

**Action:** Define in `apps/relay/docs/error-handling.md`.

---

## Dependencies (External to Relay)

| System | Dependency | Status | Notes |
|--------|------------|--------|-------|
| **OpenClaw Gateway** | Running locally, reachable at `http://localhost:8080` (or configured URL) | ✅ Assumed | Relay does NOT install or manage OpenClaw. User brings their own. |
| **LiveKit Server** | Cloud or self-hosted, WebRTC + data channel support | ✅ Assumed | Bundled with Fletcher installer (Epic 7). |
| **Token Server** | HTTP service for issuing LiveKit tokens | ⚠️ Needs update | Must add relay signal on token issue (Gap 3). |
| **Flutter App** | LiveKit client, data channel subscription | ⏳ Epic 22 | Tasks 042-051 depend on relay being complete. |

---

## Implementation Order (Recommended)

1. **R-001 to R-005** (Phase 1) — Get basic transport working. Test with mock echo.
2. **Resolve Gap 1** — Specify OpenClaw API contract by inspecting running Gateway or reading source.
3. **R-006 to R-010** (Phase 2) — Wire OpenClaw integration. Test with real OpenClaw instance.
4. **Resolve Gaps 2, 3, 4** — Define data channel protocol, token server signal, room coordination.
5. **R-011 to R-014** (Phase 3) — Add lifecycle and health. Relay is now MVP-complete.
6. **Flutter integration** — Epic 22 tasks 042-051 can proceed in parallel once relay is stable.
7. **R-015 to R-016** (Phase 4) — Add Ganglia support (optional, can defer).
8. **R-017 to R-019** (Phase 5) — Add advanced features as needed.

---

## Success Criteria

**Relay is implementation-ready when:**

✅ All 6 critical gaps have documented specs (in `apps/relay/docs/`)  
✅ Tasks R-001 to R-014 have individual spec files in `apps/relay/tasks/relay-mvp/`  
✅ A coding agent (Claude Code) can implement each task without asking clarifying questions  
✅ The relay can be tested independently of the Flutter app (using a test client or `websocat`)  

**Epic 22 is unblocked when:**

✅ Relay MVP (R-001 to R-014) is implemented and tested  
✅ Relay exposes JSON-RPC 2.0 over LiveKit data channel  
✅ Relay successfully proxies messages to OpenClaw and streams responses back  

---

## Next Steps for Static (This Subagent)

1. **Create gap-filling spec docs** in `apps/relay/docs/`:
   - `openclaw-api-contract.md` (Gap 1)
   - `data-channel-protocol.md` (Gap 2)
   - `token-server-integration.md` (Gap 3)
   - `room-coordination.md` (Gap 4)
   - `session-persistence.md` (Gap 5)
   - `error-handling.md` (Gap 6)

2. **Rewrite relay epic tasks** in `apps/relay/tasks/relay-mvp/` (R-001 to R-014) to match the LiveKit + OpenClaw architecture (replacing the outdated WebSocket + Claude SDK tasks).

3. **Present this plan to Andre** for approval before proceeding with detailed task specs.

---

## Anti-Goals (What This Plan Does NOT Cover)

❌ **Flutter app changes** — Epic 22 tasks 042-051 are separate (handled by Fletcher repo)  
❌ **OpenClaw modifications** — Relay uses OpenClaw as-is via HTTP API  
❌ **LiveKit server setup** — Assumed to be running (Epic 7 handles installer)  
❌ **Token server implementation** — Only the signal endpoint addition (Gap 3)  
❌ **Voice agent changes** — Ganglia redirect (R-015/R-016) is optional Phase 4  

---

**End of Execution Plan**

This document is the "map" for building the relay. The next step is to fill in the gaps (6 spec docs) and then create the 14 implementation task specs. Once those exist, a coding agent can build the relay without further architectural input.
