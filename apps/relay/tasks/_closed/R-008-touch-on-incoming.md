# R-008: Reset Idle Timer on Incoming Mobile Messages

**Status:** [x] Complete
**Depends on:** R-004 (Room lifecycle)
**Blocks:** Nothing

## Problem

The idle timer only resets when the relay **sends** data to mobile (via `sendToRoom()` which sets `conn.lastActivity = Date.now()` at `room-manager.ts:155`). Incoming mobile messages — `session/prompt`, `session/cancel`, or any future methods — do **not** reset the timer.

`RoomManager.touchRoom()` exists (`room-manager.ts:180-185`) but nothing calls it.

This means a conversation where the user sends many prompts but ACP responses are slow (or ACP is in a long thinking phase) could incorrectly idle-timeout. In practice this is unlikely with the current 5-minute timeout (ACP responds faster than that), but with the 30-minute timeout proposed in R-006, the gap becomes more relevant for sessions with long pauses between user inputs where ACP streaming updates happen to not flow.

## Proposed Changes

### Call `touchRoom()` on incoming data

In `RelayBridge.handleMobileMessage()`, call `touchRoom()` at the top of the method:

```typescript
private handleMobileMessage(data: unknown, _participantIdentity: string): void {
  if (typeof data !== "object" || data === null) return;

  // Reset idle timer — incoming messages prove the session is active
  this.options.roomManager.touchRoom(this.options.roomName);

  // ... rest of existing handler
}
```

This is a one-line fix. The `touchRoom()` method already exists and does exactly what we need.

## Files to Change

- `src/bridge/relay-bridge.ts` — Add `touchRoom()` call in `handleMobileMessage()`

## Acceptance Criteria

- [ ] Incoming mobile messages reset the idle timer
- [ ] `touchRoom()` is called before message routing (so even malformed messages reset the timer)
- [ ] Existing `sendToRoom()` activity tracking remains unchanged
- [ ] Unit test: verify `lastActivity` updates on incoming message
