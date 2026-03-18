# Task 092: Retry connection on resume from background

## Problem

When the user unlocks their phone after Fletcher has been backgrounded (chat mode),
the app attempts to reconnect but fails with "All token hosts failed" because the
WiFi radio hasn't fully re-associated after deep sleep. The user is left stranded
in error state with no automatic recovery. (BUG-044)

## Investigation

### Theory 1: Token server is down

**Refuted.** The user reports WiFi was working fine minutes before. All 3 hosts
(LAN 192.168.87.59, Tailscale 100.87.219.109, emulator 10.0.2.2) timed out with
`SocketException: HTTP connection timed out`. This is a network-level failure, not
a server-side error. The emulator address (10.0.2.2) always fails on real hardware.

### Theory 2: WiFi not ready after deep sleep

**Confirmed.** Android suspends the WiFi radio during deep sleep. On wake, it must
scan, reassociate, and complete DHCP — typically 2-10 seconds depending on AP and
device. The `connectivity_plus` plugin may report "WiFi connected" before the link
is fully usable (Android `ConnectivityManager` vs `NetworkCapabilities.VALIDATED`
race).

Logcat evidence: the URL resolver started at 21:49:39.844 and all 3 TCP connects
failed within 3 seconds. The token service started at 21:49:42.851 and all 3 HTTP
requests timed out after 5 seconds. Total: 8 seconds from resume to failure. WiFi
was likely still re-establishing.

### Theory 3: No retry in the onAppResumed path

**Confirmed — this is the root cause.** The resume-from-background flow has no
retry mechanism:

1. `onAppBackgrounded()` (line 2261) sets `_backgroundDisconnected = true` and
   calls `disconnect(preserveTranscripts: true)` (line 2270)

2. `onAppResumed()` (line 2308) sees `_backgroundDisconnected == true`, clears it,
   and calls `connectWithDynamicRoom()` **fire-and-forget** (not awaited — `onAppResumed`
   is `void`):

   ```dart
   // livekit_service.dart:2308-2318
   void onAppResumed() {
     if (_backgroundDisconnected) {
       _backgroundDisconnected = false;
       connectWithDynamicRoom(
         urls: _allUrls,
         tokenServerPort: _tokenServerPort,
         departureTimeoutS: _departureTimeoutS,
       );
       return;
     }
   ```

3. Meanwhile, `tryReconnect()` is called immediately after `onAppResumed()` from
   `conversation_screen.dart:65-66`:

   ```dart
   case AppLifecycleState.resumed:
     _liveKitService.onAppResumed();
     _liveKitService.tryReconnect();
   ```

   But `tryReconnect()` checks `_state.status` which hasn't changed yet (the async
   `connectWithDynamicRoom()` hasn't had time to fail). `disconnect()` (line 2347)
   doesn't update status. So `tryReconnect()` sees a non-error status and returns
   immediately — it never engages.

4. 8 seconds later, `connectWithDynamicRoom()` catches the exception and sets
   `status: ConversationStatus.error` (line 300-303). No one is listening. The
   user is stuck.

### Key insight

The existing `ReconnectScheduler` infrastructure (fast retries + slow polling) is
designed for WebSocket drops (SDK-level events), not for the background-resume
code path. The background-resume path bypasses it entirely.

## Proposed Fix

Extract the reconnection logic in `onAppResumed()` into a new async method
`_reconnectAfterBackground()` that retries with delays between attempts.

### Change 1: Add cancellation flag and retry method

**File:** `apps/mobile/lib/services/livekit_service.dart`

Add a `_backgroundReconnecting` flag near the other background state (around line 110):

```dart
bool _backgroundReconnecting = false;
```

Add a new method after `onAppResumed()` (around line 2337):

```dart
/// Reconnect after a chat-mode background disconnect, with retries.
///
/// Android WiFi often needs several seconds to re-associate after deep
/// sleep. A single connection attempt frequently fails because the radio
/// isn't ready yet. Retry up to [_bgReconnectMaxAttempts] times with a
/// [_bgReconnectDelay] pause between attempts. (BUG-044)
Future<void> _reconnectAfterBackground() async {
  const maxAttempts = 3;
  const retryDelay = Duration(seconds: 3);

  _backgroundReconnecting = true;

  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    if (!_backgroundReconnecting) {
      debugPrint('[Fletcher] Background reconnect cancelled');
      return;
    }

    debugPrint('[Fletcher] Background reconnect attempt $attempt/$maxAttempts');
    await connectWithDynamicRoom(
      urls: _allUrls,
      tokenServerPort: _tokenServerPort,
      departureTimeoutS: _departureTimeoutS,
    );

    // Success
    if (_state.status != ConversationStatus.error) {
      _backgroundReconnecting = false;
      return;
    }

    // Last attempt — don't sleep
    if (attempt >= maxAttempts) break;

    // Bail if we went offline
    if (!connectivityService.isOnline) {
      debugPrint('[Fletcher] Went offline during background reconnect — aborting');
      break;
    }

    debugPrint('[Fletcher] Retrying in ${retryDelay.inSeconds}s...');
    await Future.delayed(retryDelay);
  }

  _backgroundReconnecting = false;
  debugPrint('[Fletcher] Background reconnect exhausted after $maxAttempts attempts');
}
```

### Change 2: Wire onAppResumed to use the retry method

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Lines:** 2310-2317

Before:
```dart
if (_backgroundDisconnected) {
  _backgroundDisconnected = false;
  debugPrint('[Fletcher] Resuming after background disconnect — reconnecting');
  connectWithDynamicRoom(
    urls: _allUrls,
    tokenServerPort: _tokenServerPort,
    departureTimeoutS: _departureTimeoutS,
  );
  return;
}
```

After:
```dart
if (_backgroundDisconnected) {
  _backgroundDisconnected = false;
  debugPrint('[Fletcher] Resuming after background disconnect — reconnecting');
  _reconnectAfterBackground();
  return;
}
```

### Change 3: Cancel background reconnect on re-background

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Line:** 2262 (top of `onAppBackgrounded`)

Add after the `_room == null` guard:

```dart
// Cancel any in-progress background reconnect attempt (BUG-044)
_backgroundReconnecting = false;
```

## Edge Cases

1. **App re-backgrounded during retry wait:** `onAppBackgrounded()` sets
   `_backgroundReconnecting = false`. The next loop iteration exits early.
   On the next resume, a fresh retry sequence starts.

2. **Double resume (hidden → inactive → resumed):** `_backgroundDisconnected`
   is cleared on the first `onAppResumed()` call. Subsequent calls are no-ops.

3. **Network goes offline during retry:** The `connectivityService.isOnline`
   check between attempts catches this. The error state remains and
   `tryReconnect()` can pick it up on the next resume.

4. **WiFi comes back during URL resolver timeout:** The URL resolver uses TCP
   connect with a 3s timeout. If WiFi recovers mid-attempt, the TCP connect
   may still fail if the socket was already created before the link came up.
   The retry handles this — the next attempt gets a fresh socket.

5. **All retries fail (server actually down):** After 3 failed attempts the
   user sees the error state, same as today but with an extra ~9s of trying.
   They can tap to manually retry.

## Acceptance Criteria

- [ ] Resume from background after 5+ minutes succeeds within 3 retry attempts
- [ ] If WiFi is truly unavailable, error state is reached after ~20s (3 attempts)
- [ ] Re-backgrounding during retry cancels the retry cleanly
- [ ] No duplicate connection attempts (only one retry loop at a time)
- [ ] Existing reconnect behavior (WebSocket drops, `tryReconnect()`) unchanged

## Files

- `apps/mobile/lib/services/livekit_service.dart` — retry logic, cancellation

## Status

- **Date:** 2026-03-16
- **Priority:** HIGH
- **Bug:** BUG-044
- **Status:** RCA COMPLETE — ready for implementation
