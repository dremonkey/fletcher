# Task 039: Fix Missing Transcripts When TTS is Disabled (BUG-015)

## Problem

When TTS is disabled (via the `[TTS: ON/OFF]` toggle), response transcripts do not appear in the UI. The user is "blind" to the assistant's response — the agent receives the message, composes a response, but nothing appears in the chat transcript.

**Field test:** [BUG-015](../../docs/field-tests/20260313-buglog.md)
**Frequency:** 100% when TTS is off

## Investigation

### Static analysis: No explicit suppression found

A full trace of the transcript pipeline from LLM response to mobile UI reveals **no code path that explicitly suppresses transcripts when TTS is disabled**:

1. **Voice agent** (`agent.ts:352-354`): `session.output.setAudioEnabled(false)` — only affects TTS audio output
2. **SDK pipeline** (`agent_activity.ts:1521-1576`): When `audioEnabled` is false, `audioOutput` is null, no TTS inference — but LLM inference task starts regardless, and `performTextForwarding` still runs
3. **Ganglia streams** (`acp-stream.ts:133-136`, `relay-stream.ts:176-178`): `onContent` callback fires unconditionally from `session/update` handler — no TTS state check
4. **TranscriptManager** (`transcript-manager.ts:111-126`): `onContent` publishes `agent_transcript` events — no TTS state check
5. **publishEvent** (`agent.ts:172-185`): Publishes on `ganglia-events` data channel — no TTS state check
6. **Mobile handler** (`livekit_service.dart:892-910`): `_upsertTranscript()` is called unconditionally for `agent_transcript` events

### Hypothesis: Stream consumption difference (most likely)

When TTS is enabled, the LLM text stream is **tee'd** — one branch feeds TTS inference, the other feeds `performTextForwarding`. When TTS is disabled, the stream has a **single consumer** (no tee). This changes the backpressure profile:

- **TTS on:** Two consumers, stream tee'd with `highWaterMark: Number.MAX_SAFE_INTEGER`
- **TTS off:** Single consumer via `performTextForwarding` only (line 1574: `llmOutput = llmGenData.textStream`)

The single-consumer path may cause:
- **Event loop starvation:** `performTextForwarding` reads from the stream synchronously without async TTS inference between reads. The LiveKit data channel message handler that delivers `session/update` notifications runs on the event loop — if text forwarding monopolizes microtask slots, `session/update` callbacks may never fire, preventing `onContent` from being called.
- **Stream backpressure bug:** Bun-specific behavior in `TransformStream` single-consumer mode vs tee'd mode could stall the LLM inference task.

### Needs runtime verification

This bug requires runtime debugging to confirm the root cause. The recommended approach:

1. Add debug logging in `TranscriptManager.onContent()` to confirm whether it fires when TTS is off
2. Add logging in the ganglia stream's `run()` method to confirm `session/update` notifications arrive
3. Run with `DEBUG=ganglia:*` and TTS disabled to capture the full trace
4. Check if `performTextForwarding` completion triggers stream finalization before content chunks are delivered

## Proposed Fix (pending runtime verification)

### Immediate workaround: Force transcript emission in text-forwarding path

**File:** `apps/voice-agent/src/agent.ts`

If `onContent` is not firing because the stream consumption differs, add a parallel transcript emission in the text-forwarding callback. The `AgentSession`'s `performTextForwarding` already processes all content chunks — hook into this to ensure transcripts are published even when TTS is off.

Alternatively, if the issue is event-loop starvation, insert `await new Promise(r => setTimeout(r, 0))` (yield to event loop) between chunk reads in the single-consumer path.

### Root cause fix: Ensure stream consumption parity

If the Bun stream behavior differs between tee'd and single-consumer modes, the fix is to always tee the stream, even when TTS is off. The TTS branch would simply drain without processing:

```typescript
// In agent_activity.ts (SDK code — may need monkey-patching or upstream PR)
const [ttsStream, transcriptStream] = llmGenData.textStream.tee();
if (audioOutput) {
  // Feed TTS
} else {
  // Drain the TTS branch
  ttsStream.pipeTo(new WritableStream({}));
}
// transcriptStream goes to performTextForwarding
```

## Diagnostic Steps (must run before implementing fix)

```bash
# 1. Start voice agent with debug logging
DEBUG=ganglia:* LOG_LEVEL=debug bun run apps/voice-agent/src/index.ts

# 2. Toggle TTS off via the mobile UI

# 3. Send a voice or text message

# 4. Check logs for:
#    - "ganglia:relay:stream" or "ganglia:acp:stream" — session/update received?
#    - TranscriptManager onContent — does it fire?
#    - publishEvent — is agent_transcript published to data channel?
```

## Acceptance Criteria

- [ ] Runtime root cause confirmed via debug logging
- [ ] Response transcripts appear in mobile UI when TTS is disabled
- [ ] Response transcripts still work when TTS is enabled (regression check)
- [ ] Toggle TTS on/off mid-conversation — transcripts remain visible in both states
- [ ] No additional latency introduced by the fix

## Files

- `apps/voice-agent/src/agent.ts` — transcript emission when TTS off (if needed)
- `apps/voice-agent/src/transcript-manager.ts` — debug logging
- Possibly `node_modules/.bun/@livekit+agents@*/src/voice/agent_activity.ts` — stream consumption investigation (upstream)

## Status

**Date:** 2026-03-13
**Priority:** Medium
**Status:** [x] Closed — cannot reproduce after BUG-017 fix (relay bootstrap race). The missing transcripts were caused by the relay never connecting, not TTS state.
**Field test:** [BUG-015](../../docs/field-tests/20260313-buglog.md)
