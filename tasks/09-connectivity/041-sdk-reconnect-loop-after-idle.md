# Task 041: Fix SDK ICE Reconnect Loop After Agent Idle Disconnect

**Epic:** 09 — Connectivity / Connection Resilience
**Status:** Open
**Priority:** High
**Origin:** Field test BUG-010 (2026-03-10)

## Problem

After the agent goes idle (warm-down expired, 45s timeout in test config), the LiveKit
SDK starts cycling through ICE disconnects roughly every 25-32 seconds. The SDK log shows:

```
SDK reconnect attempt 1/10 → reconnected successfully
  [25-32s later]
SDK reconnect attempt 1/10 → reconnected successfully
  ...
```

Three separate occurrences were observed in the same session:
- 16:44:27 — SDK reconnect AND agent departure happened simultaneously. No "reconnected
  successfully" logged. `Unmute while agent absent — triggering dispatch` at 16:45:05
  showed the room was technically alive, but agent dispatch didn't fire. Tester killed
  app at 16:45:59.
- 16:50:44 — Two simultaneous `SDK reconnect attempt 1/10` events 730ms apart (duplicate
  reconnect handler?). No success logged. App silently recovered by 16:52:24.
- 16:53:43 — Back-to-back ICE drops 25s apart. SDK recovered both times but UI stuck;
  tester force-quit at 16:55:40.

## Symptoms

1. Repeated ICE drops after agent idle disconnect (every ~25s)
2. Duplicate `SDK reconnect attempt 1/10` events in the same sequence
3. UI appears stuck in "Reconnecting…" even after SDK reports success
4. When agent departure coincides with SDK reconnect, agent dispatch may not re-fire

## Investigation Areas

### 1. Why are ICE drops correlated with agent idle?

- After the agent leaves, the room has only one participant.
- Single-participant rooms may hit a LiveKit keep-alive edge case.
- The 30s idle timeout + 25s ICE drop interval suggests these may be related to
  DTLS/STUN keepalive intervals.
- Check LiveKit server logs for ICE disconnect signals around those timestamps.

### 2. Duplicate reconnect events (16:50)

- `SDK reconnect attempt 1/10` appearing twice 730ms apart suggests the reconnect
  handler may be registered more than once, or two different events fire the same path.
- Search `livekit_service.dart` for reconnect event registration; verify it's only
  registered once per session (not cumulative across app restarts).

### 3. UI stuck in "Reconnecting…"

- After `SDK reconnected successfully`, verify that the app's connection state machine
  transitions to `connected` and clears any "Reconnecting" UI overlay.
- Check if repeated rapid reconnect cycles (connected → reconnecting → connected) can
  leave the UI in an intermediate state.

### 4. Agent dispatch not re-firing after coincident disconnect

- When agent departure and ICE reconnect happen simultaneously (16:44 case), the
  `Unmute while agent absent — triggering dispatch` fired at 16:45:05 but no agent joined.
- The dispatch trigger may have run while the SDK was still reconnecting, before the
  room was fully ready.
- Add a guard: only dispatch when both (a) room is fully connected AND (b) no agent present.

## Acceptance Criteria

- [ ] After agent idle disconnect, no repeated ICE drop/reconnect cycles
- [ ] Only one set of `SDK reconnect attempt N/10` events per disconnect event
- [ ] UI clears "Reconnecting…" banner within 2s of `SDK reconnected successfully`
- [ ] Agent dispatch re-fires correctly after coincident ICE reconnect + agent departure

## Related

- BUG-010: `docs/field-tests/20260310-buglog.md`
- `apps/mobile/lib/services/livekit_service.dart` — reconnect handler
- `tasks/09-connectivity/` — related connectivity tasks
