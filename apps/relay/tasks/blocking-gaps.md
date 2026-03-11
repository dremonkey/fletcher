# Fletcher Relay — Blocking Gaps (Must Resolve Before Implementation)

**Date:** 2026-03-10  
**Status:** 🚨 BLOCKING  
**For:** Andre / Glitch

---

## Summary

The Fletcher Relay architecture is **well-designed** and the high-level strategy is sound. However, **6 critical specifications are missing** that would block a coding agent from implementing the relay immediately. These gaps are all **research and documentation tasks** — no code changes required yet.

**What's needed:** Detailed specs for integration points between the relay and its dependencies (OpenClaw, LiveKit data channel, token server, room coordination).

---

## The 6 Critical Gaps

### 🚨 Gap 1: OpenClaw Gateway API Contract
**What's missing:** Exact HTTP endpoints, request/response schemas, session key handling.

**Why it blocks:** The relay's core job is to proxy between the mobile app and OpenClaw. Without knowing the exact API, we can't implement the OpenClaw bridge (task R-006).

**What we need to specify:**
- `POST /v1/sessions` — how to create a session? what params? what does the response look like?
- `POST /v1/chat/completions` — how to send a message? where does the session key go (header? body field?)?
- SSE stream format — what does a text delta look like? how are artifacts encoded in the stream?
- Error responses — what HTTP status codes? what JSON structure?

**How to resolve:**
1. Read OpenClaw Gateway source code (if available locally)
2. OR run OpenClaw Gateway and inspect its API with curl/Postman
3. OR read OpenClaw docs if they exist

**Deliverable:** `apps/relay/docs/openclaw-api-contract.md` with verified examples.

---

### 🚨 Gap 2: Data Channel Topic & Message Routing
**What's missing:** Exact data channel topic name, message envelope format.

**Why it blocks:** The relay and the Flutter app need to agree on how JSON-RPC messages are packaged and routed over the LiveKit data channel.

**What we need to specify:**
- Topic name: is it `"relay"`? or something else?
- Message format: raw JSON-RPC string sent as data channel payload? or wrapped in an envelope like `{ type: "rpc", payload: {...} }`?
- Routing: how does the mobile app differentiate relay messages from `ganglia-events` (artifacts from voice mode)? Same channel with message type field? Or separate channels?

**How to resolve:**
1. Review the existing Flutter code that subscribes to `ganglia-events` data channel
2. Decide: reuse same channel with type routing, or create separate `relay` channel
3. Document the chosen approach

**Deliverable:** `apps/relay/docs/data-channel-protocol.md`.

---

### 🚨 Gap 3: Token Server Signal API
**What's missing:** HTTP endpoint spec for token server → relay "join room X" signal.

**Why it blocks:** The relay lifecycle depends on the token server telling it when to join a room. Without this API, the relay doesn't know when to connect.

**What we need to specify:**
- Endpoint: `POST /relay/join` (example)
- Request body: `{ roomName: string, userId?: string }`
- Response: `{ success: boolean }` or error
- Security: localhost-only? shared secret auth?
- Error cases: room already joined? relay offline?

**How to resolve:**
1. Design a simple HTTP API for the token server to call
2. Decide on security model (localhost-only is simplest)
3. Document request/response schemas

**Deliverable:** `apps/relay/docs/token-server-integration.md`.

---

### 🚨 Gap 4: Room Metadata for Agent/Relay Coordination
**What's missing:** Schema for room metadata to signal which mode (voice/chat) is active.

**Why it blocks:** The agent and relay need to know who's handling messages to avoid double-processing. Room metadata is how they coordinate.

**What we need to specify:**
- Metadata key: `mode` (example)
- Values: `"voice"` (agent active), `"chat"` (relay active), `"idle"` (neither)
- Who sets it: agent on connect? relay on first message?
- Conflict resolution: what if both are in the room at once? does relay check metadata before responding?
- Transition protocol: when switching voice → chat, who clears the old metadata?

**How to resolve:**
1. Define a simple state machine for mode transitions
2. Specify which participant sets/clears metadata in each transition
3. Document the metadata schema

**Deliverable:** `apps/relay/docs/room-coordination.md`.

---

### 🚨 Gap 5: Session Persistence Schema
**What's missing:** What exactly gets persisted? Where? SQLite schema.

**Why it blocks:** The relay needs to survive restarts and handle reconnections. Without a persistence spec, we can't implement session resumption (task R-010).

**What we need to specify:**
- Storage backend: SQLite (local file)
- Table schema: `sessions` table with columns:
  - `sessionId` (UUID, primary key)
  - `sessionKey` (from OpenClaw, used to resume conversation)
  - `openclawSessionId` (OpenClaw's internal session ID)
  - `roomName` (LiveKit room this session is associated with)
  - `userId` (optional, from token metadata)
  - `lastActivity` (timestamp, for cleanup)
  - `state` (enum: active, idle, completed, error)
- Indices: by `sessionId`, by `sessionKey`, by `roomName`
- Cleanup policy: delete sessions older than N days?

**How to resolve:**
1. Design SQLite schema based on session lifecycle needs
2. Decide on retention policy
3. Document schema + example SQL

**Deliverable:** `apps/relay/docs/session-persistence.md`.

---

### 🚨 Gap 6: Error Recovery Strategies
**What's missing:** Specific failure modes and retry logic.

**Why it blocks:** Without error handling specs, a coding agent will make arbitrary choices (retry indefinitely? fail fast?) that might not match the desired UX.

**What we need to specify:**
- **OpenClaw unreachable:** Retry with backoff? Surface error to client immediately? Max retries before giving up?
- **LiveKit disconnect:** Buffer messages? Drop them? Close session?
- **Malformed JSON-RPC from client:** Return standard JSON-RPC error (`PARSE_ERROR` -32700)? Or drop silently?
- **Session not found on `session/message`:** Return error to client? Auto-create new session? (probably error)
- **OpenClaw times out mid-stream:** Send `session/error` to client? Retry? Mark session as failed?

**How to resolve:**
1. For each failure mode, decide: retry, fail, or defer to client
2. Document retry policies (max attempts, backoff strategy)
3. Specify error response formats

**Deliverable:** `apps/relay/docs/error-handling.md`.

---

## Impact on Timeline

**If we proceed without resolving these gaps:**
- Coding agent will ask 50+ clarifying questions mid-implementation
- Arbitrary decisions will get baked in and require refactoring
- Integration testing will fail because Flutter and relay don't agree on protocol

**If we resolve these gaps first:**
- All 14 relay tasks (R-001 to R-014) can be implemented with ZERO architectural questions
- Integration with Flutter (Epic 22) will be smooth — protocols already defined
- Testing can start immediately after implementation

**Estimated time to resolve all 6 gaps:** 2-4 hours of research + documentation (for a human or Static working together).

---

## Recommended Next Steps

1. **Andre decides:** Should Static (this subagent) proceed to research and draft the 6 gap docs? Or should Glitch handle some of these?

2. **If Static proceeds:**
   - **Gap 1:** Static reads OpenClaw Gateway source/docs and drafts API contract
   - **Gap 2:** Static reviews Flutter data channel code and proposes protocol
   - **Gap 3:** Static drafts token server signal API (simple design, no dependencies)
   - **Gap 4:** Static drafts room coordination protocol (state machine)
   - **Gap 5:** Static drafts SQLite schema (straightforward)
   - **Gap 6:** Static drafts error handling strategies (policy decisions)

3. **Then:** Static creates the 14 detailed task specs (R-001 to R-014) in `apps/relay/tasks/relay-mvp/`.

4. **Then:** A coding agent (Claude Code or similar) can implement the relay with zero architectural input needed.

---

## What's NOT Blocking

These are well-defined and ready to go once the gaps are filled:
- ✅ High-level architecture (LiveKit participant + OpenClaw proxy)
- ✅ JSON-RPC 2.0 protocol (standard, well-documented)
- ✅ Economic justification (60x cost savings)
- ✅ Network resilience rationale (ICE restart via LiveKit)
- ✅ Relay lifecycle (join on demand, idle timeout)

The foundation is solid. We just need to nail down the integration details.

---

**End of Blocking Gaps Summary**

This document identifies what's missing. `relay-execution-plan.md` explains how to build the relay once gaps are filled.
