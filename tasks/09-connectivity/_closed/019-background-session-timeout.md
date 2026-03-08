# Task: Background session timeout & app-close disconnect

## Problem

The foreground service ("Voice session active") keeps the voice session alive indefinitely when the app is backgrounded — even when the user isn't actively using Fletcher. This causes unnecessary battery drain in two scenarios:

1. **App closed (swipe-away):** The session should disconnect immediately, but `dispose()` isn't reliably called on Android when the user swipes the app from recents.
2. **App backgrounded (switched to another app):** The session stays alive forever with no timeout. If the user forgets to return, the mic, WebSocket, and foreground service continue draining battery.

The foreground service (task 012) was added to keep the mic alive for legitimate background use (phone in pocket, Bluetooth earbuds). But it's too aggressive — there's no upper bound on how long it runs.

**Constraint:** Locking the screen should **not** trigger the timeout. The user may be walking around talking through earbuds with the screen off.

## Root Cause

`conversation_screen.dart` only handles `AppLifecycleState.resumed`:

```dart
void didChangeAppLifecycleState(AppLifecycleState state) {
  if (state == AppLifecycleState.resumed) {
    _liveKitService.tryReconnect();
  }
  // ← nothing for paused/detached/hidden/inactive
}
```

No lifecycle handling exists for:
- `paused` — app moved to background (also triggered by screen lock)
- `detached` — app being destroyed
- `hidden` — app covered by another activity (Android 13+)

Additionally, there is no `onDestroy` or process-death handler to guarantee cleanup when the user swipes the app from recents.

## Proposed Fix

### Behavior Summary

| Event | Action |
|-------|--------|
| Screen lock | **No timeout.** Session stays alive (earbuds use case). |
| Switch to another app | Start a **10-minute timeout**. If user doesn't return, disconnect. |
| Swipe app from recents | **Immediate disconnect** via native `onTaskRemoved` handler. |
| Return to app before timeout | Cancel the timeout, resume normally. |
| Return to app after timeout | Session already disconnected. Reconnect via `tryReconnect()`. |

### Phase 1: Detect lock vs app-switch

Use `flutter_foreground_task` or a platform channel to detect whether the screen is locked. On `AppLifecycleState.paused`:
- If screen is locked → do nothing (session stays alive)
- If screen is **not** locked → the user switched apps → start timeout

**Detection approach:** Use a method channel to call Android's `KeyguardManager.isKeyguardLocked()` and iOS's `UIApplication.shared.isProtectedDataAvailable` (inverted). Wrap in a small utility:

```dart
/// Returns true if the device screen is locked.
Future<bool> isScreenLocked() async {
  try {
    final result = await _channel.invokeMethod<bool>('isScreenLocked');
    return result ?? false;
  } catch (_) {
    return false; // assume not locked if detection fails
  }
}
```

**Native side (Android):** In `MainActivity.kt`:

```kotlin
import android.app.KeyguardManager
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.fletcher.fletcher/screen_state"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                if (call.method == "isScreenLocked") {
                    val km = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
                    result.success(km.isKeyguardLocked)
                } else {
                    result.notImplemented()
                }
            }
    }
}
```

**Native side (iOS):** In `AppDelegate.swift`:

```swift
let channel = FlutterMethodChannel(name: "com.fletcher.fletcher/screen_state",
                                    binaryMessenger: controller.binaryMessenger)
channel.setMethodCallHandler { (call, result) in
    if call.method == "isScreenLocked" {
        result(UIApplication.shared.isIdleTimerDisabled == false
               && !UIApplication.shared.isProtectedDataAvailable)
    } else {
        result(FlutterMethodNotImplemented)
    }
}
```

### Phase 2: 10-minute background timeout

In `LiveKitService`, add a background timeout timer:

```dart
Timer? _backgroundTimeoutTimer;
static const backgroundTimeout = Duration(minutes: 10);

void onAppBackgrounded({required bool isScreenLocked}) {
  if (isScreenLocked) return; // don't timeout on lock screen

  _backgroundTimeoutTimer?.cancel();
  _backgroundTimeoutTimer = Timer(backgroundTimeout, () {
    debugPrint('[Fletcher] Background timeout — disconnecting session');
    disconnect();
  });
}

void onAppResumed() {
  if (_backgroundTimeoutTimer != null) {
    debugPrint('[Fletcher] Returned to foreground — cancelling background timeout');
    _backgroundTimeoutTimer?.cancel();
    _backgroundTimeoutTimer = null;
  }
}
```

Update `ConversationScreen`:

```dart
@override
void didChangeAppLifecycleState(AppLifecycleState state) async {
  switch (state) {
    case AppLifecycleState.paused:
      final locked = await isScreenLocked();
      _liveKitService.onAppBackgrounded(isScreenLocked: locked);
      break;
    case AppLifecycleState.resumed:
      _liveKitService.onAppResumed();
      _liveKitService.tryReconnect();
      break;
    case AppLifecycleState.detached:
      _liveKitService.disconnect();
      break;
    default:
      break;
  }
}
```

### Phase 3: Immediate disconnect on swipe-away

Override `onTaskRemoved` in the Android foreground service to guarantee cleanup when the user swipes the app from recents.

**Option A — `flutter_foreground_task` callback:** Check if the plugin supports an `onTaskRemoved` or `onDestroy` callback. If so, wire it to call `disconnect()`.

**Option B — Custom Android service:** If the plugin doesn't support this, add a minimal Kotlin service:

```kotlin
class FletcherCleanupService : Service() {
    override fun onTaskRemoved(rootIntent: Intent?) {
        // App swiped from recents — clean up
        stopForegroundService()
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }
}
```

Register with `android:stopWithTask="false"` so `onTaskRemoved` fires.

### Phase 4: Update notification text

While the background timeout is running, update the foreground notification to indicate the countdown:

```
"Voice session active — disconnecting in X min"
```

This gives the user visibility into the timeout if they pull down the notification shade.

## Edge Cases

1. **Screen locks while timeout is running:** If the user switches apps (starting the 10-min timer) and then locks the screen, the timer should **continue**. The lock-screen exemption only applies when the screen is locked at the moment of backgrounding (i.e., the user intentionally locked while talking).

2. **Rapid app-switch → return cycles:** Timer is cancelled on resume and restarted on next background. No accumulation.

3. **Timeout fires during reconnection:** If the connection is already in `reconnecting` state and the background timeout fires, `disconnect()` will clean up the reconnection scheduler too.

4. **iOS behavior:** iOS suspends apps more aggressively. The `Timer` may not fire reliably after iOS suspends the Dart isolate (~30s). Consider using a background task (`BGTaskScheduler`) or accepting that iOS may kill the app before the 10-min timer fires (which achieves the same goal — session ends).

5. **`detached` vs swipe-away:** `AppLifecycleState.detached` is not reliably delivered on Android when swiping from recents. The `onTaskRemoved` approach (Phase 3) is the reliable mechanism.

## Acceptance Criteria

- [x] Locking the screen does **not** start any disconnect timer
- [x] Switching to another app starts a 10-minute countdown
- [x] Returning to the app before 10 minutes cancels the countdown
- [x] After 10 minutes backgrounded, the session disconnects and foreground service stops
- [x] Swiping the app from recents immediately stops the foreground service
- [x] The notification text updates to show countdown status
- [ ] Battery usage is measurably reduced when app is left backgrounded
- [ ] Field test: lock screen while talking → session stays alive indefinitely
- [ ] Field test: switch to Chrome for 5 minutes → session still alive
- [ ] Field test: switch to Chrome for 11 minutes → session disconnected on return

## Files

- `apps/mobile/lib/screens/conversation_screen.dart` — lifecycle state handling
- `apps/mobile/lib/services/livekit_service.dart` — timeout timer + `onAppBackgrounded`/`onAppResumed`
- `apps/mobile/android/app/src/main/kotlin/com/fletcher/fletcher/MainActivity.kt` — `isScreenLocked` method channel
- `apps/mobile/ios/Runner/AppDelegate.swift` — `isScreenLocked` method channel (iOS)
- `apps/mobile/android/app/src/main/AndroidManifest.xml` — possible service updates for `onTaskRemoved`

## Dependencies

- Builds on task 012 (foreground service for background microphone)
- Related to task 017 (time-budgeted reconnect) — the background timeout is separate from reconnect timeout

## Status
- **Date:** 2026-03-05
- **Priority:** Medium (battery/UX improvement, not a crash bug)
- **Status:** Implemented, pending field verification
