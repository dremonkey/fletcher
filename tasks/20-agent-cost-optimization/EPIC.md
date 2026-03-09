# Epic 20: Agent Cost Optimization (On-Demand Dispatch)

**Goal:** Eliminate idle agent costs by disconnecting the LiveKit agent when nobody is speaking and re-dispatching it on demand when the user starts talking again.

**Problem:** LiveKit Cloud charges $0.01/min per connected agent, regardless of activity. A user who joins a room, speaks briefly, then goes silent for 2 hours costs $1.20 in agent-minutes for zero value. At multi-tenant scale (100+ users), idle agents become the dominant cost driver — potentially $14,400+/month in pure waste.

**Solution:** Keep the client connected to the room (cheap — $0.0005/min connection-only) but only dispatch the agent when speech is detected. Use client-side VAD (Silero via `vad` Flutter package) to detect speech locally, then trigger agent dispatch via HTTP. Agent auto-disconnects after an idle timeout.

## Cost Model

| Scenario | Per-User/Hour | 100 Users × 8hr/day × 30 days |
|---|---|---|
| Always-on agent (current) | $0.60 | $144,000/mo |
| Client-only room (no agent) | $0.03 | $7,200/mo |
| On-demand (1hr active / 7hr idle) | $0.81 | $19,440/mo |

The on-demand model pays full price during active conversation but drops to connection-only rates during idle periods — a **~7x reduction** for mostly-idle users.

## Architecture

```
Flutter App                         Token Server            LiveKit Cloud
    │                                    │                       │
    │── Connect to room (no agent) ─────>│                       │
    │   (explicit dispatch mode)         │                       │
    │                                    │                       │
    │   Local VAD (Silero on-device)     │                       │
    │   monitors microphone...           │                       │
    │                                    │                       │
    │   Speech detected!                 │                       │
    │                                    │                       │
    │── POST /dispatch-agent ───────────>│                       │
    │                                    │── createDispatch() ──>│
    │                                    │                       │
    │                                    │     Agent connects    │
    │                                    │     (~150ms dispatch) │
    │                                    │                       │
    │<── Conversation happens ───────────│<──────────────────────│
    │                                    │                       │
    │   N min silence...                 │                       │
    │                                    │                       │
    │   Agent calls ctx.shutdown()       │   Billing stops       │
    │   Client falls back to local VAD   │                       │
```

## Status

**Epic Status:** 📋 BACKLOG

## Tasks

### 001: Switch Agent to Explicit Dispatch
Set `agentName` on the voice agent's `ServerOptions` so it only joins rooms when explicitly dispatched (not auto-joining every room). Update token endpoint to use `RoomAgentDispatch` in participant tokens so existing behavior is preserved during migration.

**Status:** [ ]

---

### 002: Add Dispatch Endpoint to Token Server
Create a `POST /dispatch-agent` endpoint that accepts a room name and calls `AgentDispatchClient.createDispatch()` via the LiveKit Server SDK. This is the trigger point the mobile client will call when speech is detected.

**Status:** [ ]

---

### 003: Client-Side VAD Integration (Flutter)
Add the `vad` Flutter package (Silero VAD v5, on-device ONNX) to the mobile app. Run local VAD when no agent is connected. On confirmed speech, call the dispatch endpoint. Stop local VAD once the agent connects (to free the mic for LiveKit's audio track).

**Status:** [ ]

---

### 004: Agent Idle Timeout & Auto-Disconnect
Add an idle timer to the voice agent that calls `ctx.shutdown()` after N minutes of no user speech. Use `UserInputTranscribed` events to reset the timer. Send a data channel event to the client before disconnecting so the client can switch back to local VAD mode.

**Status:** [ ]

---

### 005: Client State Machine (Agent Presence Lifecycle)
Implement a state machine in the Flutter client that manages transitions between `agent_absent` (local VAD active, listening for speech) and `agent_present` (normal conversation mode). Handle edge cases: dispatch failures, agent crash during conversation, user speaking during dispatch latency.

**Status:** [ ]

---

### 006: Cold-Start Latency Mitigation
Measure and optimize the end-to-end latency from speech detection to first agent response. Targets: <500ms dispatch overhead, <3s total first-response time. Investigate LiveKit `prewarm` / `num_idle_processes` for keeping agent processes warm. Consider a "warm-down" grace period before full disconnect.

**Status:** [ ]

---

### 007: UX Polish — Transition Feedback
Design and implement visual/audio feedback for agent lifecycle transitions. User should know when: agent is being summoned (dispatch in progress), agent is ready (connected), agent is going idle (about to disconnect). Leverage existing TUI design system (TuiCard, SystemEvent).

**Status:** [ ]

---

### 008: Integration Test & Cost Validation
End-to-end test of the full lifecycle: connect → local VAD → speech → dispatch → conversation → idle → disconnect → speech → re-dispatch. Validate that agent-minutes billing stops during idle periods. Measure actual cost savings vs. always-on baseline.

**Status:** [ ]

## Latency Budget (First Utterance After Idle)

| Phase | Expected Latency |
|---|---|
| Local VAD detection | ~100-200ms |
| HTTP dispatch request | ~50-150ms |
| LiveKit agent dispatch | ~150ms |
| Agent connect + pipeline start | ~0-500ms |
| STT + LLM + TTS (normal pipeline) | ~1000-2000ms |
| **Total first response** | **~1.5-3s** |

Subsequent responses within the same session have normal latency (~1-1.5s). The cold-start penalty only applies to the first utterance after an idle disconnect.

## Key Decisions

- **Local VAD package:** `vad` on pub.dev (Silero VAD v5, ONNX, MIT license, cross-platform)
- **Dispatch trigger:** HTTP POST from client → token server → `AgentDispatchClient.createDispatch()`
- **Idle timeout:** Configurable (default 5 min), reset on any `UserInputTranscribed` event
- **Agent disconnect method:** `ctx.shutdown()` (graceful, stops billing immediately)
- **No auto-reconnect from server side** — client owns the dispatch decision via local VAD

## Dependencies

- **Epic 2 (Voice Agent)** — agent entry point and session lifecycle
- **Epic 3 (Flutter App)** — mobile client modifications
- **Epic 7 (Sovereign Pairing)** — token endpoint serves dispatch endpoint too
- **Epic 9 (Connectivity)** — reconnection resilience during dispatch
- **Epic 13 (Edge Intelligence)** — local VAD overlaps with Task 004 (Local VAD Evaluation)

## Anti-Goals

- **No wake word** — this is not a "Hey Fletcher" feature. VAD detects any speech, not a specific phrase.
- **No data channel dispatch** — data channel messages aren't received when no agent is connected.
- **No pause/resume** — LiveKit has no built-in pause; we fully disconnect and re-dispatch.

## References

- [LiveKit Agent Dispatch Docs](https://docs.livekit.io/agents/server/agent-dispatch/)
- [LiveKit Cloud Billing](https://docs.livekit.io/deploy/admin/billing/)
- [`vad` Flutter Package](https://pub.dev/packages/vad)
- [LiveKit GitHub Issue #3645: No Pause/Resume](https://github.com/livekit/agents/issues/3645)
- [LiveKit GitHub Issue #3311: Cold Start After Idle](https://github.com/livekit/agents/issues/3311)
