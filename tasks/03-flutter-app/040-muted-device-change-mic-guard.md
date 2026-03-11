# Task 040: Guard Audio Track Restart When User is Muted

**Epic:** 03 — Flutter App
**Status:** Open
**Priority:** Medium
**Origin:** Field test BUG-009 (2026-03-10)

## Problem

When a network handoff occurs (WiFi→5G, Bluetooth device change, etc.), the Flutter app
fires a `_onDeviceChange` event and unconditionally calls `restartTrack()` to refresh the
audio track. This happens even when the user is **muted** (mic track unpublished, text-input
mode active).

The result: `restartTrack()` temporarily republishes the audio track, reclaiming
`AudioManager.MODE_IN_COMMUNICATION` from the OS. Android then blocks the system keyboard
dictation (STT) feature because the app holds the mic in communication mode. The user cannot
dictate a text message while the handoff recovery runs.

**Observed client log pattern:**
```
[Fletcher] Device change detected — debouncing (2s)
[Fletcher] Device change detected — debouncing (2s)
[Fletcher] Audio device changed — refreshing audio track
```

## Goal

When a device change fires and the user is currently muted, skip the audio track restart
(or defer it until unmute). Only restart the track when the mic is actively in use.

## Acceptance Criteria

- [ ] `_onDeviceChange` checks mute state before calling `restartTrack()`
- [ ] If muted: skip restart (or set a flag so unmute triggers the restart)
- [ ] If unmuted: restart as today (no behavior change for the active-mic case)
- [ ] Tester can use Android keyboard dictation during network handoffs while muted

## Implementation

In `livekit_service.dart`, find the `_onDeviceChange` handler (likely calls
`restartTrack()` or `refreshAudioTrack()`).

Add a guard:
```dart
// Don't restart the track if the mic is not in use — would reclaim
// AudioManager from OS and block system STT (BUG-009)
if (_isMuted) {
  log.d('[Fletcher] Device change while muted — skipping audio track restart');
  return;
}
```

Or alternatively, set `_pendingDeviceChange = true` when muted, and restart on unmute.

## Related

- BUG-009: `docs/field-tests/20260310-buglog.md`
- Related: `tasks/livekit-flutter-sdk/005-audiomode-keyboard-stt.md` (same root: `MODE_IN_COMMUNICATION` blocks OS dictation)
- `apps/mobile/lib/services/livekit_service.dart` — `_onDeviceChange` handler
