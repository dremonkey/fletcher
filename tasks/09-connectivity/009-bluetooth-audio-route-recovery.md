# Task 009: Bluetooth / Audio Route Recovery

**Epic:** 09 - Connectivity & Resilience
**Priority:** High
**Source:** [BUG-004](../../docs/field-tests/20260301-buglog.md#bug-004-audio-input-dies-on-bluetoothspeaker-transitions-high) — 2026-03-01 field test

## Problem

Switching audio output routes on Android (e.g., phone speaker → Bluetooth, Bluetooth → car BT) silently kills the LiveKit audio input track. STT stops receiving audio and no responses are generated. The WebRTC peer connection stays alive (diagnostics green), so neither LiveKit nor the app knows the mic is dead.

### Observed transitions that break

- Phone Speaker → Car Bluetooth
- Car Bluetooth → Phone Bluetooth
- Phone Speaker → Phone Bluetooth

### Symptoms

1. User switches audio route (e.g., connects BT headset)
2. Android changes the audio input device
3. Existing LiveKit audio track becomes stale (capturing from now-inactive device)
4. WebRTC connection stays alive — ICE OK, diagnostics green
5. STT and responses stop completely
6. User must exit app and reopen to recover

### Log evidence (2026-03-01 session)

```
19:18:19 — AbortError burst, session closed (BT transition)
19:27:51 — New session, "Hey there, Fletcher." works briefly
19:28:08 — AbortError burst, session closed again
19:32:27 — New session, "There?" / "Hello?" — testing if mic works
19:32:54 — Session closed again
```

## Root Cause

Android changes the audio input device when Bluetooth connects/disconnects, but the Flutter app doesn't detect the audio route change. The existing LiveKit audio track continues to reference the old (now-inactive) capture device. Since the WebRTC peer connection itself is fine, LiveKit has no reason to trigger reconnection.

## Proposed Fix

### Client-side (Flutter)

- [ ] Add `audio_session` plugin dependency (or use `AudioManager` APIs)
- [ ] Listen for audio route change events (`AudioSession.instance.devicesChangedStream` or equivalent)
- [ ] On route change: re-publish the audio track with the new input device
  - Option A: `localParticipant.unpublishTrack()` + `publishAudioTrack()` with new device
  - Option B: Restart audio capture on the existing track (`MediaStreamTrack.restart()` if available)
- [ ] Show brief UI indicator when audio route changes ("Switching to Bluetooth...")
- [ ] Test recovery for all transition directions (speaker↔BT, BT↔BT)

### Agent-side (optional, defense in depth)

- [ ] Detect prolonged silence after previous speech activity (e.g., >10s of zero audio level after user was speaking)
- [ ] Send a data channel message to the client suggesting audio restart
- [ ] Log silence detection events for diagnostics

## Files

- `apps/mobile/lib/services/livekit_service.dart` — audio track management
- `apps/mobile/pubspec.yaml` — add `audio_session` dependency
- `apps/mobile/lib/widgets/` — UI indicator for route changes

## Context

- **Device:** Pixel 9, Android 16
- **Related:** Task 007 (WiFi → 5G) — same epic, different transport layer
- **Related:** Task 001-004 (reconnection) — those handle *connection* loss, this handles *audio device* loss while connected
- This is distinct from connectivity issues — the WebRTC connection is healthy; only the audio capture device is stale

## Status

- **Date:** 2026-03-01
- **Priority:** High
- **Status:** Open
