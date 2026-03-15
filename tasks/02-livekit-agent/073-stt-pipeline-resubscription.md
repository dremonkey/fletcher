# TASK-073: STT Pipeline Survives Track Resubscription

**Status:** [ ] Open
**Priority:** CRITICAL
**Bug refs:** BUG-027c, BUG-027d
**Filed:** 2026-03-15

## Problem

The `@livekit/agents` SDK's audio pipeline (`AudioRecognition` + `MultiInputStream`) is created once during `AgentSession.start()` and cannot survive track resubscription. When the Flutter app toggles mic (unpublish → republish audio track), the `MultiInputStream` pump encounters a stream reader release error. The SDK silently swallows it via `isStreamReaderReleaseError()`, and the STT/VAD pipeline dies permanently. No events, no errors, no recovery.

Two failure modes observed:

1. **STT died mid-session (BUG-027c):** STT was working, user toggles mic (to release `AudioRecord` for Android keyboard STT — BUG-001 workaround), `MultiInputStream` pump dies, agent becomes deaf.

2. **STT never started (BUG-027d):** On some fresh connects, VAD never fires a single event despite audio track being subscribed for 17+ seconds. The pipeline appears to fail silently during initialization. Frequency: ~25% of agent jobs during field testing.

### Root cause chain

```
Flutter mic toggle
  → removePublishedTrack() (releases AudioRecord for Android keyboard STT)
  → server: TrackUnpublished / TrackUnsubscribed
  → SDK MultiInputStream pump loop gets stream reader release error
  → isStreamReaderReleaseError() swallows it silently
  → AudioRecognition (STT + VAD) task exits without notification
  → DeferredReadableStream.setSource() throws "already set" if re-init attempted
  → Agent alive but deaf — zero STT/TTS output (zombie state)
```

### Current mitigations

- **STT watchdog Mode 1:** Detects silence after STT was active → triggers recovery via room disconnect after 30s. Works but slow.
- **STT watchdog Mode 2:** Detects audio track subscribed but STT never activates → triggers recovery after 30s. Catches BUG-027d but the redispatched agent may also fail.
- **Early session_hold:** Sent at first 10s check interval while data channel is still alive (before DTLS timeout kills it).

These are band-aids. The recovery loop (watchdog → disconnect → hold → redispatch → new agent) takes 30-35s and the new agent may also fail, creating cascading reconnects.

## Options

### Option A: Mute instead of unpublish (client-side) — RECOMMENDED FIRST TRY

Change the mic toggle from `removePublishedTrack()` to `track.mute()`. The track stays alive, `MultiInputStream` pump never dies, problem disappears.

**Risk:** Muting may not release the `AudioRecord` hardware resource, meaning Android keyboard STT won't work while the voice session is active. Needs testing on device.

**Effort:** Small — one change in `livekit_service.dart`.

**Tradeoff:** If `AudioRecord` isn't released, keyboard STT and voice mode become mutually exclusive (acceptable — voice mode IS the STT).

### Option B: Stop toggling mic entirely (client-side)

Accept that keyboard STT and voice mode are mutually exclusive. Keep mic always on during a voice session. Typing is manual-only (no keyboard STT).

**Risk:** UX regression for users who rely on keyboard STT during voice sessions.

**Effort:** Tiny — remove the toggle logic.

### Option C: Fast agent restart on track loss (server-side)

Detect track unpublish immediately and kill the agent job. Dispatcher creates a fresh job with a fresh pipeline. Makes the watchdog near-instant for this specific case.

**Risk:** Each reconnect costs ~2s (bootstrap). Frequent mic toggles = repeated interruptions. Also, new job sometimes fails to initialize (BUG-027d), so this can cascade.

**Effort:** Small — `TrackUnsubscribed` handler that triggers immediate disconnect. But must solve BUG-027d first to prevent infinite reconnect loops.

### Option D: Fork the SDK's audio pipeline (server-side)

Patch `@livekit/agents` to make `AudioRecognition` survive track resubscription:
- Make `MultiInputStream` handle stream reader release gracefully (re-await next track)
- Or make `DeferredReadableStream.setSource()` accept replacement sources
- Or make `attachAudioInput()` teardown and recreate `AudioRecognition` on new tracks

**Risk:** Maintenance burden — owned fork of `@livekit/agents`. Every SDK update needs manual merge.

**Effort:** Medium-high.

### Option E: Upstream PR to LiveKit

Same code as Option D, but contributed upstream. File an issue describing the track resubscription failure, propose a fix.

**Risk:** Timeline out of our control. Need a workaround in the meantime.

**Effort:** Medium + review/iteration cycle.

## Recommendation

**Start with Option A** (mute instead of unpublish). Test whether `track.mute()` releases `AudioRecord` on Android. If it does — problem solved with minimal code. If it doesn't — **fall back to Option B** (accept no keyboard STT during voice). Both eliminate the root cause (track unpublish) rather than working around the symptom.

Options C/D/E are worth pursuing longer-term but are either fragile (C) or high-effort (D/E).

## Checklist

- [ ] Test Option A: mute vs unpublish on Android — does muting release AudioRecord?
- [ ] Implement chosen option
- [ ] Field-verify: mic toggle no longer kills STT pipeline
- [ ] Field-verify: reconnect after hold timeout has working STT
- [ ] Update architecture docs if pipeline behavior changes
