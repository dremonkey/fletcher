# Task: Agent should self-terminate on unrecoverable AgentSession error

## Problem

When `AgentSession` closes with `reason: "error"`, the agent process stays in the room as a participant but with a dead voice pipeline. This "zombie agent" blocks LiveKit from dispatching a new agent, so users who force-quit and reconnect get a room with a braindead agent that never responds — despite diagnostics showing green.

**Field test references:**
- [BUG-020 (03-02)](../../docs/field-tests/20260302-buglog.md) — first observed, 5+ minutes zombie
- [BUG-020 (03-03)](../../docs/field-tests/20260303-buglog.md) — recurrence, 6 minutes zombie (17:04:39–17:10:29 UTC)

## Investigation

### Theory 1: No close handler in agent.ts

**Hypothesis:** The agent code doesn't listen for `AgentSessionEventTypes.Close`, so when the session dies the agent stays in the room.

**Verified against code:**

1. `apps/voice-agent/src/agent.ts` — **confirmed, no Close handler exists.** The file has:
   - `AgentSessionEventTypes.Error` handler (line 279) — forwards errors to client, but does not react to session death
   - `AgentSessionEventTypes.AgentStateChanged` handler (line 234) — for ack sound
   - `AgentSessionEventTypes.MetricsCollected` handler (line 216) — for observability
   - `AgentSessionEventTypes.UserInputTranscribed` handler (line 257) — for transcripts
   - **No `AgentSessionEventTypes.Close` handler**

2. `AgentSession._onError()` (`agent_session.ts:781-806`) — **confirmed, error counting triggers close.** After `maxUnrecoverableErrors` (default 3) consecutive unrecoverable LLM errors, it calls `closeImpl(CloseReason.ERROR, error)`.

3. `AgentSession.closeImpl()` (`agent_session.ts:948-1041`) — **confirmed, does NOT disconnect from room.** It:
   - Cancels all pipeline tasks (lines 975-990)
   - Closes RoomIO via `this._roomIO?.close()` (line 1009)
   - Sets `this.started = false` (line 1030)
   - Emits `AgentSessionEventTypes.Close` with `reason` and `error` (line 1032)
   - Resets internal state (lines 1034-1038)
   - **Does NOT call `room.disconnect()` or signal the JobContext**

**Conclusion:** Theory 1 confirmed. The SDK intentionally separates session lifecycle from room lifecycle — the session closes cleanly, but leaving the room is the application's responsibility.

### Theory 2: Reconnect handler falsely reports recovery

**Hypothesis:** The participant reconnect handler (line 344) logs "session continues" even when the session is dead.

**Verified against code:**

```typescript
// agent.ts:341-347
ctx.room.on(RoomEvent.ParticipantConnected, (p) => {
  logger.info({ identity: p.identity, room: ctx.room.name }, 'Participant connected');
  if (p.identity === participant.identity) {
    logger.info({ identity: p.identity }, 'Original participant reconnected — session continues');
  }
});
```

This handler does not check `session.started` — it unconditionally logs "session continues" on identity match. In the 03-03 session, this fired 4 times during the zombie phase (17:04:59, 17:06:05, 17:07:44, confirmed in raw logs lines 3781-3805), each time falsely claiming the session was alive.

**Conclusion:** Theory 2 confirmed. The reconnect handler is misleading during zombie state.

### Theory 3: Ganglia streams outlive the session

**Hypothesis:** OpenClaw HTTP streams keep running after AgentSession closes, firing `onPondering` callbacks.

**Verified against raw logs (voice-agent log, lines 3720-3779):**

```
17:04:39.346  ganglia:openclaw:stream pondering: "Compiling a response..." streamId=s_19
17:04:40.577  ganglia:openclaw:stream pondering: "Asking the magic 8-ball..." streamId=s_18
17:04:42.346  ganglia:openclaw:stream pondering: "Discombobulating..." streamId=s_19
17:04:43.308  OpenClawChatStream error: Queue is closed  (second stream, 11733ms TTFF)
17:04:45.115  ganglia:openclaw:stream stream complete, 0 chunks in 8769ms
```

Pondering callbacks fired for 6 seconds after the session died. The `TranscriptManager` handles this gracefully (stale streams are silently finalized per BUG-010 fix), so this is cosmetic, not causal. But it contributes to the appearance of life.

**Conclusion:** Theory 3 confirmed but not the root cause — it's a contributing factor. The Ganglia streams should ideally be cancelled when the session closes, but this is a separate concern.

### Final Root Cause

The root cause is the **missing `AgentSessionEventTypes.Close` handler** in `agent.ts`. The SDK's design intentionally separates session lifecycle from room lifecycle:

- `AgentSession` manages the voice pipeline (STT → LLM → TTS)
- `JobContext` manages the room connection
- When the session dies, it emits `Close` — the application is expected to decide what to do (disconnect, restart, etc.)

Fletcher doesn't handle this event, so the agent stays in the room as a zombie for the full `departure_timeout` (120s).

The cascade:
1. BUG-019 triggers 3 "Queue is closed" errors → `_onError()` counts exceed `maxUnrecoverableErrors`
2. `closeImpl(CloseReason.ERROR)` tears down voice pipeline, emits `Close`
3. **Nobody listens** → agent stays in room
4. `departure_timeout: 120s` keeps room alive
5. Phone reconnects → DUPLICATE_IDENTITY churn → agent logs "session continues" (false)
6. After 120s+ the room idle timeout finally kills everything

## Proposed Fix

### Primary fix: Add Close event handler

Add a `AgentSessionEventTypes.Close` handler in `agent.ts` that disconnects from the room on error:

**File:** `apps/voice-agent/src/agent.ts`
**Location:** After the Error handler (after line 307), before `ctx.waitForParticipant()` (line 309)

```typescript
// -----------------------------------------------------------------------
// Session death — disconnect from room so LiveKit can dispatch fresh agent
// -----------------------------------------------------------------------
session.on(voice.AgentSessionEventTypes.Close, (ev) => {
  logger.info({ reason: ev.reason }, 'AgentSession closed');
  if (ev.reason === 'error') {
    logger.error({ error: ev.error }, 'AgentSession died — disconnecting from room to allow fresh dispatch');
    ctx.room.disconnect();
  }
});
```

**Why this works:**
- `ctx.room.disconnect()` removes the agent participant from the room
- LiveKit detects the agent left and closes the room (since no participants remain)
- On next app connect, LiveKit dispatches a fresh agent to a new room
- Non-error closes (`user_initiated`, `participant_disconnected`, `job_shutdown`) are logged but don't trigger disconnect — these are handled by the normal lifecycle

### Event type reference

The `CloseEvent` type (`events.ts:234-239`):
```typescript
type CloseEvent = {
  type: 'close';
  error: RealtimeModelError | STTError | TTSError | LLMError | null;
  reason: ShutdownReason;  // CloseReason enum or string
  createdAt: number;
};
```

`CloseReason` enum (`events.ts:35-40`):
```
ERROR = 'error'
JOB_SHUTDOWN = 'job_shutdown'
PARTICIPANT_DISCONNECTED = 'participant_disconnected'
USER_INITIATED = 'user_initiated'
```

## Edge Cases

1. **Double disconnect:** If `closeImpl()` is called twice (e.g., error + shutdown), the handler fires twice. `ctx.room.disconnect()` is idempotent — safe to call multiple times.

2. **Disconnect during pending participant:** If the session dies before `ctx.waitForParticipant()` resolves, the room disconnect happens while the agent is waiting. This is fine — the job will exit cleanly.

3. **Ganglia streams after disconnect:** OpenClaw HTTP streams may still be in-flight when the room disconnects. The streams will complete or error independently — their `onPondering`/`onContent` callbacks will fire but `publishEvent()` will silently fail (no `localParticipant` after disconnect). No crash risk.

4. **Interaction with shutdown callback:** The shutdown callback (line 349) calls `session.close()`. If the session already closed due to error, `closeImpl()` short-circuits (`if (!this.started) return`). Safe.

5. **Participant-disconnect close reason:** When the user disconnects and `closeOnDisconnect` triggers, the reason is `PARTICIPANT_DISCONNECTED`, not `ERROR`. The fix correctly ignores this — `departure_timeout` should handle normal disconnects.

## Acceptance Criteria

- [ ] Agent disconnects from room when AgentSession closes with `reason: "error"`
- [ ] After agent disconnects, user reconnect triggers fresh agent dispatch
- [ ] User-initiated session close (`reason: "user_initiated"`) does NOT trigger disconnect
- [ ] Participant disconnect (`reason: "participant_disconnected"`) does NOT trigger disconnect
- [ ] Test: simulate session error, verify agent leaves room within 5s
- [ ] Field test: trigger BUG-019, force-quit app, reconnect — verify fresh agent responds

## Files

- `apps/voice-agent/src/agent.ts` — add `AgentSessionEventTypes.Close` handler (after line 307)

## Status
- **Date:** 2026-03-03 (updated with code-grounded RCA from 03-03 field test)
- **Priority:** High
- **Status:** Not started
