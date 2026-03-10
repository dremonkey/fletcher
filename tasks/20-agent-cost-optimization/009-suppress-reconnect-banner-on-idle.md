# Task 009: Suppress Reconnecting Banner on Intentional Agent Disconnect

**Epic:** 20 — Agent Cost Optimization
**Status:** [ ]
**Priority:** High

## Problem

When the agent disconnects due to idle timeout (on-demand dispatch lifecycle), the "Connection lost. Reconnecting..." banner appears at the top of the screen. This is confusing — the agent left on purpose, and the UX feedback from Task 007 (system events like "Disconnected — speak to reconnect") already communicates what happened. The reconnecting banner implies a network problem, not an expected lifecycle event.

## Root Cause

There are **three code paths** that set `ConversationStatus.reconnecting`:

1. **`RoomReconnectingEvent`** (line ~444) — SDK detects network loss, begins reconnection attempts. **Legitimate** — this is a real network problem.

2. **`TrackUnsubscribedEvent`** (line ~620) — When any remote audio track is unsubscribed, the handler unconditionally sets `ConversationStatus.reconnecting`. This fires during network transitions (BUG-021 fix) but **also fires when the agent intentionally disconnects** after idle timeout, because the agent's audio track gets unsubscribed before the `ParticipantDisconnectedEvent`.

3. **`_reconnectScheduler`** (line ~1451) — Manual reconnect logic with budget timer. **Legitimate** — used for extended reconnect attempts.

The bug is in trigger #2: `TrackUnsubscribedEvent` doesn't distinguish between "track lost due to network" and "track lost because agent left the room."

## Proposed Solution

Guard the `TrackUnsubscribedEvent` handler to skip the reconnecting state when the agent presence service indicates an intentional disconnect:

```dart
_listener?.on<TrackUnsubscribedEvent>((event) {
  debugPrint('[Fletcher] Track unsubscribed: ${event.track.kind} from ${event.participant.identity}');
  if (event.track.kind == TrackType.AUDIO) {
    // Don't show reconnecting banner if the agent is disconnecting
    // intentionally (idle timeout, on-demand dispatch lifecycle).
    final isIntentionalDisconnect = agentPresenceService.enabled &&
        (agentPresenceService.state == AgentPresenceState.idleWarning ||
         agentPresenceService.state == AgentPresenceState.agentAbsent);
    if (!isIntentionalDisconnect) {
      _updateState(status: ConversationStatus.reconnecting);
    }
  }
});
```

Also verify that the `ParticipantDisconnectedEvent` handler doesn't also trigger the banner — it currently doesn't set `ConversationStatus.reconnecting`, but the system event it emits (`agent-disconnect-*`) should be reviewed for consistency.

## All Reconnecting Banner Triggers (Audit)

| Trigger | File:Line | When | Should show banner? |
|---------|-----------|------|---------------------|
| `RoomReconnectingEvent` | livekit_service.dart:~444 | Network loss detected by SDK | **Yes** — real network problem |
| `TrackUnsubscribedEvent` (audio) | livekit_service.dart:~620 | Agent audio track unsubscribed | **Only if not intentional** — guard with agent presence state |
| `_reconnectScheduler.begin()` | livekit_service.dart:~1451 | Manual reconnect after SDK gives up | **Yes** — extended network problem |
| `RoomAttemptReconnectEvent` | livekit_service.dart:~467 | Individual SDK retry attempt | Does not set status (OK) |

## Files to Modify

- `apps/mobile/lib/services/livekit_service.dart` — guard `TrackUnsubscribedEvent` handler

## Acceptance Criteria

- [ ] Reconnecting banner does NOT appear when agent disconnects due to idle timeout
- [ ] Reconnecting banner DOES appear when the network actually drops
- [ ] Reconnecting banner DOES appear when the agent crashes unexpectedly
- [ ] System events (Task 007) still appear correctly in transcript during idle disconnect
- [ ] No regression to BUG-021 (WiFi→5G audio track publish delay)

## Dependencies

- Task 005 (Client State Machine) — provides `AgentPresenceState`
- Task 007 (UX Transition Feedback) — system events that replace the banner
