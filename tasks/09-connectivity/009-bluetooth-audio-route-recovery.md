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

- [x] ~~Add `audio_session` plugin dependency~~ — not needed; `Hardware.instance.onDeviceChange` already fires for BT transitions
- [x] Listen for audio route change events — using existing `Hardware.instance.onDeviceChange.stream`
- [x] On route change: restart audio capture via `LocalTrack.restartTrack()` (WebRTC `replaceTrack()`)
  - ~~Option A: mic toggle~~ — REJECTED: `setMicrophoneEnabled(false)` unpublishes the track, agent sees `onTrackUnpublished` and closes session
  - Option B used: `restartTrack()` swaps the underlying MediaStream atomically via WebRTC's `replaceTrack()` — track stays published, agent session unaffected
  - Increased debounce from 1s to 2s for Bluetooth settling time
- [x] ~~Show brief UI indicator~~ — removed; restartTrack() is fast enough to be transparent
- [x] Test recovery for BT transitions — field-tested on Pixel 9 (speaker→BT, BT→speaker)

### Agent-side (optional, defense in depth)

- [ ] Detect prolonged silence after previous speech activity (e.g., >10s of zero audio level after user was speaking)
- [ ] Send a data channel message to the client suggesting audio restart
- [ ] Log silence detection events for diagnostics

## Files

- `apps/mobile/lib/services/livekit_service.dart` — audio track management
- `docs/architecture/mobile-client.md` — reconnection strategy docs
- `docs/architecture/network-connectivity.md` — reconnection flow docs

## Context

- **Device:** Pixel 9, Android 16
- **Related:** Task 007 (WiFi → 5G) — same epic, different transport layer
- **Related:** Task 001-004 (reconnection) — those handle *connection* loss, this handles *audio device* loss while connected
- This is distinct from connectivity issues — the WebRTC connection is healthy; only the audio capture device is stale

## Status

- **Date:** 2026-03-01
- **Priority:** High
- **Status:** Complete ✅ — field-tested 2026-03-02
