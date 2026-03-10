# Task 033: Bootstrap TTS Settle Window

**Epic:** 02-livekit-agent
**Priority:** Medium
**Status:** Ready to implement
**Bug ref:** BUG-001 (`docs/field-tests/20260310-buglog.md`)

---

## Problem

On agent wake-up from sleep (on-demand dispatch), the first response plays audio even when
the client has TTS set to OFF. Subsequent responses are correctly silent.

Observed in field testing: after an idle-timeout disconnect, the user triggers a fresh
dispatch. The bootstrap response is spoken aloud despite the user's persisted TTS:OFF
preference.

---

## Investigation

### Theory 1: `tts-mode:off` arrives after the bootstrap pipeline captures `audioOutput`

The bug log timestamps confirm a 37ms gap:

```
[07:39:15.650] INFO: Sending bootstrap message
[07:39:15.687] INFO: TTS mode changed (value: off)
```

The agent fires the bootstrap at T=0. The client's TTS re-sync arrives at T+37ms. The
question is: does the pipeline use `audioEnabled` at creation time or at output time?

### Code trace: `session.generateReply()` captures `audioOutput` synchronously

`agent.ts:569` calls `session.generateReply({ userInput: bootstrapMsg })`.

The SDK call chain (all synchronous, no `await` until a specific suspension point):

1. `agent_session.ts:568` → `activity.generateReply({...})`
2. `agent_activity.ts:1170` → `this.createSpeechTask({ taskFn: () => this.pipelineReplyTask(...) })`
3. `agent_activity.ts:924` → `new Task(wrappedFn, controller)` — **constructor calls `this.runTask()` immediately**
4. `utils.ts:504` → `Task.currentTaskStorage.run(this, run)` — `run()` is invoked **synchronously** by `AsyncLocalStorage.run()`
5. `run()` calls `this.fn(controller)` (= `wrappedFn`) → `agentActivityStorage.run(this, () => taskFn(ctrl))` → `pipelineReplyTask()`
6. `agent_activity.ts:1888` → `this._pipelineReplyTaskImpl({...})` is called synchronously

Inside `_pipelineReplyTaskImpl` (`agent_activity.ts:1521-1523`), **before any `await`**:

```ts
const audioOutput = this.agentSession.output.audioEnabled
  ? this.agentSession.output.audio
  : null;
```

The first `await` appears at line 1372:
`await speechHandle.waitIfNotInterrupted([speechHandle._waitForAuthorization()])`

**`audioOutput` is a closure variable captured before the first `await`. Even if
`session.output.setAudioEnabled(false)` is called later (e.g. 37ms later via the
`DataReceived` event), the in-flight pipeline task already holds a reference to the live
audio sink. The captured `audioOutput` is non-null for the entire bootstrap response.**

### Why does `setAudioEnabled(false)` not help?

`AgentOutput.setAudioEnabled()` (`io.ts:322-337`) sets `_audioEnabled = false` and calls
`_audioSink.onDetached()`. But the pipeline task already captured its own `audioOutput`
reference — it does not re-read `this.agentSession.output.audioEnabled` during playback.
Changing `_audioEnabled` after the snapshot has no effect on the live pipeline task.

### Why does this only manifest on wake-up?

On the initial connection, the client joins the room first and waits for the agent to
arrive. When the agent joins, `waitForParticipant()` resolves (the client was already
there), and the bootstrap fires. `ParticipantConnectedEvent` fires on the Flutter side
concurrently, triggering `_sendTtsMode()`.

**On initial connection:** the agent is typically dispatched moments before the client's
room join completes. There may be enough pipeline startup latency (VAD prewarm, STT
initialisation) that the `tts-mode` sync arrives before `generateReply()` captures
`audioOutput`.

**On wake-up:** the client has been in the room for minutes. `waitForParticipant()` resolves
*instantly* the moment the agent connects. There is no startup buffer. Bootstrap fires
before the client has detected the agent's join and reacted.

### Client-side re-sync timing (confirmed by raw logs)

From `20260310-client-0035-0038.txt`:

```
00:37:14.080  Sending text message (dispatch trigger)
00:37:14.173  Dispatch dispatched (200)
00:37:15.031  Remote participant connected: agent-AJ_CtBSgVhdvE4x   ← ParticipantConnectedEvent
00:37:15.032  AgentPresence: dispatching → agentPresent
00:37:15.032  Flushing 1 queued text message(s)                     ← _sendTtsMode() called here
00:37:15.129  [Ganglia] Status: Considering...                      ← 97ms after agent connect
```

On the Flutter side, `_sendTtsMode()` fires at the *same millisecond* as
`ParticipantConnectedEvent` (00:37:15.032). On the agent side, the bootstrap fires the
instant `waitForParticipant()` resolves — which is the moment the agent's own room join
is acknowledged. The 37ms race window is the time between:

- Agent: `waitForParticipant()` resolves → `generateReply()` captures `audioOutput`
- Flutter: `ParticipantConnectedEvent` fires → `_sendTtsMode()` → WebRTC delivery → agent processes

### Flutter client code path for `_sendTtsMode()`

`livekit_service.dart:569-585` — `ParticipantConnectedEvent` handler:

```dart
_listener?.on<ParticipantConnectedEvent>((event) {
  ...
  agentPresenceService.onAgentConnected();
  _flushPendingTextMessages();
  // Re-sync TTS mode with new agent after idle disconnect (BUG-004)
  if (_textOnlyMode) {
    _sendTtsMode();   // ← only called when TTS is OFF; no unconditional sync
  }
});
```

`_sendTtsMode()` calls `_localParticipant!.publishData(data, reliable: true, topic: 'ganglia-events')`.
Even with `reliable: true` (SCTP), round-trip latency to the agent is 10–100ms depending
on routing.

---

## Proposed Fix

### Change 1 — Agent: add a settle window before bootstrap (`apps/voice-agent/src/agent.ts`)

Before `session.generateReply(bootstrapMsg)` (currently line 569), insert a short async
delay to let the event loop process any pending `DataReceived` events (including
`tts-mode`) from the client:

```ts
// Before (line 569):
session.generateReply({ userInput: bootstrapMsg });

// After:
// Settle window: on agent wake-up, ctx.waitForParticipant() resolves immediately
// (client was already in the room), but the client's ParticipantConnectedEvent
// handler takes ~37ms+ to detect the agent, call _sendTtsMode(), and have the
// data channel message processed here. Without this window, _pipelineReplyTaskImpl
// captures audioOutput as non-null before tts-mode:off is applied, causing the
// bootstrap response to play audio even when TTS is disabled. (BUG-001)
await new Promise<void>((resolve) => setTimeout(resolve, 200));
session.generateReply({ userInput: bootstrapMsg });
```

200ms is well above the observed 37ms race window and safely below any perceptible
latency impact on the bootstrap response (LLM TTFT is typically 300–800ms anyway).

The `await` is safe here: `entry()` is already async, and there are no other tasks
competing at this point in the startup sequence.

### Change 2 — Flutter: always send TTS mode on agent connect (`apps/mobile/lib/services/livekit_service.dart`)

Remove the `if (_textOnlyMode)` guard in `ParticipantConnectedEvent`, so the agent always
receives a definitive TTS state when it connects:

```dart
// Before (line 582-585):
// Re-sync TTS mode with new agent after idle disconnect (BUG-004)
if (_textOnlyMode) {
  _sendTtsMode();
}

// After:
// Always re-sync TTS mode when any new agent joins.
// Unconditional send ensures the agent gets the current state regardless of
// whether TTS is on or off. Defends against the settle window being insufficient
// on slow networks, and ensures correct state after any agent restart. (BUG-001)
_sendTtsMode();
```

This is belt-and-suspenders: if the settle window ever proves insufficient (slow network,
high server load), the `tts-mode` re-sync will still arrive before the LLM responds.

Do the same in the initial connect path (`connectWithDynamicRoom`, line 428-431):

```dart
// Before:
if (_textOnlyMode) {
  await _sendTtsMode();
}

// After:
// Always send TTS state on initial connect, not just when TTS is off.
// On initial connect the agent may already be in the room.
await _sendTtsMode();
```

### Change 3 — Flutter: send TTS mode BEFORE flushing queued text messages (`apps/mobile/lib/services/livekit_service.dart`)

**Found during field verification (2026-03-10, second session analysis).**

In `ParticipantConnectedEvent`, `_flushPendingTextMessages()` was called **before**
`_sendTtsMode()`. When the user wakes the agent with a text message:

1. Flutter queues the text message while agent is sleeping.
2. Agent wakes, client gets `ParticipantConnectedEvent`.
3. `_flushPendingTextMessages()` runs first — text message sent to agent.
4. Text message arrives at agent (T+68ms), `DataReceived` fires, **`session.generateReply()`
   is called with `audioOutput = non-null`** (TTS still ON).
5. `_sendTtsMode()` runs next — tts-mode message sent.
6. tts-mode arrives at agent (T+89ms), sets `audioEnabled = false`.
7. Too late: the text message pipeline already captured `audioOutput = non-null`.

SCTP reliable delivery guarantees message ordering within the same association.
Sending `tts-mode` first guarantees it arrives at the agent before the text message.

```dart
// Before (livekit_service.dart ~line 581-587):
// Flush any text messages queued while agent was absent
_flushPendingTextMessages();
// Always re-sync TTS mode when a new agent joins (BUG-001, BUG-004).
_sendTtsMode();

// After:
// Always re-sync TTS mode when a new agent joins (BUG-001, BUG-004).
// Send BEFORE flushing queued text messages so the agent processes
// tts-mode:off before the queued user message triggers a generateReply()
// pipeline.  SCTP reliable delivery guarantees ordering — tts-mode
// arrives at the agent before the text_message, so audioOutput is
// captured as null when the text message pipeline starts. (BUG-001)
_sendTtsMode();
// Flush any text messages queued while agent was absent.
// Must come AFTER _sendTtsMode() — see comment above.
_flushPendingTextMessages();
```

---

## Edge Cases

**Settle window not enough on very slow networks:**
If the data channel message takes >200ms to arrive (e.g., multi-hop Tailscale path under
load), the race still exists. Mitigation: Change 2 (unconditional send) makes this an
extremely short race — the `tts-mode` is sent the instant `ParticipantConnectedEvent`
fires, so it will always arrive before the LLM produces its first token.

**Double-dispatch / rapid re-wake:**
If the user triggers dispatch twice in quick succession, two agents might enter the room.
Each `ParticipantConnectedEvent` will call `_sendTtsMode()`, which is idempotent on the
agent side. No issue.

**Settle window adds latency to E2E test rooms:**
The 200ms delay applies to all bootstrap calls, including `e2e-*` rooms. This adds 200ms
to bootstrap processing in E2E tests. Acceptable — bootstrap latency is not under test in
the E2E suite.

**Agent restarts (not wake-up):**
If the agent process dies and is re-dispatched (e.g., OOM kill), the same race applies.
Both changes 1, 2, and 3 fix this scenario identically.

**No queued text message on wake-up:**
If the user wakes the agent via speech (not text), `_flushPendingTextMessages()` does
nothing. The ordering change has no effect. Only Change 1 (settle window) matters.

---

## Acceptance Criteria

- [x] With TTS set to OFF, wake the agent from sleep via **text message**. The response must be **silent** (no audio played) and transcript must appear.
- [x] With TTS set to OFF, wake the agent from sleep via **speech**. The bootstrap response must be **silent** (no audio played).
- [x] With TTS set to ON, wake the agent from sleep. The bootstrap response must be **spoken** as before.
- [x] With TTS set to OFF, send a second message after the bootstrap. The second response must also be **silent**.
- [x] Initial connection (fresh app start) with TTS OFF: bootstrap response is **silent**.
- [ ] Regression: TTS toggle mid-session still works correctly (on → off → on). *(not explicitly re-tested but no regressions observed)*

---

## Files

- `apps/voice-agent/src/agent.ts` — (a) add 200ms settle window before bootstrap; (b) add `userMessageReceivedBeforeBootstrap` flag to skip bootstrap when user text arrived during settle window
- `apps/mobile/lib/services/livekit_service.dart` — (a) remove `if (_textOnlyMode)` guard on `_sendTtsMode()` in two places; (b) reorder `_sendTtsMode()` before `_flushPendingTextMessages()` in `ParticipantConnectedEvent` handler

---

## Status

- **Date:** 2026-03-10
- **Priority:** Medium (regression on every wake-up cycle when TTS is off)
- **Status:** ✅ Complete — all changes deployed and field-verified 2026-03-10
