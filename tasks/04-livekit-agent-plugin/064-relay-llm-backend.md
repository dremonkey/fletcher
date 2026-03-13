# Task 064: Relay-Mediated LLM Backend (`GANGLIA_TYPE=relay`)

**Status:** [ ] Not started
**Epic:** 04 (Ganglia / Brain Plugin)
**Cross-ref:** [Epic 22 — Dual-Mode Architecture](../22-dual-mode/EPIC.md)

## Problem

The voice-agent currently spawns its own ACP subprocess (`GANGLIA_TYPE=acp`) to talk to OpenClaw. This works but has two drawbacks:

1. **Docker image bloat** — the voice-agent container must bundle `acp-client`, Python, and the OpenClaw CLI just to run a subprocess.
2. **OpenClaw volume mount** — the voice-agent Docker service mounts the host OpenClaw directory so the ACP subprocess can access it. This is a tight coupling that makes the voice-agent non-portable and impossible to run on a different machine from OpenClaw.
3. **Cloud deployment barrier** — in a cloud or multi-tenant setup, every voice-agent pod needs local access to an OpenClaw process. Routing through the relay (which already manages ACP subprocesses) eliminates this requirement.

## Solution

Add a new Ganglia backend (`GANGLIA_TYPE=relay`) that routes LLM requests through the Fletcher Relay via the LiveKit data channel, instead of spawning its own ACP subprocess. The relay already has a working ACP client — we just need a new data channel topic (`voice-acp`) and a Ganglia backend that speaks it.

```
CURRENT (GANGLIA_TYPE=acp):
  Voice Agent → ACP subprocess → OpenClaw

PROPOSED (GANGLIA_TYPE=relay):
  Voice Agent → data channel ("voice-acp") → Relay → ACP subprocess → OpenClaw
```

Both the voice-agent and the relay are already in the same LiveKit room. The relay already bridges data channel messages to ACP for chat mode. This extends that to voice mode.

## Phases

### Phase 1: Relay-Side `voice-acp` Data Channel Handler

Add a handler in the relay that listens on the `voice-acp` data channel topic. When the voice-agent sends a chat request over this topic, the relay forwards it to its existing ACP subprocess and streams results back.

**Wire protocol (JSON-RPC 2.0 over data channel):**

```jsonc
// Voice agent → Relay (request)
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "session/message",
  "params": {
    "role": "user",
    "content": "Hello, how are you?",
    "session_key": "owner:main"
  }
}

// Relay → Voice agent (streaming chunks via notifications)
{
  "jsonrpc": "2.0",
  "method": "session/chunk",
  "params": {
    "request_id": "req-1",
    "delta": { "content": "I'm doing " },
    "type": "content"
  }
}

// Relay → Voice agent (final result)
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "result": {
    "content": "I'm doing great, thanks for asking!",
    "finish_reason": "stop"
  }
}
```

**Files to modify:**
- `apps/relay/src/room-handler.ts` — add `voice-acp` topic subscription
- `apps/relay/src/acp/bridge.ts` — extend bridge to handle voice-agent requests (or create `voice-acp-bridge.ts`)

**Acceptance criteria:**
- [ ] Relay subscribes to `voice-acp` data channel topic when voice-agent participant is present
- [ ] Requests forwarded to existing ACP subprocess
- [ ] Streaming chunks sent back as JSON-RPC notifications
- [ ] Final result sent as JSON-RPC response
- [ ] Abort/cancellation propagated when voice-agent sends cancel or disconnects

### Phase 2: Ganglia `RelayLLM` Backend

New Ganglia backend class that implements `GangliaLLM` by sending requests over the LiveKit data channel instead of HTTP or ACP subprocess.

**Files to create/modify:**
- `packages/livekit-agent-ganglia/src/relay-llm.ts` — `RelayLLM` class
- `packages/livekit-agent-ganglia/src/relay-stream.ts` — `RelayChatStream` extending `LLMStream`
- `packages/livekit-agent-ganglia/src/factory.ts` — register `relay` backend
- `packages/livekit-agent-ganglia/src/index.ts` — export new classes

**Key design decisions:**
- `RelayLLM` needs a reference to the LiveKit `Room` (or `LocalParticipant`) to publish on the `voice-acp` topic
- The room reference must be injected after `createGangliaFromEnv()` since the room isn't available at factory time — use `setRoom(room)` or lazy init on first `chat()` call
- `RelayChatStream` maps incoming JSON-RPC notifications to `ChatChunk` events, matching the existing `AcpChatStream` output interface
- Pondering, onContent, and abort signal all work the same as `AcpLLM`

**Acceptance criteria:**
- [ ] `registerGanglia('relay', ...)` in factory
- [ ] `RelayLLM` implements `GangliaLLM` interface
- [ ] `RelayChatStream` emits `ChatChunk` events from data channel messages
- [ ] Abort signal cancels in-flight request (sends JSON-RPC cancel notification)
- [ ] Pondering timer works identically to AcpLLM
- [ ] Unit tests for stream parsing, abort, error handling

### Phase 3: Voice-Agent Wiring

Wire `GANGLIA_TYPE=relay` in the voice-agent, passing the LiveKit room to `RelayLLM`.

**Files to modify:**
- `apps/voice-agent/src/agent.ts` — pass room to Ganglia when type is `relay`
- `apps/voice-agent/src/env.ts` — accept `GANGLIA_TYPE=relay`

**Acceptance criteria:**
- [ ] `GANGLIA_TYPE=relay` selects RelayLLM backend
- [ ] Room reference injected after job acceptance
- [ ] Voice pipeline works end-to-end through relay
- [ ] Fallback to `acp` if relay participant not in room (stretch goal)

### Phase 4: Cleanup & Deployment

- [ ] Remove `acp-client` dependency from voice-agent Dockerfile (when relay backend is default)
- [ ] Remove OpenClaw volume mount from voice-agent in `docker-compose.yml` — the voice-agent no longer needs direct filesystem access to OpenClaw
- [ ] Remove ACP-related env vars from voice-agent service in `docker-compose.yml` (`ACP_AGENT_CMD`, `ACP_AGENT_ARGS`, `OPENCLAW_DIR`, etc.)
- [ ] Update `.env.example` with `GANGLIA_TYPE=relay` option
- [ ] Remove any OpenClaw/Python dependencies from voice-agent `package.json` or install scripts
- [ ] Field test: verify latency overhead of relay hop is acceptable (<50ms added)
- [ ] Verify voice-agent Docker image size reduction after removing OpenClaw dependencies

## Latency Considerations

The relay adds one network hop (data channel round-trip within the same LiveKit room). For co-located deployments (same machine), this should add <10ms. For cloud deployments (same region), <30ms. The LLM backend is the dominant latency factor (300-800ms TTFT), so the relay hop is negligible.

## Dependencies

- **Fletcher Relay** (`apps/relay`) — must be running in the room
- **`packages/acp-client`** — relay's existing ACP subprocess management
- **LiveKit data channel** — reliable ordered delivery for JSON-RPC messages

## References

- [Brain Plugin architecture](../../docs/architecture/brain-plugin.md)
- [Voice Pipeline architecture](../../docs/architecture/voice-pipeline.md)
- [Epic 22 — Dual-Mode Architecture](../22-dual-mode/EPIC.md)
- [Epic 24 — WebRTC ACP Relay](../24-webrtc-acp-relay/EPIC.md)
- [ACP transport spec](../../apps/relay/docs/acp-transport.md)
