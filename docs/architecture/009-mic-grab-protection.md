# BUG-009: Mic Grab Protection

> Prevents the Flutter app from stealing the Android microphone from OS keyboard
> STT when a device change (WiFi→5G, Bluetooth) fires while the user is muted.

## Problem

Android enforces a single-holder model for `AudioRecord`. When the app sets
`MODE_IN_COMMUNICATION` via LiveKit's native audio management, the OS keyboard's
speech-to-text (STT) cannot access the microphone.

Fletcher already solves the baseline case (BUG-001): `toggleMute()` calls
`removePublishedTrack()` to fully release `AudioRecord`, allowing OS STT.

**BUG-009** exposed a secondary path: when a network handoff (WiFi→cellular) or
Bluetooth device change fires the `Hardware.onDeviceChange` stream while the
user is muted, the debounced `_refreshAudioTrack()` would:

1. Set `_isRefreshingAudio = true` (a 1-second lock)
2. Call `restartTrack()` — which is a no-op (track is null after unpublish)
3. Hold the lock, silently dropping any real device change that fires during
   that window

The mic itself wasn't re-grabbed (the track was already gone), but the wasted
lock could cause device routing bugs on unmute.

## Architecture

```
Hardware.onDeviceChange stream
        │
        ▼
  _onDeviceChange()
  ├── Skip if _isRefreshingAudio / _reconnecting / _room == null
  └── Debounce 2s → _refreshAudioTrack()
                          │
                          ▼
                    ┌─────────────┐
                    │ _isMuted?   │
                    └──────┬──────┘
                     yes   │   no
                ┌──────────┴──────────┐
                ▼                     ▼
          Track exists?         Normal refresh:
          (soft-mute)           1s settle, restartTrack()
           │        │
          yes       no (full mute)
           │        │
           ▼        ▼
        Proceed   Set _pendingDeviceChange = true
        with      Return early (no lock held)
        refresh
                          │
                          ▼ (on unmute)
                    ┌─────────────────┐
                    │ toggleMute()    │  setMicrophoneEnabled(true) calls
                    │ unmute path     │  getUserMedia() → picks up current
                    │                 │  device automatically.
                    │ Clear flag.     │  No separate restartTrack() needed.
                    └─────────────────┘
```

## Two Mute Modes

| | `toggleMute()` (full mute) | `muteOnly()` (soft mute) |
|---|---|---|
| **Mic release** | `removePublishedTrack()` — track null, AudioRecord released | `setMicrophoneEnabled(false)` — track disabled, AudioRecord held |
| **OS keyboard STT** | Works (mic free) | Blocked (mic held by design — voice mode IS the STT) |
| **On device change** | Guard skips refresh, sets `_pendingDeviceChange` | Guard allows refresh (`restartTrack()` on existing track) |
| **On unmute** | `setMicrophoneEnabled(true)` → new track via `getUserMedia()`, flag cleared | `setMicrophoneEnabled(true)` → re-enables existing track, flag cleared |

## Key Fields

```dart
bool _isMuted = true;               // Starts muted; toggled by toggleMute()/muteOnly()
bool _isRefreshingAudio = false;     // Lock preventing concurrent restartTrack() calls
bool _pendingDeviceChange = false;   // BUG-009: device changed while fully muted
Timer? _deviceChangeDebounce;        // 2s debounce on device change events
```

## Edge Cases

| Scenario | Handling |
|---|---|
| **Reconnect while muted** | `RoomReconnectedEvent` calls `_refreshAudioTrack()` → guard skips (track null), sets flag → unmute picks up current device |
| **Rapid BT device flips while muted** | Each flip debounces to 2s → eventually calls `_refreshAudioTrack()` → guard skips, sets flag (idempotent) → unmute resolves |
| **Device change during soft-mute** | Track exists, guard allows `restartTrack()` to proceed → audio routing updated immediately |
| **Soft-unmute with pending flag** | `muteOnly()` clears `_pendingDeviceChange` defensively (refresh likely already handled it) |
| **BUG-010 interaction** | Post-refresh 5s suppression timer prevents `getUserMedia()`-triggered device-change events from looping |

## Invariants

1. **`_isRefreshingAudio` is never set when fully muted.** The guard returns
   before the lock, so subsequent device changes are never silently dropped.

2. **`_pendingDeviceChange` is always cleared on unmute.** Both `toggleMute()`
   and `muteOnly()` check and clear the flag.

3. **The mic is never re-grabbed while fully muted.** The only paths that
   acquire `AudioRecord` are `setMicrophoneEnabled(true)` and
   `restartTrack()`, both of which are gated by mute checks.

## File Reference

- `apps/mobile/lib/services/livekit_service.dart` — all logic lives here
- `tasks/03-flutter-app/040-muted-device-change-mic-guard.md` — original task/RCA
- `docs/field-tests/20260310-buglog.md` — field discovery (lines 290–326)
