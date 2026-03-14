# TASK-069: Hold Mode Disconnect — "Live Mode Paused" Visual Treatment

**Status:** [ ] Not started
**Priority:** HIGH
**Epic:** 7 — UI Redesign (TUI Brutalist)

## Problem

When the voice agent disconnects due to hold mode (idle timeout), the client shows the same red error treatment as an unexpected crash:

```
✕  AGENT   On hold — tap or speak to resume   14:32:07
```

- `✕` prefix (error symbol)
- `healthRed` text color
- `SystemEventStatus.error` mapping
- Cyan card border (same as all system events)

Additionally, a **duplicate** raw system event fires from the `ParticipantDisconnectedEvent` handler:

```
✕  AGENT   disconnected   14:32:07
```

This makes a graceful idle release look like something went wrong.

## Design

### Hold mode disconnect should feel intentional, not broken

**Current (error):**
```
✕  AGENT   On hold — tap or speak to resume   14:32:07     ← healthRed
✕  AGENT   disconnected                       14:32:07     ← duplicate, also red
```

**Target (neutral/informational):**
```
▸  AGENT   Live mode paused — tap to resume   14:32:07     ← textSecondary (gray)
```

- Single event, no duplicate
- Neutral prefix (`▸` not `✕`)
- `SystemEventStatus.pending` (gray text, not red)
- Message: `"Live mode paused — tap to resume"`

### Non-hold disconnects stay red

When the agent crashes or disconnects unexpectedly (not via `session_hold`), keep the existing error treatment:

```
✕  AGENT   Disconnected — speak to reconnect   14:32:07   ← healthRed (correct)
```

## Implementation

### 1. Add a hold-mode status to the `onSystemEvent` callback

In `LiveKitService._createAgentPresenceService()`, the callback currently maps all `agent-disconnected` events to `SystemEventStatus.error`. Split this:

```dart
onSystemEvent: (id, category, message) {
  final SystemEventStatus status;
  final String prefix;
  if (id == 'agent-dispatching') {
    status = SystemEventStatus.pending;
    prefix = '\u25B8';
  } else if (id == 'agent-disconnected') {
    // Hold mode = neutral info, not an error
    status = _lastDisconnectWasHold
        ? SystemEventStatus.pending
        : SystemEventStatus.error;
    prefix = _lastDisconnectWasHold ? '\u25B8' : '\u2715';
  } else {
    status = SystemEventStatus.success;
    prefix = '\u25B8';
  }
  // ...
}
```

The `_lastDisconnectWasHold` flag can be set alongside `_holdModeActive` and cleared after the system event is emitted.

### 2. Suppress duplicate raw disconnect during hold

In the `ParticipantDisconnectedEvent` handler, skip the raw `agent-disconnect-<ts>` system event when hold mode was active:

```dart
if (!wasHoldMode) {
  _emitSystemEvent(SystemEvent(
    id: 'agent-disconnect-${DateTime.now().millisecondsSinceEpoch}',
    type: SystemEventType.agent,
    status: SystemEventStatus.error,
    message: 'disconnected',
    // ...
  ));
}
```

### 3. Update message text

In `AgentPresenceService._emitTransitionEvent()`, change hold mode message:

```dart
_holdMode
    ? 'Live mode paused \u2014 tap to resume'
    : 'Disconnected \u2014 speak to reconnect',
```

## Files to Modify

- `apps/mobile/lib/services/livekit_service.dart` — hold-aware status mapping in `onSystemEvent` callback, suppress duplicate raw event
- `apps/mobile/lib/services/agent_presence_service.dart` — update hold mode message text

## Dependencies

- Hold mode (TASK-011) — implemented
