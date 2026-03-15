# TASK-074: Background Room Disconnect (BUG-034)

**Status:** [ ] Not started
**Priority:** LOW
**Epic:** 22 — Dual-Mode Architecture
**Bug ref:** BUG-034
**Filed:** 2026-03-15

## Problem

When the Flutter app is backgrounded in chat mode, the relay maintains its LiveKit room connection indefinitely. This causes unnecessary battery drain and log noise from repeated disconnect/reconnect cycles. Field testing on 2026-03-15 showed continuous relay reconnection events from 1:42am to 8:16am while the app was idle.

## Proposed Solution

The simplest fix: when the app backgrounds in chat mode, disconnect from the LiveKit room entirely. No relay-side changes needed — the relay sees the human leave, the room empties, and the relay tears down via existing idle/departure logic.

On resume, the client reconnects to the room. Session restoration (resuming conversation context after reconnect) is a separate concern tracked in EPIC-25 (Session Resumption).

### Scope — Flutter client only

- `onAppBackgrounded()`: Disconnect from LiveKit room (when not screen-locked — screen lock means user may be using earbuds)
- `onAppResumed()`: Reconnect to room
- No relay-side changes needed
- No new protocol messages needed

### Why not gate the relay instead?

We initially explored signaling foreground state via participant metadata and data channel messages so the relay could decide whether to stay connected. This was over-engineered — if the user isn't using the app, there's no reason for the client to stay in the room at all. Disconnecting at the source is simpler and more robust.

## Future

Session resumption after background disconnect is tracked in EPIC-25.

## Checklist

- [ ] Disconnect from room in `onAppBackgrounded()` (non-screen-locked path)
- [ ] Reconnect to room in `onAppResumed()`
- [ ] Handle edge case: screen lock should NOT disconnect (earbud usage)
- [ ] Field-verify: no relay reconnect loops when app backgrounded
- [ ] Field-verify: room reconnect works on resume
