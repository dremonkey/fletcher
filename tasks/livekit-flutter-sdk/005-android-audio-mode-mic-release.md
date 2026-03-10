# Task 005: Release Android AudioManager Mode on Mute

**Epic:** LiveKit Flutter SDK Issues
**Status:** [~] Implemented, pending field verification
**Priority:** High
**Date:** 2026-03-09
**Bug:** [BUG-001](../../docs/field-tests/20260309-buglog.md) — Mute doesn't release OS mic

## Problem

When the user mutes the microphone (switches to text-input mode), Android's keyboard speech-to-text (STT) cannot access the microphone. The OS mic resource appears held even though Fletcher has stopped its audio track.

**User impact:** Cannot use voice typing in Android keyboard while in text-input mode.
**Frequency:** Every occurrence while connected to a LiveKit room.

## Investigation

### Theory 1: VAD / audio level monitoring holds the mic

**Hypothesis:** The client-side VAD or audio level monitoring introduced in Epic 20 (commit `84a1d2a`) keeps the microphone active even after muting.

**Code check:**
- `LocalVadService` (`apps/mobile/lib/services/local_vad_service.dart`) exists but is **never activated**. `AgentPresenceService._startLocalVad()` (line 210) is a no-op:
  ```dart
  void _startLocalVad() {
    // Local VAD mic capture is disabled — speech detection is handled by
    // LiveKitService._updateAudioLevels() using the existing LiveKit audio
    // session to avoid mic capture conflicts on Android.
    debugPrint('[AgentPresence] Waiting for speech (via audio level monitoring)');
  }
  ```
- Speech detection uses `_updateAudioLevels()` (line 1063-1079 of `livekit_service.dart`), which reads `_localParticipant?.audioLevel` — a **server-computed** value from the signaling channel, not a local mic access.
- The speech detection block is guarded by `!_isMuted` (line 1068), so it doesn't run when muted.

**Verdict:** ❌ Refuted. The VAD is disabled and audio level monitoring doesn't access the mic.

### Theory 2: LiveKit SDK's `setMicrophoneEnabled(false)` doesn't release Android AudioManager

**Hypothesis:** The LiveKit SDK stops the audio track on mute but doesn't change the Android `AudioManager` mode from `MODE_IN_COMMUNICATION` to `MODE_NORMAL`, blocking the OS speech recognizer.

**Code trace — the mute path:**

1. `toggleMute()` calls `_localParticipant?.setMicrophoneEnabled(false)` (line 1163)
2. `setMicrophoneEnabled(false)` → `setSourceEnabled(microphone, false)` (`local.dart:669-671`)
3. `setSourceEnabled` finds existing publication, calls `publication.mute(stopOnMute: true)` (`local.dart:712`)
4. `LocalTrackPublication.mute()` delegates to `track.mute(stopOnMute: true)` (`publication/local.dart:43`)
5. `LocalTrack.mute()` calls `disable()` then `stop()` (`track/local/local.dart:106-114`):
   ```dart
   Future<bool> mute({bool stopOnMute = true}) async {
     if (muted) return false;
     await disable();
     if (!skipStopForTrackMute() && stopOnMute) {
       await stop();
     }
     updateMuted(true, shouldSendSignal: true);
     return true;
   }
   ```
6. `stop()` calls `mediaStreamTrack.stop()` + `mediaStream.dispose()` (`track/local/local.dart:132-146`):
   ```dart
   Future<bool> stop() async {
     final didStop = await super.stop() || !_stopped;
     if (didStop) {
       await mediaStreamTrack.stop();
       await mediaStream.dispose();
       _stopped = true;
     }
     // ...
   }
   ```

**What does NOT happen:**
- `onUnpublish()` is NOT called → `_localTrackCount` stays at 1 (in `audio_management.dart`)
- `NativeAudioManagement.stop()` is NOT called (only called on room disconnect)
- The Android `AudioManager` mode stays in `MODE_IN_COMMUNICATION`

**Code trace — Android audio mode lifecycle:**

`NativeAudioManagement` (`livekit_client-2.5.4/lib/src/track/audio_management.dart:163-180`) only operates at the **room lifecycle** level:

```dart
class NativeAudioManagement {
  static Future<void> start() async {
    if (lkPlatformIs(PlatformType.android)) {
      // Always sets MODE_IN_COMMUNICATION on room connect
      await rtc.Helper.setAndroidAudioConfiguration(
        rtc.AndroidAudioConfiguration.communication);
    }
  }

  static Future<void> stop() async {
    if (lkPlatformIs(PlatformType.android)) {
      await rtc.Helper.clearAndroidCommunicationDevice();
    }
  }
}
```

- `start()` is called at `room.connect()` (`room.dart:292`)
- `stop()` is called at `room.disconnect()` (`room.dart:1009`)
- **Neither is called on track mute/unmute**

Additionally, `_onAudioTrackCountDidChange()` (line 101) only reconfigures audio on **iOS**, not Android:
```dart
if (lkPlatformIs(PlatformType.iOS)) {
  // Only iOS for now...
  config = await onConfigureNativeAudio.call(_audioTrackState);
}
```

**Verdict:** ✅ Confirmed. This is the root cause. The Android `AudioManager` stays in `MODE_IN_COMMUNICATION` for the entire room session, regardless of mute state. `MODE_IN_COMMUNICATION` blocks Android's speech recognizer from accessing the mic.

### Key insight

The LiveKit Flutter SDK treats audio mode configuration as a **session-level** concern (set once on connect, cleared on disconnect), not a **track-level** concern. On iOS, track count changes trigger audio session reconfiguration. On Android, there is no equivalent mechanism — the AudioManager mode is static for the duration of the room connection.

The `flutter_webrtc` package (`1.3.0`) exposes the APIs needed to change the configuration mid-session:
- `Helper.setAndroidAudioConfiguration(AndroidAudioConfiguration.media)` — switches to `MODE_NORMAL`
- `Helper.setAndroidAudioConfiguration(AndroidAudioConfiguration.communication)` — switches to `MODE_IN_COMMUNICATION`

Both `Helper` and `AndroidAudioConfiguration` are publicly exported from `package:flutter_webrtc/flutter_webrtc.dart`.

## Proposed Fix

Toggle Android `AudioManager` mode in `toggleMute()` using the `flutter_webrtc` API directly.

### Change 1: Import flutter_webrtc in livekit_service.dart

**File:** `apps/mobile/lib/services/livekit_service.dart` (line 1)

Add imports:
```dart
import 'dart:io' show Platform;
import 'package:flutter_webrtc/flutter_webrtc.dart' as rtc;
```

### Change 2: Toggle Android audio mode in toggleMute()

**File:** `apps/mobile/lib/services/livekit_service.dart` (lines 1151-1165)

Before:
```dart
Future<void> toggleMute() async {
  _isMuted = !_isMuted;
  debugPrint('[Fletcher] Mute toggled: muted=$_isMuted');

  if (_isMuted) {
    _updateState(status: ConversationStatus.muted);
  } else {
    _updateState(status: ConversationStatus.idle);
  }

  // Await mic enable/disable so the OS mic resource is fully
  // released before the keyboard (Android STT) tries to use it.
  await _localParticipant?.setMicrophoneEnabled(!_isMuted);
  debugPrint('[Fletcher] Mic ${_isMuted ? "stopped" : "started"}');
}
```

After:
```dart
Future<void> toggleMute() async {
  _isMuted = !_isMuted;
  debugPrint('[Fletcher] Mute toggled: muted=$_isMuted');

  if (_isMuted) {
    _updateState(status: ConversationStatus.muted);
    // Stop mic track first, then release Android AudioManager mode.
    await _localParticipant?.setMicrophoneEnabled(false);
    // BUG-001: LiveKit only sets MODE_IN_COMMUNICATION on room connect and
    // clears on disconnect — muting doesn't change the mode, which blocks
    // Android's speech recognizer (keyboard STT). Switch to media mode to
    // release the mic for the OS.
    if (Platform.isAndroid) {
      await rtc.Helper.setAndroidAudioConfiguration(
        rtc.AndroidAudioConfiguration.media,
      );
    }
  } else {
    _updateState(status: ConversationStatus.idle);
    // Restore communication mode BEFORE restarting the mic, so the new
    // audio track gets the correct processing pipeline.
    if (Platform.isAndroid) {
      await rtc.Helper.setAndroidAudioConfiguration(
        rtc.AndroidAudioConfiguration.communication,
      );
    }
    await _localParticipant?.setMicrophoneEnabled(true);
  }
  debugPrint('[Fletcher] Mic ${_isMuted ? "stopped" : "started"}');
}
```

### Change 3: Reset audio mode after reconnect if muted

**File:** `apps/mobile/lib/services/livekit_service.dart` (after line 403)

After `setMicrophoneEnabled(!_isMuted)`, add:
```dart
// BUG-001: room.connect() sets AudioManager to MODE_IN_COMMUNICATION.
// If the user is muted, switch back to media mode so keyboard STT works.
if (_isMuted && Platform.isAndroid) {
  await rtc.Helper.setAndroidAudioConfiguration(
    rtc.AndroidAudioConfiguration.media,
  );
}
```

### Change 4: Add flutter_webrtc as explicit dependency (optional)

**File:** `apps/mobile/pubspec.yaml`

`flutter_webrtc` is already a transitive dependency via `livekit_client`. Adding it explicitly ensures the import works and makes the dependency visible. Match the version already resolved in the lockfile.

## Edge Cases

1. **Audio routing change on mute:** Switching from `communication` (earpiece) to `media` (speaker) mode may change the audio output device. If the agent is still speaking (e.g., finishing a response), the audio may jump to the speaker. This is acceptable — the user deliberately chose text mode. When unmuting, communication mode restores the earpiece.

2. **Rapid mute/unmute toggling:** Each toggle calls `setAndroidAudioConfiguration()` which invokes a platform channel. Rapid toggling could queue up configuration changes. Since these are awaited sequentially in `toggleMute()`, they should execute in order. Consider adding a debounce if this becomes an issue.

3. **Reconnect while muted:** The room's `connect()` always sets `MODE_IN_COMMUNICATION`. Change 3 switches back to `media` mode if the user is muted. The audio level timer continues running during reconnect — it reads `Participant.audioLevel` (server-pushed) and won't be affected by the mode change.

4. **`flutter_webrtc` warns "cannot be changed mid session":** The `Helper.setAndroidAudioConfiguration` docs say it should be set before initiating a session. In practice, `AudioManager.setMode()` on Android can be called at any time. Since we stop the audio track before switching to media mode, and restore communication mode before starting a new track, the WebRTC audio processing pipeline should handle this gracefully.

5. **iOS:** No change needed. The LiveKit SDK already handles audio session reconfiguration on iOS via `_onAudioTrackCountDidChange()` (line 112 of `audio_management.dart`), which only runs `if (lkPlatformIs(PlatformType.iOS))`.

6. **Web:** `Platform.isAndroid` check ensures the fix is Android-only. `flutter_webrtc`'s `setAndroidAudioConfiguration` is a no-op on non-Android platforms.

## Acceptance Criteria

- [ ] After muting (switching to text-input mode), Android keyboard STT can access the microphone
- [ ] After unmuting (switching back to voice-first mode), LiveKit audio track captures audio normally
- [ ] Audio quality is not degraded after a mute→unmute cycle
- [ ] Rapid mute/unmute toggling (5+ times in quick succession) doesn't crash or leave audio in a broken state
- [ ] Reconnecting while muted still allows keyboard STT after reconnect completes
- [ ] No regression on iOS (if testable)

## Files

- `apps/mobile/lib/services/livekit_service.dart` — add audio mode toggle to `toggleMute()` and post-connect
- `apps/mobile/pubspec.yaml` — (optional) add `flutter_webrtc` as explicit dependency

## Status

- **Date:** 2026-03-09
- **Priority:** High — blocks keyboard STT usage in text-input mode
- **Status:** Implemented, pending field verification
