# Task 005: Client State Machine (Agent Presence Lifecycle)

**Epic:** 20 — Agent Cost Optimization
**Status:** [ ]
**Priority:** High

## Problem

The Flutter client currently assumes the agent is always present once connected to a room. With on-demand dispatch, the client needs to manage two distinct modes: "agent absent" (local VAD active) and "agent present" (normal conversation). The transitions between these modes must be smooth and handle edge cases.

## Solution

Implement a state machine in the Flutter client that manages agent presence lifecycle.

## States

```
┌─────────────┐     speech detected     ┌──────────────┐
│             │ ──────────────────────> │              │
│ AGENT_ABSENT│                         │ DISPATCHING  │
│ (local VAD) │ <────────────────────── │              │
│             │     dispatch failed     │              │
└─────────────┘                         └──────┬───────┘
      ▲                                        │
      │                                        │ agent connected
      │                                        ▼
      │         agent-disconnected      ┌──────────────┐
      │ ◄────────────────────────────── │              │
      │                                 │ AGENT_PRESENT│
      │         agent-idle-warning      │ (normal mode)│
      │                ┌───────────────>│              │
      │                │                └──────────────┘
      │         ┌──────┴───────┐
      │ ◄────── │  IDLE_WARNING│
      │  timeout│              │
      │         └──────────────┘
                 user speaks → resets to AGENT_PRESENT
```

### State Descriptions

| State | Local VAD | Agent | UI Indicator |
|---|---|---|---|
| `AGENT_ABSENT` | Running | Not connected | Subtle "tap or speak" hint |
| `DISPATCHING` | Stopped | Connecting | "Summoning..." spinner |
| `AGENT_PRESENT` | Stopped | Connected | Normal conversation UI |
| `IDLE_WARNING` | Stopped | Connected, about to leave | "Going idle in 30s" |

## Implementation

### 1. `AgentPresenceState` enum

```dart
enum AgentPresenceState {
  agentAbsent,    // Local VAD active, waiting for speech
  dispatching,    // Speech detected, dispatch in progress
  agentPresent,   // Agent connected, normal conversation
  idleWarning,    // Agent about to disconnect
}
```

### 2. Integration with existing services

- **`LiveKitService`** — listen for participant connect/disconnect events to detect agent arrival/departure
- **`LocalVadService`** (Task 003) — start/stop based on state transitions
- **Data channel** — listen for `agent-idle-warning` and `agent-disconnected` events from agent (Task 004)
- **Dispatch endpoint** — call `POST /dispatch-agent` (Task 002) on speech detection

### 3. Edge cases

- **User speaks during DISPATCHING** — buffer or ignore; agent will pick up speech once connected
- **Dispatch fails** — retry once, then fall back to AGENT_ABSENT with error toast
- **Agent crashes during AGENT_PRESENT** — existing session error handling triggers; transition to AGENT_ABSENT
- **User force-closes app during DISPATCHING** — agent may connect to empty room; departure_timeout handles cleanup
- **Multiple rapid speech/silence cycles** — debounce dispatch calls (don't re-dispatch if already DISPATCHING)
- **Network loss during DISPATCHING** — existing connectivity service handles; retry on network restore

## Files to Create/Modify

- `apps/mobile/lib/services/agent_presence_service.dart` — new state machine service
- `apps/mobile/lib/services/livekit_service.dart` — integrate agent presence detection
- `apps/mobile/lib/services/local_vad_service.dart` — start/stop based on state
- `apps/mobile/lib/widgets/` — UI indicators for each state

## Acceptance Criteria

- [ ] State machine correctly transitions through all states
- [ ] Local VAD starts when agent is absent, stops when agent connects
- [ ] Dispatch is triggered on speech detection (debounced)
- [ ] Client handles dispatch failure gracefully (retry + fallback)
- [ ] Agent crash transitions client back to AGENT_ABSENT
- [ ] `agent-idle-warning` shows countdown in UI
- [ ] `agent-disconnected` transitions to AGENT_ABSENT and restarts local VAD
- [ ] No duplicate dispatches during rapid state changes

## Dependencies

- Task 002 (Dispatch Endpoint)
- Task 003 (Client-Side VAD)
- Task 004 (Agent Idle Timeout)
