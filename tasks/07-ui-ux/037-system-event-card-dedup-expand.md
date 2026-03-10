# Task 037: Deduplicate Agent System Events & Expandable Long Rows

## Problem

Observed in field testing (2026-03-10 screenshot):

1. **Duplicate AGENT Connected rows** — Two cards appear on every agent wake-up:
   - `▸ AGENT   connected · ready   HH:MM:SS`
   - `▸ AGENT   Connected           HH:MM:SS`

2. **Duplicate AGENT Disconnected rows** — Two cards appear on every disconnect:
   - `✕ AGENT   disconnected                         HH:MM:SS`
   - `✕ AGENT   Disconnected — speak to reconnect    HH:MM:SS`

3. **Wrong reconnect hint** — "speak to reconnect" should read "speak **or text** to reconnect"
   (text input also wakes the agent).

4. **Long messages truncated with ellipsis** — Any system event card whose message
   overflows is silently clipped (`overflow: TextOverflow.ellipsis`). The user can't read
   the full text. Tapping a long card should expand it to show the full message. This
   applies to **all** system event cards.

---

## Root Cause

Two separate code paths both emit "agent connected" and "agent disconnected" events with
**different IDs**, bypassing the update-in-place deduplication in `_emitSystemEvent()`.

### Connected duplicates

| Source | ID | Message |
|--------|----|---------|
| `livekit_service.dart:587–594` | `'agent-boot'` | `'connected · ready'` |
| `agent_presence_service.dart:186–191` | `'agent-reconnected'` | `'Connected'` |

Both fire on `ParticipantConnectedEvent`. `livekit_service` emits `agent-boot`, then
calls `agentPresenceService.onAgentConnected()`, which transitions `dispatching →
agentPresent` and fires `agent-reconnected` through the `onSystemEvent` callback.

### Disconnected duplicates

| Source | ID | Message |
|--------|----|---------|
| `livekit_service.dart:610–617` | `'agent-disconnect-{timestamp}'` (unique) | `'disconnected'` |
| `agent_presence_service.dart:171–175` | `'agent-idle-disconnect'` | `'Disconnected — speak to reconnect'` |

Both fire on `ParticipantDisconnectedEvent`. `livekit_service` emits its own card, then
calls `agentPresenceService.onAgentDisconnected()`, which fires `agent-idle-disconnect`
through the callback. The timestamp-keyed ID ensures the `livekit_service` card always
appends a new row.

---

## Proposed Fix

### 1. Remove the weaker duplicate emissions

**`agent_presence_service.dart:185–191`** — remove the `'agent-reconnected'` case.
`livekit_service` already emits the richer `'connected · ready'` card:

```dart
// BEFORE
case AgentPresenceState.agentPresent:
  if (from == AgentPresenceState.dispatching) {
    onSystemEvent!(
      'agent-reconnected',
      'AGENT',
      'Connected',
    );
  } else if (from == AgentPresenceState.idleWarning) {
    // ...
  }

// AFTER
case AgentPresenceState.agentPresent:
  // 'agent-boot' (emitted by livekit_service on ParticipantConnectedEvent)
  // already shows 'connected · ready' — no second card needed here.
  if (from == AgentPresenceState.idleWarning) {
    onSystemEvent!(
      'agent-idle-cancelled',
      'AGENT',
      'Staying connected',
    );
  }
```

**`livekit_service.dart:609–617`** — remove the raw `'agent-disconnect-{timestamp}'`
emission. `agent_presence_service` emits the richer `'Disconnected — speak or text to
reconnect'` card via its callback:

```dart
// REMOVE this block entirely:
// Emit agent disconnected system event (task 020)
_emitSystemEvent(SystemEvent(
  id: 'agent-disconnect-${DateTime.now().millisecondsSinceEpoch}',
  type: SystemEventType.agent,
  status: SystemEventStatus.error,
  message: 'disconnected',
  timestamp: DateTime.now(),
  prefix: '\u2715',
));
```

### 2. Fix the reconnect hint copy

**`agent_presence_service.dart:174`:**

```dart
// BEFORE
'Disconnected \u2014 speak to reconnect',

// AFTER
'Disconnected \u2014 speak or text to reconnect',
```

Also update the idle warning hint at line 204 for consistency (it says "speak to stay" —
text also keeps the session alive):

```dart
// BEFORE
'Going idle in 30s \u2014 speak to stay',

// AFTER
'Going idle in 30s \u2014 speak or text to stay',
```

### 3. Expandable long rows in SystemEventCard

Convert `SystemEventCard` from `StatelessWidget` to `StatefulWidget`. Add a `_expanded`
flag toggled by a `GestureDetector`. When expanded, remove `maxLines` and `overflow`
constraints. Show a subtle expand hint only when the text actually overflows.

```dart
// system_event_card.dart

class SystemEventCard extends StatefulWidget {
  final SystemEvent event;
  const SystemEventCard({super.key, required this.event});

  @override
  State<SystemEventCard> createState() => _SystemEventCardState();
}

class _SystemEventCardState extends State<SystemEventCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => setState(() => _expanded = !_expanded),
      child: TuiCard(
        borderColor: AppColors.cyan,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(widget.event.prefix, style: ...),
                const SizedBox(width: AppSpacing.sm),
                Text(widget.event.typeLabel, style: ...),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 300),
                    child: Text(
                      widget.event.message,
                      key: ValueKey('...'),
                      style: ...,
                      // When collapsed: single line with ellipsis
                      // When expanded: full text, no limit
                      maxLines: _expanded ? null : 1,
                      overflow: _expanded
                          ? TextOverflow.visible
                          : TextOverflow.ellipsis,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Text(_formatTimestamp(widget.event.timestamp), style: ...),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
```

Use `LayoutBuilder` + `TextPainter` if you want to hide the expand affordance on rows
that don't overflow, but a tap-to-toggle on all cards is acceptable and simpler.

---

## Edge Cases

**Presence service disabled** (`agentPresenceService.enabled == false`): In this mode,
`onAgentDisconnected()` returns early without emitting `agent-idle-disconnect`. Removing
the `livekit_service` disconnect card means no card appears on disconnect. This is
acceptable — when presence service is off, the agent never intentionally disconnects via
idle timeout.

**Rapid connect/disconnect**: `livekit_service` emits `agent-boot` on every
`ParticipantConnectedEvent`. Because the ID is fixed (`'agent-boot'`), rapid reconnects
update the existing card in place rather than accumulating rows. This is the existing
correct behavior.

**Expand state survives message transitions**: `AnimatedSwitcher` uses a `ValueKey` on
the message. If the message updates while expanded, the widget rebuilds with the new
text. The `_expanded` flag is on the outer `State` and is not reset — user keeps the
expanded view. This is fine.

**"Staying connected" still needs to show**: The `idleWarning → agentPresent` path in
`agent_presence_service` must NOT be removed — only the `dispatching → agentPresent`
`'Connected'` message is removed.

---

## Acceptance Criteria

- [ ] On agent wake-up, only ONE "connected" system event card appears in the transcript
      (shows `'connected · ready'`).
- [ ] On agent disconnect (idle timeout), only ONE disconnect card appears
      (`'Disconnected — speak or text to reconnect'`).
- [ ] "speak to reconnect" no longer appears anywhere; copy reads "speak or text to reconnect".
- [ ] "speak to stay" no longer appears; copy reads "speak or text to stay".
- [ ] Tapping any system event card with a long message expands it to show the full text.
- [ ] Tapping again collapses it back to single-line.
- [ ] Short messages (that don't overflow) are unaffected by the tap toggle (text
      remains the same whether expanded or not).
- [ ] No regression: "Connecting...", "Staying connected", idle warning cards still appear
      as before.

---

## Files

- `apps/mobile/lib/services/agent_presence_service.dart` — remove `agent-reconnected`
  emission; fix copy for `agent-idle-disconnect` and `agent-idle-warning`
- `apps/mobile/lib/services/livekit_service.dart` — remove `agent-disconnect-{timestamp}`
  emission block
- `apps/mobile/lib/widgets/system_event_card.dart` — convert to StatefulWidget,
  add tap-to-expand

---

## Status

**Date:** 2026-03-10
**Priority:** Low (cosmetic / UX polish)
**Status:** Ready to implement
**Field test:** [2026-03-10 session](../../docs/field-tests/20260310-buglog.md)
