# Task 094: Fix mic grab in chat mode + stuck room on network switch

## Problem

Two compounding issues during WiFi↔cellular network transitions make the app unusable
without force-quitting. (BUG-046)

1. **Mic grab in chat mode:** The microphone activates even though the user is in text
   mode. The mic indicator appears and the system audio mode changes.
2. **Stuck room:** After the network-triggered disconnect, the app cannot reconnect or
   create a new room. User is stranded in error state with no recovery path.

## Investigation

### Issue 1: Mic grab

#### Theory: PreConnectAudioBuffer ignores input mode

**Confirmed — root cause.** The `RoomReconnectingEvent` handler
(`livekit_service.dart:550-553`) unconditionally creates a `PreConnectAudioBuffer`
and calls `startRecording()`:

```dart
// Buffer mic audio during reconnection (BUG-027)
_reconnectBuffer?.reset();
_reconnectBuffer = PreConnectAudioBuffer(_room!);
_reconnectBuffer!.startRecording(timeout: const Duration(seconds: 60));
```

`startRecording()` calls `LocalAudioTrack.create()` →  `getUserMedia` → opens the
device microphone. There is **no guard** checking `_isMuted`, `_voiceModeActive`, or
input mode. This code was added for BUG-027 (voice-mode audio buffering during
reconnect) and never gated for chat mode.

Other audio paths are safe:
- Initial `connect()` guards with `if (!_isMuted)` (line 485) ✅
- `_refreshAudioTrack()` bails when track is null (line 1220) ✅
- `_connectToNewRoom()` routes through guarded `connect()` ✅
- SDK `rePublishAllTracks()` iterates empty `trackPublications` in chat mode ✅

### Issue 2: Stuck room

#### Theory A: No retry after _connectToNewRoom() failure

**Confirmed — root cause.** When the reconnect budget is exhausted
(`livekit_service.dart:2175-2184`), the exhausted branch calls `_connectToNewRoom()`.
If that fails (catch at line 369-375 sets `ConversationStatus.error`), the method
returns. No further retry. The system stops trying.

#### Theory B: No user-accessible retry in chat mode

**Confirmed — contributing cause.** The error banner (`conversation_screen.dart:114-137`)
is a plain `TuiCard` with `Text` content. No `GestureDetector`, no `onTap`. The user
cannot tap to retry.

Existing recovery triggers:
- App lifecycle resume → `tryReconnect()` — but app stays foreground during network switch
- Mic toggle → `tryReconnect()` — not the primary interaction in chat mode

#### Theory C: ConnectivityService blind to interface switches

**Confirmed — contributing cause.** `ConnectivityService._update()`
(`connectivity_service.dart:67`) only emits when the boolean online state changes.
WiFi→cellular produces `[wifi]→[mobile]` — both "online" — so no event fires.
`_waitForNetworkRestore()` never triggers. The reconnect loop burns its entire budget
against broken TCP connections without waiting for the new interface to stabilize.

## Proposed Fix

### Change 1: Guard PreConnectAudioBuffer for voice mode only (LOW EFFORT)

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Location:** `RoomReconnectingEvent` handler (~line 550)

```dart
// Buffer mic audio during reconnection (BUG-027)
// Only buffer if voice mode is active — chat mode should not grab the mic
if (_voiceModeActive && !_isMuted) {
  _reconnectBuffer?.reset();
  _reconnectBuffer = PreConnectAudioBuffer(_room!);
  _reconnectBuffer!.startRecording(timeout: const Duration(seconds: 60));
}
```

### Change 2: Add tap-to-retry on error banner

**File:** `apps/mobile/lib/screens/conversation_screen.dart`
**Location:** Error banner (~line 114)

Wrap the `TuiCard` in a `GestureDetector` that calls `tryReconnect()`:

```dart
GestureDetector(
  onTap: () => _liveKitService.tryReconnect(),
  child: TuiCard(
    borderColor: ...,
    child: Text('Tap to retry • ${state.errorMessage ?? "Connection error"}', ...),
  ),
),
```

### Change 3: Retry _connectToNewRoom() on failure

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Location:** `_doReconnectAttempt()` exhausted branch (~line 2175)

Add a delayed retry before giving up:

```dart
case ReconnectPhase.exhausted:
    _reconnecting = false;
    _reconnectScheduler.reset();
    await disconnect(preserveTranscripts: true);
    await _connectToNewRoom();
    // If new room also failed, retry once after delay
    if (_state.status == ConversationStatus.error) {
      await Future.delayed(const Duration(seconds: 5));
      if (connectivityService.isOnline) {
        await _connectToNewRoom();
      }
    }
    return;
```

### Change 4: Detect network interface changes in ConnectivityService

**File:** `apps/mobile/lib/services/connectivity_service.dart`
**Location:** `_update()` (~line 63)

Emit an event when the connectivity type changes even if the device stays online:

```dart
void _update(List<ConnectivityResult> results) {
    final previousResults = _currentResults;
    _currentResults = results;
    final online = !results.every((r) => r == ConnectivityResult.none);

    if (online != _isOnline) {
      _isOnline = online;
      _onlineController.add(online);
      notifyListeners();
    } else if (online && _isOnline && !_sameInterfaces(previousResults, results)) {
      // Network interface changed while staying online (WiFi → cellular)
      _onlineController.add(false);
      _onlineController.add(true);
      notifyListeners();
    }
}
```

## Acceptance Criteria

- [x] Network switch in chat mode does NOT activate the microphone
- [x] Error banner is tappable and triggers reconnection
- [x] If new-room creation fails on budget exhaustion, at least one retry after 5s
- [x] WiFi→cellular switch triggers reconnect via ConnectivityService event
- [x] Existing voice-mode audio buffering (BUG-027) still works
- [x] PreConnectAudioBuffer is still created in voice mode when unmuted

## Files

- `apps/mobile/lib/services/livekit_service.dart` — buffer guard, retry logic
- `apps/mobile/lib/screens/conversation_screen.dart` — tap-to-retry
- `apps/mobile/lib/services/connectivity_service.dart` — interface change detection

## Status

- **Date:** 2026-03-16
- **Priority:** HIGH
- **Bug:** BUG-046
- **Status:** COMPLETE
