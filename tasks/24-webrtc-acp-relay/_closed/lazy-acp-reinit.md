# Lazy ACP Re-init + Longer Idle Timeout

**Status:** [x] Complete
**Depends on:** room-lifecycle
**Blocks:** Nothing

## Problem

If the ACP subprocess dies mid-session (crash, OOM, broken pipe), the relay bridge enters a zombie state: the LiveKit room stays connected and mobile messages arrive, but `acpClient.sessionPrompt()` throws because the subprocess is gone. There is no recovery path — the room stays zombie until the idle timer fires.

Additionally, the 5-minute idle timeout (`RELAY_IDLE_TIMEOUT_MS=300000`) is too aggressive for real conversations. A user who pauses to think or steps away briefly shouldn't lose their session.

## Proposed Changes

### 1. Increase default idle timeout to 30 minutes

In `src/index.ts`, change the default from `300000` (5 min) to `1_800_000` (30 min):

```typescript
Number(process.env.RELAY_IDLE_TIMEOUT_MS ?? 1_800_000), // 30 minutes
```

Also update the `RELAY_IDLE_TIMEOUT_MS` documentation in the relay `CLAUDE.md` and `room-lifecycle.md`.

### 2. Detect ACP subprocess death

In `RelayBridge`, listen for the ACP subprocess exit event. When it fires unexpectedly (i.e. `this.started === true`), mark the bridge as needing re-init rather than tearing it down immediately.

```typescript
// In RelayBridge.start(), after acpClient.initialize():
this.acpClient.onExit((code) => {
  if (this.started) {
    this.log.warn({ event: "acp_died", exitCode: code });
    this.needsReinit = true;
    this.sessionId = null;
  }
});
```

### 3. Lazy re-init on next mobile message

In `handleMobileMessage()`, check `needsReinit` before routing. If the ACP subprocess is dead, re-initialize it transparently:

```typescript
private async ensureAcp(): Promise<void> {
  if (!this.needsReinit) return;

  this.log.info({ event: "acp_reinit" });
  await this.acpClient.initialize();
  const result = await this.acpClient.sessionNew({ ... });
  this.sessionId = result.sessionId;
  this.needsReinit = false;
}
```

This means the next `session/prompt` from mobile triggers a fresh ACP session. The user sees a brief delay but the conversation recovers automatically.

### 4. Edge case: deep thinking

If the ACP agent is in a long thinking phase (>30 min with no streaming `session/update`), the idle timer could fire. This is extremely unlikely in practice. No action needed now — document it and revisit if real-world usage triggers it.

## Files to Change

- `src/index.ts` — Change default idle timeout
- `src/bridge/relay-bridge.ts` — Add `needsReinit` flag, `onExit` listener, `ensureAcp()` method
- `src/acp/client.ts` — May need to expose subprocess exit event (check if already available)

## Acceptance Criteria

- [ ] Default idle timeout is 30 minutes
- [ ] ACP subprocess crash is detected and logged
- [ ] Next mobile message after crash triggers lazy re-init
- [ ] New ACP session is created on re-init (old session is lost — acceptable)
- [ ] Bridge does not tear down the LiveKit room on ACP crash
- [ ] Deep thinking edge case is documented (no code needed)
