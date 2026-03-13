# Task 046: Mode Switch Controller

**Epic:** 22 — Dual-Mode Architecture
**Status:** [ ] Not started
**Priority:** Medium
**Depends on:** 053 (Dual-Mode Split), 054 (Mobile ACP Client)

## Problem

The current mode switch is a simple mute/unmute toggle — muted means chat mode (relay), unmuted means voice mode (agent). This works for the MVP but lacks:

1. **Formal state machine** — transitions are implicit side effects of muting, not an explicit state machine. No coordination between agent presence, relay activity, and audio track state.
2. **In-flight response handling** — switching modes mid-response can orphan a streaming reply.
3. **Mode-aware health semantics** — `HealthService` only checks agent presence. In chat mode, agent absence is normal but relay absence is an error. No relay "connected" indicator.
4. **Agent lifecycle coordination** — unmuting dispatches via `AgentPresenceService` (Epic 20), but there's no explicit "entering voice mode" signal. Muting doesn't explicitly release the agent.

## Current State

What exists:
- `toggleInputMode()` switches `TextInputMode.voiceFirst` ↔ `TextInputMode.textInput`
- Muting calls `removePublishedTrack()` (releases mic to `MODE_NORMAL`)
- Unmuting calls `setMicrophoneEnabled(true)` (republishes audio track)
- `AgentPresenceService` handles dispatch on speech detection
- `RelayChatService` handles text routing when muted
- Error codes `-32003`, `-32010`, `-32011` with system events

What's missing:
- Explicit `ConversationMode` state (not just mute state)
- Transition guards (don't switch while response is streaming)
- Mode-aware health checks
- Relay presence indicator in UI

## Design

### State machine

```
                 unmute
    CHAT ─────────────────────▶ VOICE
     │   ◀─────────────────────   │
     │          mute               │
     │                             │
     ▼                             ▼
  relay active                  agent active
  health: check relay           health: check agent
  agent: absent (normal)        relay: passive (normal)
```

### Transitions

**Chat → Voice:**
1. Wait for any in-flight relay response to complete (or cancel it)
2. Publish audio track (`setMicrophoneEnabled(true)`)
3. Agent dispatch triggered by `AgentPresenceService` on speech detection
4. Health switches to agent-centric

**Voice → Chat:**
1. Wait for any in-flight agent response to complete (or let it finish)
2. Unpublish audio track (`removePublishedTrack()`)
3. Agent idles out naturally via `IdleTimeout` (Epic 20) — no explicit kill
4. Health switches to relay-centric

### Health semantics (absorbs 051)

| Check | Voice Mode | Chat Mode |
|-------|-----------|-----------|
| Agent present | Required — show "Degraded" if absent | Ignored — absence is normal |
| Relay present | Ignored — relay is passive | Required — show "Relay disconnected" if absent |
| OpenClaw reachable | Via agent health | Via relay error codes (`-32010`) |

### Persistence

Store current mode in `SharedPreferences`. On app restart, restore last mode. Default: chat mode (cheapest, most reliable).

## Files

- `apps/mobile/lib/services/mode_controller.dart` — new: `ConversationMode` enum, state machine, transition logic
- `apps/mobile/lib/services/livekit_service.dart` — wire mode controller into mute/unmute flow
- `apps/mobile/lib/services/health_service.dart` — mode-aware health checks, relay presence
- `apps/mobile/lib/widgets/diagnostics_bar.dart` — relay "connected" indicator in chat mode

## Acceptance Criteria

- [ ] `ConversationMode` enum (`chat`, `voice`) with explicit state machine
- [ ] Transitions wait for or cancel in-flight responses
- [ ] Health service checks relay presence in chat mode, agent presence in voice mode
- [ ] Relay "connected" / "disconnected" indicator visible in chat mode
- [ ] Agent absence does not show "Degraded" in chat mode
- [ ] Mode persisted across app restarts
- [ ] Unit tests for state machine transitions and health mode switching
