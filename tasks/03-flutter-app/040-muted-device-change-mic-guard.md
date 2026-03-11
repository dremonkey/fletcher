# Task 040: Guard Audio Track Restart When User is Muted

**Epic:** 03 — Flutter App
**Status:** Implemented
**Priority:** Medium
**Origin:** Field test BUG-009 (2026-03-10)

## Problem

When a network handoff occurs (WiFi→5G, Bluetooth device change, etc.), the Flutter app
fires a `_onDeviceChange` event which debounces and then calls `_refreshAudioTrack()`. The
original theory was that `restartTrack()` ran unconditionally — reclaiming the Android mic
in communication mode and blocking OS keyboard STT. **RCA shows the situation is more
nuanced: a partial guard already exists, but there are two real remaining defects.**

**Observed client log pattern:**
```
[Fletcher] Device change detected — debouncing (2s)
[Fletcher] Device change detected — debouncing (2s)
[Fletcher] Audio device changed — refreshing audio track
```

---

## Root Cause Analysis (RCA)

### Code path

**`_onDeviceChange()` — `livekit_service.dart:998`**

```dart
void _onDeviceChange() {
  // Skip if already refreshing audio or fully disconnected
  if (_isRefreshingAudio || _reconnecting || _room == null) {
    debugPrint('[Fletcher] Device change ignored: ...');
    return;
  }

  debugPrint('[Fletcher] Device change detected — debouncing (2s)');
  _deviceChangeDebounce?.cancel();
  _deviceChangeDebounce = Timer(const Duration(seconds: 2), () {
    _refreshAudioTrack();
  });
}
```

**`_refreshAudioTrack()` — `livekit_service.dart:1014`**

```dart
Future<void> _refreshAudioTrack() async {
  if (_isRefreshingAudio || _localParticipant == null) return;
  _isRefreshingAudio = true;

  debugPrint('[Fletcher] Audio device changed — refreshing audio track');  // line 1018

  try {
    // Wait for the OS to settle the new Bluetooth audio route
    await Future.delayed(const Duration(seconds: 1));               // line 1022

    final publication = _localParticipant!.audioTrackPublications.firstOrNull; // line 1027
    final track = publication?.track;                                           // line 1028
    if (track != null && !_isMuted) {                                           // line 1029
      await track.restartTrack();
      debugPrint('[Fletcher] Audio track restarted successfully');
    }
  } catch (e) {
    debugPrint('[Flutter] Audio track refresh failed: $e');
  } finally {
    _isRefreshingAudio = false;
  }
}
```

### Mute state tracking

`_isMuted` is a first-class field (`livekit_service.dart:35`):

```dart
bool _isMuted = true;
bool get isMuted => _isMuted;
```

### How muting actually works (current implementation)

`toggleMute()` at `livekit_service.dart:1178` uses `removePublishedTrack()`, NOT just
`setMicrophoneEnabled(false)`:

```dart
if (_isMuted) {
  final pub = _localParticipant?.getTrackPublicationBySource(TrackSource.microphone);
  if (pub != null) {
    await _localParticipant!.removePublishedTrack(pub.sid);  // line 1192
    debugPrint('[Fletcher] Audio track unpublished (mic released for OS)');
  } else {
    await _localParticipant?.setMicrophoneEnabled(false);    // line 1196 — fallback
  }
}
```

`removePublishedTrack()` removes the track from `trackPublications` entirely
(`local.dart:632-633`), so `audioTrackPublications.firstOrNull` returns `null` when muted.

### Why `restartTrack()` is currently blocked when muted

**Defect 1 claim in original task file is incorrect.** `restartTrack()` does NOT run
unconditionally. There is already a double guard at line 1029:
- `track != null` — false when muted via `removePublishedTrack()`, because the publication
  was removed and `audioTrackPublications` is empty
- `!_isMuted` — false whenever `_isMuted == true`

Either condition independently prevents `restartTrack()` from being called.

### What `restartTrack()` actually does (SDK)

`local.dart:197-244` in `livekit_client-2.5.4`:

```dart
Future<void> restartTrack([LocalTrackOptions? options]) async {
  if (sender == null) throw TrackCreateException('could not restart track');
  // ...
  await stop();
  final newStream = await LocalTrack.createStream(currentOptions);  // calls getUserMedia()
  final newTrack = newStream.getTracks().first;
  // ...
  await sender?.replaceTrack(newTrack);   // replaces track on existing RTP sender
  // ...
  await start();
}
```

`createStream()` calls `rtc.navigator.mediaDevices.getUserMedia()` which is what causes
Android to grab `AudioRecord` and assert `MODE_IN_COMMUNICATION`. It does NOT re-publish the
track — it replaces the existing sender's track via `RTCRtpSender.replaceTrack()`.

### Defect 1: `_refreshAudioTrack()` runs wasteful work when muted

Even though `restartTrack()` is blocked, `_refreshAudioTrack()` still:
1. Sets `_isRefreshingAudio = true` — blocking any subsequent device change events for ~1s
2. Logs "Audio device changed — refreshing audio track" — misleading (nothing actually refreshed)
3. Waits 1 second (`Future.delayed`)
4. Reads `audioTrackPublications.firstOrNull` — always null when muted

This is a correctness gap rather than a "restartTrack runs" bug. The real harm is that
`_isRefreshingAudio = true` for ~1 second while muted blocks any device change that fires
during that window from being debounced. If the user is rapidly switching BT devices while
muted, a real device change could be silently dropped.

### Defect 2: No deferred restart — BT routing not restored after muted handoff

When a device change occurs while muted, the track restart is correctly skipped. But there
is no `_pendingDeviceChange` flag (`livekit_service.dart` — grep confirms no such field).
When the user unmutes, `toggleMute()` calls `setMicrophoneEnabled(true)` which creates a
fresh `LocalAudioTrack` via `getUserMedia()` — this DOES pick up the current active device.
So BT routing IS restored on unmute, but only incidentally because a new track is created
from scratch. There is no explicit deferred restart logic.

**Result:** If a device change fires while muted and the route changes (e.g., BT headset
disconnects), the routing is not restored until the user manually unmutes. If the user
never unmutes in that session, the audio route stays stale for subsequent unmute/remute
cycles that use `setMicrophoneEnabled(false)` (the fallback at line 1196) instead of
`removePublishedTrack`.

### Second call site: `RoomReconnectedEvent` (line 532)

`_refreshAudioTrack()` is also called from the `RoomReconnectedEvent` handler:

```dart
_listener?.on<RoomReconnectedEvent>((_) async {
  // ... other reconnect logic ...
  // After reconnection, refresh audio track to restore BT routing (BUG-021)
  _refreshAudioTrack();   // line 532
});
```

There is NO mute pre-check before this call. The internal guard at line 1029 handles it,
but the same wasteful-work problem applies: the 1-second delay runs even when muted.

**Log evidence from BUG-010** confirms this path fires while user is muted:
```
16:53:47 SDK reconnected successfully
16:53:47 Audio device changed — refreshing audio track
```

---

## Precise Fix

### Change 1: Early-exit in `_refreshAudioTrack()` when muted

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Location:** `_refreshAudioTrack()`, after the `_isRefreshingAudio` check at line 1015

**Before** (`livekit_service.dart:1014–1038`):
```dart
Future<void> _refreshAudioTrack() async {
  if (_isRefreshingAudio || _localParticipant == null) return;
  _isRefreshingAudio = true;

  debugPrint('[Fletcher] Audio device changed — refreshing audio track');

  try {
    // Wait for the OS to settle the new Bluetooth audio route
    await Future.delayed(const Duration(seconds: 1));

    // Use restartTrack() to swap the audio capture source via WebRTC's
    // replaceTrack(). This picks up the new active device WITHOUT
    // unpublishing — the agent session stays alive.
    final publication = _localParticipant!.audioTrackPublications.firstOrNull;
    final track = publication?.track;
    if (track != null && !_isMuted) {
      await track.restartTrack();
      debugPrint('[Fletcher] Audio track restarted successfully');
    }
  } catch (e) {
    debugPrint('[Fletcher] Audio track refresh failed: $e');
  } finally {
    _isRefreshingAudio = false;
  }
}
```

**After:**
```dart
Future<void> _refreshAudioTrack() async {
  if (_isRefreshingAudio || _localParticipant == null) return;

  // BUG-009: Skip track restart entirely when muted. The mic is unpublished;
  // there is no track to restart and running the refresh would hold
  // _isRefreshingAudio for ~1s, silently dropping any subsequent device events.
  // BT routing is restored naturally when the user unmutes (setMicrophoneEnabled
  // creates a fresh track that picks up the current active device).
  if (_isMuted) {
    debugPrint('[Fletcher] Device change while muted — skipping audio track restart (BUG-009)');
    _pendingDeviceChange = true;
    return;
  }

  _isRefreshingAudio = true;

  debugPrint('[Fletcher] Audio device changed — refreshing audio track');

  try {
    // Wait for the OS to settle the new Bluetooth audio route
    await Future.delayed(const Duration(seconds: 1));

    // Use restartTrack() to swap the audio capture source via WebRTC's
    // replaceTrack(). This picks up the new active device WITHOUT
    // unpublishing — the agent session stays alive.
    final publication = _localParticipant!.audioTrackPublications.firstOrNull;
    final track = publication?.track;
    if (track != null) {
      await track.restartTrack();
      debugPrint('[Fletcher] Audio track restarted successfully');
    }
  } catch (e) {
    debugPrint('[Fletcher] Audio track refresh failed: $e');
  } finally {
    _isRefreshingAudio = false;
  }
}
```

Note: the `!_isMuted` inner guard at line 1029 becomes redundant once the early-exit is in
place and can be removed (as shown above).

### Change 2: Add `_pendingDeviceChange` field

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Location:** alongside the existing device change fields at lines 70–73

**Before:**
```dart
// Audio device change handling
StreamSubscription<List<MediaDevice>>? _deviceChangeSub;
Timer? _deviceChangeDebounce;
bool _isRefreshingAudio = false;
```

**After:**
```dart
// Audio device change handling
StreamSubscription<List<MediaDevice>>? _deviceChangeSub;
Timer? _deviceChangeDebounce;
bool _isRefreshingAudio = false;
bool _pendingDeviceChange = false;  // BUG-009: device changed while muted; refresh on unmute
```

### Change 3: Apply deferred refresh on unmute

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Location:** `toggleMute()`, in the `else` branch (unmute path), after
`setMicrophoneEnabled(true)` at line 1210

**Before** (unmute path):
```dart
} else {
  _updateState(status: ConversationStatus.idle);
  if (agentPresenceService.enabled &&
      agentPresenceService.state == AgentPresenceState.agentAbsent) {
    debugPrint('[Fletcher] Unmute while agent absent — triggering dispatch');
    agentPresenceService.onSpeechDetected();
  }
  // Republish a fresh audio track — setMicrophoneEnabled(true) creates
  // a new LocalAudioTrack and publishes it to the PeerConnection.
  await _localParticipant?.setMicrophoneEnabled(true);
}
debugPrint('[Fletcher] Mic ${_isMuted ? "stopped" : "started"}');
```

**After:**
```dart
} else {
  _updateState(status: ConversationStatus.idle);
  if (agentPresenceService.enabled &&
      agentPresenceService.state == AgentPresenceState.agentAbsent) {
    debugPrint('[Fletcher] Unmute while agent absent — triggering dispatch');
    agentPresenceService.onSpeechDetected();
  }
  // Republish a fresh audio track — setMicrophoneEnabled(true) creates
  // a new LocalAudioTrack and publishes it to the PeerConnection.
  await _localParticipant?.setMicrophoneEnabled(true);
  // BUG-009: If a device change fired while muted, the new track just published
  // via setMicrophoneEnabled(true) already picked up the current device
  // (getUserMedia returns the active device). Clear the flag.
  if (_pendingDeviceChange) {
    debugPrint('[Fletcher] Applying deferred device change refresh after unmute (BUG-009)');
    _pendingDeviceChange = false;
    // setMicrophoneEnabled(true) above already called getUserMedia with the
    // current device — no additional restartTrack() needed.
  }
}
debugPrint('[Fletcher] Mic ${_isMuted ? "stopped" : "started"}');
```

---

## Edge Cases

### 1. Multiple device changes while muted

`_onDeviceChange` debounces at 2s. Each new event cancels the pending debounce timer and
restarts it. Once the timer fires, `_refreshAudioTrack()` is called and immediately returns
(via the new early-exit), setting `_pendingDeviceChange = true`. Subsequent device changes
while muted also fire `_refreshAudioTrack()` → set `_pendingDeviceChange = true` again
(idempotent). On unmute, the flag is consumed once. This is correct: only one deferred
refresh is needed regardless of how many device changes occurred.

### 2. Device change fires between unmute and setMicrophoneEnabled

`toggleMute()` sets `_isMuted = false` (line 1179) before calling `setMicrophoneEnabled(true)`
(line 1210). If a device change event fires in that window, `_refreshAudioTrack()` will see
`_isMuted == false` and run normally. This is safe — `_localParticipant` exists but the
publication may not yet exist (setMicrophoneEnabled hasn't completed). In that case
`audioTrackPublications.firstOrNull` returns null and `restartTrack()` is skipped. The newly
published track from `setMicrophoneEnabled(true)` will have picked up the correct device.

### 3. Reconnect while muted (`RoomReconnectedEvent` path)

`RoomReconnectedEvent` at line 532 calls `_refreshAudioTrack()` without a pre-check. After
Change 1, the early-exit handles this correctly: `_isMuted == true` → returns immediately,
sets `_pendingDeviceChange = true`. On unmute, the deferred flag is consumed. The SDK's
internal reconnect re-establishes the ICE connection but does NOT republish the audio track
(since it was unpublished before the disconnect). When the user unmutes,
`setMicrophoneEnabled(true)` creates and publishes a fresh track that picks up the current
device.

### 4. `_isRefreshingAudio` interaction

With Change 1, the early-exit happens BEFORE setting `_isRefreshingAudio = true`. This is
intentional: we don't want to block subsequent device change events for 1s when nothing is
actually being refreshed.

---

## Acceptance Criteria

- [x] `_refreshAudioTrack()` returns early when `_isMuted == true`, logging:
      `[Fletcher] Device change while muted — skipping audio track restart (BUG-009)`
- [x] `_isRefreshingAudio` is NOT set to `true` during a muted skip (no 1-second lock held)
- [x] `_pendingDeviceChange` field exists and is set to `true` when a skip occurs
- [x] On unmute, log appears: `[Fletcher] Applying deferred device change refresh after unmute (BUG-009)` (if a device change occurred while muted), and `_pendingDeviceChange` is cleared
- [x] When unmuted and no device change occurred while muted, log does NOT appear and `_pendingDeviceChange` is false
- [x] Tester can use Android keyboard dictation during network handoffs while muted
- [x] No regression: when unmuted, device changes still trigger `restartTrack()` as before
- [x] No regression: BT audio routing works correctly after mute→unmute cycle following a BT device switch

---

## Related

- BUG-009: `docs/field-tests/20260310-buglog.md`
- Task 005 (closed): `tasks/livekit-flutter-sdk/_closed/005-android-audio-mode-mic-release.md`
  — same root (`MODE_IN_COMMUNICATION` blocks OS dictation); fix there used `removePublishedTrack()`
  which already prevents `restartTrack()` from having a sender. BUG-009 is the remaining edge
  case where the preamble runs needlessly and `_pendingDeviceChange` is unimplemented.
- `apps/mobile/lib/services/livekit_service.dart` — `_onDeviceChange` (line 998),
  `_refreshAudioTrack` (line 1014), `toggleMute` (line 1178)
