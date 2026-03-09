# Task 004: Agent Idle Timeout & Auto-Disconnect

**Epic:** 20 — Agent Cost Optimization
**Status:** [ ]
**Priority:** High

## Problem

Currently, the Fletcher voice agent stays connected indefinitely as long as a participant is in the room. There's no mechanism to detect "nobody is talking" and disconnect to save costs.

## Solution

Add an idle timer to the voice agent that:
1. Starts/resets on every `UserInputTranscribed` event
2. After N minutes of silence, sends a warning to the client via data channel
3. After a grace period, calls `ctx.shutdown()` to disconnect and stop billing

## Implementation

### Idle timer in agent entry function

```typescript
// apps/voice-agent/src/agent.ts

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;       // 5 minutes of silence
const IDLE_WARNING_MS = 4.5 * 60 * 1000;     // warn 30s before disconnect
let idleTimer: Timer | null = null;
let warningTimer: Timer | null = null;

const resetIdleTimer = () => {
  if (idleTimer) clearTimeout(idleTimer);
  if (warningTimer) clearTimeout(warningTimer);

  warningTimer = setTimeout(() => {
    // Notify client that agent is about to disconnect
    ctx.room.localParticipant?.publishData(
      new TextEncoder().encode(JSON.stringify({
        type: 'agent-idle-warning',
        disconnectInMs: IDLE_TIMEOUT_MS - IDLE_WARNING_MS,
      })),
      { topic: 'ganglia-events', reliable: true },
    );
  }, IDLE_WARNING_MS);

  idleTimer = setTimeout(() => {
    logger.info('Idle timeout reached — shutting down to save costs');
    // Notify client of disconnect
    ctx.room.localParticipant?.publishData(
      new TextEncoder().encode(JSON.stringify({
        type: 'agent-disconnected',
        reason: 'idle-timeout',
      })),
      { topic: 'ganglia-events', reliable: true },
    );
    // Grace period for data channel message delivery
    setTimeout(() => ctx.shutdown(), 500);
  }, IDLE_TIMEOUT_MS);
};

// Reset on user speech
session.on(voice.AgentSessionEventTypes.UserInputTranscribed, () => {
  resetIdleTimer();
});

// Also reset on text input (data channel messages)
// ... existing text_message handler should call resetIdleTimer()

// Start the timer after session is established
resetIdleTimer();
```

### Configuration

The idle timeout should be configurable via environment variable:

```
FLETCHER_IDLE_TIMEOUT_MS=300000   # 5 minutes (default)
```

For development, set to a longer value or disable entirely:
```
FLETCHER_IDLE_TIMEOUT_MS=0        # 0 = disabled (never auto-disconnect)
```

### Data channel events

Two new event types on the `ganglia-events` topic:

1. **`agent-idle-warning`** — sent 30s before disconnect
   ```json
   { "type": "agent-idle-warning", "disconnectInMs": 30000 }
   ```

2. **`agent-disconnected`** — sent immediately before disconnect
   ```json
   { "type": "agent-disconnected", "reason": "idle-timeout" }
   ```

The client uses these to transition its state machine (Task 005).

## Files to Modify

- `apps/voice-agent/src/agent.ts` — add idle timer logic, data channel events

## Acceptance Criteria

- [ ] Agent disconnects after configured idle timeout (default 5 min)
- [ ] Timer resets on any user speech or text input
- [ ] Client receives `agent-idle-warning` 30s before disconnect
- [ ] Client receives `agent-disconnected` before shutdown
- [ ] `ctx.shutdown()` is called (not `ctx.room.disconnect()`) to fully stop billing
- [ ] Idle timeout is configurable via `FLETCHER_IDLE_TIMEOUT_MS`
- [ ] Idle timeout can be disabled by setting value to 0
- [ ] Existing session error disconnect logic still works

## Dependencies

- None (can be implemented independently of other tasks, but pairs with Task 005 for full UX)

## Design Decisions

- **`ctx.shutdown()` vs `ctx.room.disconnect()`** — `ctx.shutdown()` is preferred because it fully terminates the job and stops metering. `ctx.room.disconnect()` disconnects from the room but may leave the job in an ambiguous state.
- **Warning before disconnect** — gives the client time to show a "going idle" indicator and prepare for local VAD takeover.
- **Agent speech does NOT reset the timer** — only user input resets it. If the agent is talking to itself (e.g., repeating a question), that shouldn't prevent idle disconnect.
