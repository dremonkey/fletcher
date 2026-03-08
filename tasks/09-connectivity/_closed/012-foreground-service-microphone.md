# Task: Add Android foreground service for background microphone access

## Problem

When the Fletcher app goes to background (screen lock, accidental swipe, pocket), Android 14+ silences the microphone within 5 seconds via AppOps policy. This triggers a cascade: WebRTC receives silence → SDK reconnect loop exhausts all 10 attempts in 75 seconds → full disconnect with `reconnectAttemptsExceeded`. The user must reopen the app to reconnect.

This makes Fletcher unusable for its primary use case — walking around with the phone in a pocket while talking through Bluetooth earbuds.

**Field test references:**
- [BUG-022 (03-03)](../../docs/field-tests/20260303-buglog.md) — microphone silenced on background, full disconnect cascade
- Related: [BUG-021](../../docs/field-tests/20260303-buglog.md) — foreground service would also help maintain BT SCO during network transitions

## Investigation

### Theory 1: App lacks `FOREGROUND_SERVICE_MICROPHONE` declaration

**Hypothesis:** Android 14+ requires apps to declare a foreground service with `FOREGROUND_SERVICE_MICROPHONE` type to use the microphone from the background. Fletcher doesn't have this.

**Verified against AndroidManifest.xml** (`apps/mobile/android/app/src/main/AndroidManifest.xml`):

```xml
<!-- Lines 2-7: Current permissions -->
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
```

**Missing:**
- `android.permission.FOREGROUND_SERVICE` — base foreground service permission
- `android.permission.FOREGROUND_SERVICE_MICROPHONE` — microphone-specific (Android 14+)
- No `<service>` element declaring a foreground service

**Conclusion:** Confirmed. The manifest has `RECORD_AUDIO` (runtime permission) but no foreground service infrastructure. Android enforces "while-in-use" restrictions on `RECORD_AUDIO` — when the app goes to background without a foreground service, AppOps silences the microphone.

### Theory 2: The cascade is triggered by AppOps op 27

**Hypothesis:** Android's AppOps system (op 27 = `RECORD_AUDIO`) silences the mic, causing WebRTC to send silence frames, which LiveKit interprets as connection degradation.

**Verified against field test logs** (`docs/field-tests/20260303-buglog.md`, lines 141-149):

```
09:08:09 Window moved TO_BACK (app goes to background)
09:08:14 audioserver: App op 27 missing, silencing record  com.fletcher.fletcher
09:08:14 AudioHardening: background playback would be muted for com.fletcher.fletcher, level: partial
```

5 seconds after backgrounding, the audioserver silences recording. Then (lines 149-151):
- SDK reconnect attempts exhausted (10/10 in 75s)
- Agent disconnection
- BT SCO teardown
- Audio focus abandoned
- `DisconnectReason.reconnectAttemptsExceeded`

**Conclusion:** Confirmed. The chain is: background → AppOps silences mic → WebRTC detects silence/degradation → SDK reconnect loop → exhaustion → full disconnect.

### Theory 3: No lifecycle handling for background transition

**Hypothesis:** The app doesn't handle the transition to background — it doesn't start a foreground service or warn the user.

**Verified against source code:**

`apps/mobile/lib/screens/conversation_screen.dart` (lines 29-59):
```dart
class _ConversationScreenState extends State<ConversationScreen>
    with WidgetsBindingObserver {
  // ...
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _liveKitService.tryReconnect();
    }
  }
}
```

The app only handles `resumed` (returning to foreground) — calls `tryReconnect()`. It does **not** handle `paused`/`inactive` (going to background). No foreground service is started, no warning is shown.

`apps/mobile/android/app/src/main/kotlin/com/fletcher/fletcher/MainActivity.kt`:
```kotlin
class MainActivity : FlutterActivity()
```

Minimal — no custom lifecycle handling, no service management.

`apps/mobile/pubspec.yaml`: No foreground service plugins (`flutter_foreground_task`, `flutter_local_notifications`, etc.).

**Conclusion:** Confirmed. Zero foreground service infrastructure exists.

### Final Root Cause

**Root cause:** Fletcher lacks an Android foreground service with `FOREGROUND_SERVICE_MICROPHONE` type. When the app goes to background, Android 14+ enforces "while-in-use" restrictions on `RECORD_AUDIO` and silences the microphone within 5 seconds. This causes WebRTC connection degradation, exhausts SDK reconnection attempts, and results in full session disconnect.

**What's needed:**
1. `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE` permissions in manifest
2. A `<service>` declaration with `foregroundServiceType="microphone"`
3. A Kotlin service class (or Flutter plugin) that starts with a persistent notification
4. Lifecycle integration: start service on voice session start, stop on disconnect

## Proposed Fix

### Approach: `flutter_foreground_task` plugin

Using the `flutter_foreground_task` plugin (most mature Flutter foreground service library) rather than raw Kotlin, for maintainability.

### Step 1: Add dependency

**File:** `apps/mobile/pubspec.yaml`

```yaml
dependencies:
  # ... existing deps
  flutter_foreground_task: ^8.11.0
```

### Step 2: Add permissions and service to AndroidManifest

**File:** `apps/mobile/android/app/src/main/AndroidManifest.xml`

Add after existing permissions (after line 7):
```xml
<!-- Foreground service for background microphone access (BUG-022) -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<!-- Required by flutter_foreground_task for persistent notification -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Add service inside `<application>` (after line 34):
```xml
<!-- Foreground service to maintain microphone access in background (BUG-022) -->
<service
    android:name="com.pravera.flutter_foreground_task.service.ForegroundService"
    android:foregroundServiceType="microphone"
    android:exported="false" />
```

### Step 3: Initialize foreground task in LiveKitService

**File:** `apps/mobile/lib/services/livekit_service.dart`

Add initialization and lifecycle methods:

```dart
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

// In LiveKitService class, add:

/// Start foreground service to maintain microphone access in background.
/// Must be called while the app is in foreground (Android 14+ restriction).
Future<void> _startForegroundService() async {
  FlutterForegroundTask.init(
    androidNotificationOptions: AndroidNotificationOptions(
      channelId: 'fletcher_voice',
      channelName: 'Voice Session',
      channelDescription: 'Keeps microphone active during voice conversations',
      channelImportance: NotificationChannelImportance.LOW,
      priority: NotificationPriority.LOW,
    ),
    iosNotificationOptions: const IOSNotificationOptions(
      showNotification: false,
    ),
    foregroundTaskOptions: const ForegroundTaskOptions(
      autoRunOnBoot: false,
      allowWifiLock: true,
    ),
  );
  await FlutterForegroundTask.startService(
    notificationTitle: 'Fletcher',
    notificationText: 'Voice session active',
  );
}

Future<void> _stopForegroundService() async {
  await FlutterForegroundTask.stopService();
}
```

### Step 4: Wire into connect/disconnect lifecycle

**File:** `apps/mobile/lib/services/livekit_service.dart`

In `connect()` method, after successful room connection (after line 161):
```dart
// Start foreground service to prevent Android from silencing
// the microphone when the app goes to background (BUG-022)
await _startForegroundService();
```

In `disconnect()` method (after line 785):
```dart
Future<void> disconnect({bool preserveTranscripts = false}) async {
  debugPrint('[Fletcher] Disconnecting (preserveTranscripts=$preserveTranscripts)');
  await _stopForegroundService();
  // ... rest of existing disconnect code
```

### Step 5: Request notification permission (Android 13+)

**File:** `apps/mobile/lib/services/livekit_service.dart`

In `requestPermissions()` (after line 70):
```dart
Future<bool> requestPermissions() async {
  final status = await Permission.microphone.request();
  final btStatus = await Permission.bluetoothConnect.request();
  // Android 13+ requires POST_NOTIFICATIONS for foreground service notification
  final notifStatus = await Permission.notification.request();
  debugPrint('[Fletcher] Permissions: mic=${status.name} bt=${btStatus.name} notif=${notifStatus.name}');
  return status.isGranted;
}
```

## Edge Cases

1. **Service started from background:** Android 14+ prohibits starting microphone foreground services from background. Our fix starts the service in `connect()` which runs from a visible activity — safe. If the app is killed and relaunched from background, `connect()` runs from `initState()` which is also foreground.

2. **Notification permission denied (Android 13+):** If the user denies notification permission, the foreground service notification won't show but the service may still run (behavior varies by OEM). The mic access is the critical part — we should proceed even if notification permission is denied.

3. **Service already running:** `FlutterForegroundTask.startService()` is idempotent — calling it when already running updates the notification but doesn't create a duplicate.

4. **App killed by OS:** If Android kills the app process, the foreground service is also killed. On relaunch, `connect()` will restart it. No orphaned services.

5. **Multiple disconnect/connect cycles:** `_stopForegroundService()` in `disconnect()` stops the service. `_startForegroundService()` in `connect()` restarts it. The notification briefly disappears and reappears — acceptable.

6. **iOS:** The `IOSNotificationOptions(showNotification: false)` disables the notification on iOS. iOS handles background audio differently (via audio session categories, which LiveKit already handles).

7. **Interaction with reconnect logic:** During `_reconnectRoom()`, `disconnect(preserveTranscripts: true)` is called which stops the foreground service, then `connect()` restarts it. Brief gap (~1-2s) during which the mic could be silenced, but this only happens during active reconnection when the connection is already broken.

## Acceptance Criteria

- [x] App shows "Fletcher — Voice session active" notification while connected
- [ ] Microphone continues working when app goes to background (screen lock, home button)
- [ ] Session survives putting phone in pocket for 60+ seconds
- [x] Notification disappears when session disconnects
- [x] No notification when app is not in a voice session
- [x] Mic permission still requested and required before connecting
- [x] Notification permission requested on Android 13+ (graceful fallback if denied)
- [ ] Field test: walk with phone in pocket for 5+ minutes, verify voice session stays active

## Files

- `apps/mobile/pubspec.yaml` — add `flutter_foreground_task` dependency
- `apps/mobile/android/app/src/main/AndroidManifest.xml` — add permissions + service declaration
- `apps/mobile/lib/services/livekit_service.dart` — start/stop foreground service on connect/disconnect

## Status
- **Date:** 2026-03-03
- **Priority:** High (critical for real-world usage — walking with phone in pocket)
- **Status:** Code complete — awaiting field test verification
