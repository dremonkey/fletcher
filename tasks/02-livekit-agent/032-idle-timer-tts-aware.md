# Task 032: Make Idle Timer TTS-Aware

## Problem

The idle timer fires while the agent is still speaking, potentially disconnecting the
session mid-sentence during long storytelling or narration responses.

Observed in field testing (BUG-002, 2026-03-10): 100% reproduction rate. In long
storytelling sessions the agent's idle timeout (5 min) is triggered while TTS is
still playing back audio to the user.

## Investigation

### Theory (v1)

The buglog analysis suggests the timer "starts as soon as the LLM finishes generating text."
Initial hypothesis: there is a `reset()` call tied to LLM completion. **Refuted** — no such
call exists in `agent.ts`.

### Theory (v2) — Confirmed

The idle timer only resets on user activity. During agent speech, the timer runs unimpeded,
consuming the idle window. For a sufficiently long TTS response the window expires before the
user has any opportunity to speak.

**Trigger chain:**

1. User speaks → `UserInputTranscribed` (final) → `idleTimeout.reset()` at `agent.ts:433`.
   - This is the ONLY place the timer is reset after bootstrap.
2. Agent enters `thinking` then `speaking` (TTS playout begins).
3. Timer continues counting down during the entire TTS playout.
4. If `(time since last user speech) + (TTS duration)` ≥ `timeoutMs`, the timer fires
   **during active TTS playout**.

**Example that always reproduces (5-min session, 3-min story):**
```
T=0      User: "Tell me a long story"  → idleTimeout.reset() (5 min timer)
T=0.5    Agent: thinking → speaking
T=2.0    TTS playout begins (3-minute story)
T=5.0    Timer fires — agent enters warm-down while TTS still playing!
T=5.0    onWarmDown(): audio input disabled, 'agent-warm-down' event published
T=6.0    onTimeout(): ctx.shutdown() — session killed mid-sentence
```

**Code evidence:**

`apps/voice-agent/src/agent.ts:406–414` — `AgentStateChanged` handler:
```typescript
session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
  logger.info({ from: ev.oldState, to: ev.newState }, 'Agent state changed');
  if (ev.newState === 'thinking' && bgAudioPlayer && ackSound && !ackPlayHandle && ttsEnabled) {
    ackPlayHandle = bgAudioPlayer.play({ source: ackSound, volume: 0.8 });
  }
});
```
There is no `idleTimeout.reset()` call here. The timer is blind to agent speech state.

`apps/voice-agent/src/agent.ts:431–433` — only `reset()` calls after bootstrap:
```typescript
session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
  resetIdleWithWarmDownRecovery();   // ← only user activity resets the timer
```

`apps/voice-agent/src/agent.ts:364` — text input path:
```typescript
resetIdleWithWarmDownRecovery();
session.generateReply({ userInput: event.text });
```

**SDK state machine** (`@livekit/agents v1.0.48`):

`AgentState` = `'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking'`
(defined in `…/agents/src/voice/events.ts:33`)

After TTS playout completes the activity ALWAYS transitions `speaking → listening`:
- `…/agents/src/voice/agent_activity.ts:1479` — speech handle completion
- `…/agents/src/voice/agent_activity.ts:1758` — normal end-of-speech
- `…/agents/src/voice/agent_activity.ts:1792` — interrupted speech
- `…/agents/src/voice/agent_activity.ts:2256` — realtime model path

No path transitions `speaking → idle` or `speaking → thinking` directly.

**Root cause:** `idleTimeout.reset()` is only wired to *user* activity events. The agent's
own speaking time silently consumes the idle budget. Once TTS playout + preceding silence
exceeds `timeoutMs`, the timeout fires while the agent is still talking.

## Proposed Fix

One line added to the existing `AgentStateChanged` handler in `apps/voice-agent/src/agent.ts`.

**Before (`agent.ts:406–414`):**
```typescript
session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
  logger.info({ from: ev.oldState, to: ev.newState }, 'Agent state changed');
  if (ev.newState === 'thinking' && bgAudioPlayer && ackSound && !ackPlayHandle && ttsEnabled) {
    ackPlayHandle = bgAudioPlayer.play({ source: ackSound, volume: 0.8 });
  }
});
```

**After:**
```typescript
session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
  logger.info({ from: ev.oldState, to: ev.newState }, 'Agent state changed');
  // Reset idle timer when TTS playout ends — prevents the idle window being
  // consumed by agent speech, which would time out the session mid-sentence
  // in long storytelling or narration responses. (BUG-002)
  if (ev.oldState === 'speaking' && ev.newState === 'listening') {
    idleTimeout.reset();
  }
  if (ev.newState === 'thinking' && bgAudioPlayer && ackSound && !ackPlayHandle && ttsEnabled) {
    ackPlayHandle = bgAudioPlayer.play({ source: ackSound, volume: 0.8 });
  }
});
```

**Why `speaking → listening` is the right hook:**
- The transition fires reliably at the end of TTS playout for all code paths (verified above).
- Measuring from TTS-end matches user expectation: "5 minutes of silence" means 5 minutes
  with *nobody* talking — neither user nor agent.
- Resetting on `speaking → listening` means a fresh 5-minute window starts the moment
  the agent finishes its last sentence. The user has the full window to respond.

**Why not reset on `speaking` entry:**
- Resetting when the agent *starts* speaking would give a 5-minute window from TTS start.
  For a 4-minute story this means the timer fires 1 minute after TTS ends — still wrong,
  just less wrong. The correct anchor is TTS *end*.

## Edge Cases

**Interrupted speech:** When the user interrupts the agent, the SDK transitions
`speaking → listening` (confirmed at `agent_activity.ts:1758/1792`). The fix fires here
too, resetting the timer. This is correct — the user just spoke, and they'll be handled by
`UserInputTranscribed` immediately after, so there's a harmless double-reset.

**Rapid back-and-forth:** Short agent responses transition `speaking → listening` quickly.
Each transition resets the timer. No issue — this is desirable behavior (active conversation
keeps the session alive).

**TTS disabled (`ttsEnabled = false`):** The SDK still internally generates TTS audio and
the state machine still transitions `speaking → listening`. The fix fires regardless of TTS
mode. This is correct — even in text-only mode the agent is "active" during generation and
we shouldn't time out.

**Double-reset:** `UserInputTranscribed` also calls `idleTimeout.reset()`. If the user
interrupts the agent, both `UserInputTranscribed` and `speaking → listening` fire. The
second reset is a no-op (starts a fresh timer from the same ~instant). No issue.

**Warm-down interaction:** `idleTimeout.reset()` calls `this._inWarmDown = false` and
clears existing timers before re-arming. If by some timing edge case the warm-down starts
*during* long TTS and then TTS finishes, the `speaking → listening` transition resets the
timer and cancels warm-down. `resetIdleWithWarmDownRecovery()` is NOT called here (it
re-enables audio input and publishes `agent-warm-down-cancelled`). The warm-down callback
disables audio input; if TTS finishes first and we reset, audio input remains enabled —
correct. If warm-down somehow fires before TTS ends and audio input gets disabled, the
reset restores the timer but does NOT re-enable audio input (since we call `idleTimeout.reset()`
directly, not `resetIdleWithWarmDownRecovery()`).

**Mitigation:** To be safe, use `resetIdleWithWarmDownRecovery()` in the handler instead
of `idleTimeout.reset()`. This handles the edge case where warm-down fires during a very
long TTS response and the `speaking → listening` transition should recover from it:

```typescript
if (ev.oldState === 'speaking' && ev.newState === 'listening') {
  resetIdleWithWarmDownRecovery();  // handles warm-down recovery + timer reset
}
```

`resetIdleWithWarmDownRecovery` is defined at `agent.ts:334–341` and is safe to call from
here — it only re-enables audio input if `inWarmDown` is true (a no-op otherwise).

## Acceptance Criteria

- [ ] A storytelling session where TTS playout takes 4+ minutes does NOT trigger idle
      timeout or warm-down while audio is still playing.
- [ ] After TTS playout ends, the idle timer resets and gives a full `FLETCHER_IDLE_TIMEOUT_MS`
      window before timing out (verified by observing no `agent-idle-warning` event for
      at least `timeoutMs - warningMs` after TTS ends, with no user speech).
- [ ] Normal short-response sessions: idle timer still fires after `timeoutMs` of silence
      following the last agent speech (regression check — warm-down and disconnect still work).
- [ ] User interrupting the agent does not cause double-reset errors or any observable issue.
- [ ] `TTS: OFF` (text-only) mode: idle timer behaves identically (reset fires on
      `speaking → listening` even without audible audio).

## Files

- `apps/voice-agent/src/agent.ts` — add `resetIdleWithWarmDownRecovery()` call in
  `AgentStateChanged` handler on `speaking → listening` transition.

## Status

**Date:** 2026-03-10
**Priority:** High (100% reproduction rate in storytelling mode)
**Status:** RCA Complete — ready to implement
**Field test:** [BUG-002](../../docs/field-tests/20260310-buglog.md)
