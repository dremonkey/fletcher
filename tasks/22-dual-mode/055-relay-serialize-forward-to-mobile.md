# Task: Fix relay last-chunk/result race — serialize forwardToMobile calls

## Background

Found during field testing (2026-03-12, BUG-006). A chat response arrived
truncated — last 3 words ("your next move!") missing. Root cause confirmed:
race condition between the final `session/update` chunk and the `session/prompt`
result, both sent via concurrent un-awaited `publishData` calls.

## Root Cause

In `relay-bridge.ts`, `forwardToMobile` fires and forgets — it calls
`sendToRoom()` without awaiting. When the last ACP chunk and the prompt result
arrive as consecutive stdout lines in `readLoop`, two `sendToRoom` (and thus two
`publishData`) calls are in-flight concurrently:

1. Last chunk → `onUpdate` → `forwardToMobile(chunk)` → `sendToRoom(chunk)` NOT awaited
2. Result → `pending.resolve` → microtask → `forwardToMobile(result)` → `sendToRoom(result)` NOT awaited

If the result packet arrives at mobile first:
- `_handlePromptResult()` closes `_activeStream` (sets to null)
- Last chunk arrives → `_activeStream?.add(...)` silently no-ops — **chunk dropped**

## Fix

Serialize all `forwardToMobile` calls in `relay-bridge.ts` via a Promise chain
so each `sendToRoom` awaits the previous one before starting:

```typescript
private sendQueue: Promise<void> = Promise.resolve();

private forwardToMobile(msg: object): void {
  if (!this.started) return;
  this.sendQueue = this.sendQueue.then(() =>
    this.options.roomManager
      .sendToRoom(this.options.roomName, msg)
      .catch(() => {}) // room may have disconnected
  );
}
```

This is a single-line queue: each call chains onto the previous, ensuring
chunks and the final result are always delivered in the order they were enqueued.

## Checklist

- [ ] Add `sendQueue: Promise<void>` to `RelayBridge`
- [ ] Update `forwardToMobile` to chain onto `sendQueue`
- [ ] Add test: verify chunk arrives before result even when publishData is slow
- [ ] Verify existing relay tests still pass (`bun test`)
- [ ] Type-check clean (`tsc --noEmit`)

## Related

- Bug: `docs/field-tests/20260312-buglog.md` BUG-006
- `apps/relay/src/bridge/relay-bridge.ts` — `forwardToMobile`, line ~235
- `apps/relay/src/livekit/room-manager.ts` — `sendToRoom`
- `apps/relay/src/acp/client.ts` — `readLoop`, `handleLine`
