# Task 040: Relay Reconnection System Events (BUG-016)

## Problem

The UI shows errors when the relay disconnects (e.g., "Relay not connected — try again"), but there is no corresponding success event when the relay successfully rejoins. The user doesn't know if the relay is back online until they try to send a message.

**Field test:** [BUG-016](../../docs/field-tests/20260313-buglog.md)
**Frequency:** 100% — by design (missing feature)

## Investigation

### Current behavior

The mobile already receives `ParticipantConnectedEvent` and `ParticipantDisconnectedEvent` for the relay participant (identity: `relay-<roomName>`), but the handlers don't distinguish relay from voice-agent:

- **`ParticipantConnectedEvent`** (`livekit_service.dart:582-612`): Emits a generic "connected - ready" system event with `SystemEventType.agent` for **any** participant, including the relay. Misleading.
- **`ParticipantDisconnectedEvent`** (`livekit_service.dart:614-638`): Emits a generic "disconnected" event for any participant. `agentPresenceService.onAgentDisconnected()` only fires when `remaining == 0`.

### The fix is simple

The mobile already has `_hasRelayParticipant` (`livekit_service.dart:1397-1400`) which checks for the `relay-` identity prefix. The same check can be added to the participant event handlers to emit relay-specific system events.

### Relevant code

- `participant-filter.ts:9`: `RELAY_IDENTITY_PREFIX = "relay-"` — canonical prefix
- `livekit_service.dart:582-612`: `ParticipantConnectedEvent` handler
- `livekit_service.dart:614-638`: `ParticipantDisconnectedEvent` handler
- `livekit_service.dart:1397-1400`: `_hasRelayParticipant` — existing relay detection
- `models/system_event.dart`: `SystemEvent` model and `SystemEventType` enum

## Proposed Fix

### Mobile: Distinguish relay in participant event handlers

**File:** `apps/mobile/lib/services/livekit_service.dart`

In `ParticipantConnectedEvent` handler, add relay detection before the existing agent logic:

```dart
_listener?.on<ParticipantConnectedEvent>((event) {
  // Check if this is the relay participant
  if (event.participant.identity?.startsWith('relay-') == true) {
    _emitSystemEvent(SystemEvent(
      id: 'relay-connected-${DateTime.now().millisecondsSinceEpoch}',
      type: SystemEventType.room,
      status: SystemEventStatus.success,
      message: 'relay connected',
      timestamp: DateTime.now(),
      prefix: '\u25B8',  // ▸
    ));
    return;  // Don't process as agent
  }
  // ... existing agent handling ...
});
```

In `ParticipantDisconnectedEvent` handler, same pattern:

```dart
_listener?.on<ParticipantDisconnectedEvent>((event) {
  // Check if this is the relay participant
  if (event.participant.identity?.startsWith('relay-') == true) {
    _emitSystemEvent(SystemEvent(
      id: 'relay-disconnected-${DateTime.now().millisecondsSinceEpoch}',
      type: SystemEventType.room,
      status: SystemEventStatus.error,
      message: 'relay disconnected',
      timestamp: DateTime.now(),
      prefix: '\u2715',  // ✕
    ));
    return;  // Don't count toward agent presence
  }
  // ... existing agent handling ...
});
```

## Edge Cases

- **Relay restart:** Rapid disconnect → reconnect produces two system events in quick succession. Acceptable — the user sees the relay went away and came back.
- **Multiple relays (future):** Each would get its own event. Fine for now.
- **Agent vs relay count:** By returning early for relay participants, `healthService.updateAgentPresent()` won't count the relay, which is correct — the relay is not a voice agent.

## Acceptance Criteria

- [ ] System event "relay connected" (green) appears when relay joins/rejoins the room
- [ ] System event "relay disconnected" (red) appears when relay leaves
- [ ] Voice agent connect/disconnect events are unchanged (regression check)
- [ ] `healthService.updateAgentPresent()` does not count relay as an agent

## Files

- `apps/mobile/lib/services/livekit_service.dart` — add relay identity check in participant handlers

## Status

**Date:** 2026-03-13
**Priority:** Low
**Status:** Complete ✅
**Field test:** [BUG-016](../../docs/field-tests/20260313-buglog.md)
