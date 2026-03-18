# TASK-096: Fix cold start connection failure and dead tap-to-retry

**Status:** [x] Complete
**Priority:** HIGH
**Bug refs:** BUG-049
**Filed:** 2026-03-17
**Buglog:** [`docs/field-tests/20260317-buglog.md`](../../docs/field-tests/20260317-buglog.md)

## Problem

On cold start, the app immediately shows "Connection failed" and the tap-to-retry
button does nothing. The user has to force-quit and relaunch to connect. Observed
on 2026-03-17 field test (07:48 PDT).

## Investigation

### Theory 1: Network stack not ready on cold start

**Hypothesis:** Android's network stack (routes, DNS) isn't fully functional when
the Dart VM boots, so TCP connections fail even though the WiFi interface is
registered.

**Evidence from raw logs (`docs/field-tests/20260317-raw-logcat.txt`):**

First launch (PID 26840) — **FAILED**:
```
07:48:00.315  Impeller rendering backend (cold start)
07:48:01.438  [UrlResolver] Racing 3 URLs: ws://192.168.87.59:7880, ws://100.87.219.109:7880, ws://10.0.2.2:7880
07:48:01.630  [Connectivity] Interface switch: [] → [ConnectivityResult.wifi, ConnectivityResult.vpn]
07:48:04.454  [UrlResolver] All URLs unreachable — defaulting to: ws://192.168.87.59:7880
07:48:04.482  [TokenService] Racing 3 hosts for token
07:48:09.507  Dynamic room connection failed: All token hosts failed (all 3 SocketException: timed out)
```

Second launch (PID 27969 — 36 seconds later) — **SUCCEEDED**:
```
07:48:37.857  [UrlResolver] Racing 3 URLs
07:48:38.010  [UrlResolver] Winner: ws://192.168.87.59:7880  ← 153ms
07:48:38.241  [TokenService] Token acquired from 192.168.87.59
07:48:38.942  [Fletcher] Connected to room
```

**Confirmed.** The URL resolver started at 07:48:01.438 — only 1.1 seconds after
the Dart VM started. `ConnectivityService` detected wifi+vpn 192ms later
(07:48:01.630), but by then the TCP race was already running. All three TCP
connections timed out after 3 seconds (07:48:04.454), then all three token HTTP
requests timed out after 5 seconds (07:48:09.507). The network interface was
registered but TCP routes were not yet functional.

36 seconds later, the same TCP race completed in 153ms. The network was ready but
the app had already given up.

### Theory 2: Tap-to-retry silently fails

**Hypothesis:** After a cold start failure, `tryReconnect()` can't recover because
credentials were never cached.

**Code trace:**

`connectWithDynamicRoom()` (line 209) resolves URLs → fetches token → calls
`connect()`. When the failure happens during URL/token resolution (before
`connect()` is reached), `_url` and `_token` are never set:

```dart
// livekit_service.dart:388-394
Future<void> connect({required String url, required String token}) async {
    _url = url;    // ← only set here
    _token = token; // ← only set here
```

The tap-to-retry calls `tryReconnect()` → `_reconnectRoom()`:

```dart
// livekit_service.dart:2192-2199
Future<void> _reconnectRoom() async {
    if (_reconnecting) return;
    if (_url == null || _token == null) {  // ← DEAD END
      _updateState(
        status: ConversationStatus.error,
        errorMessage: 'Disconnected from room',
      );
      return;  // silently gives up — no debugPrint
    }
```

**Confirmed.** After a cold start failure, `_url` and `_token` are both `null`.
Every tap-to-retry goes: `tryReconnect()` → `_reconnectRoom()` → null check →
return with generic error. No retry is ever attempted. No log output is produced.

This is corroborated by the raw logs showing a 24-second gap between the failure
(07:48:09) and the user force-quitting (07:48:33) with zero Fletcher log output
in between — the user tapped retry, but the code returned silently.

### Theory 3: ConnectivityService might block retry

**Hypothesis:** `tryReconnect()` also checks `connectivityService.isOnline` and
would return silently if offline.

```dart
// livekit_service.dart:2318-2320
if (!connectivityService.isOnline) {
    debugPrint('[Fletcher] tryReconnect skipped — offline');
    return;
}
```

**Partially refuted.** The logs show `[Connectivity] Interface switch: [] → [wifi, vpn]`
at 07:48:01.630, which means `_isOnline` was set to `true` (via the interface
switch synthetic pulse in `_update()`). So this guard likely passed. However, there
is still a secondary risk: `ConnectivityService._init()` is async fire-and-forget
from the constructor, so `isOnline` could briefly be stale on very fast retry taps.

### Theory 4: ConnectivityService race at init

**Hypothesis:** `_init()` is fire-and-forget, so the initial `isOnline` defaults to
`true` and the first connectivity check may not complete before code reads it.

```dart
// connectivity_service.dart:49-61
ConnectivityService({ConnectivityProvider? provider})
    : _provider = provider ?? RealConnectivityProvider() {
  _init();  // fire-and-forget async
}

Future<void> _init() async {
  final results = await _provider.checkConnectivity();
  _update(results);
  _subscription = _provider.onConnectivityChanged.listen(_update);
}
```

**Confirmed as contributing factor.** `_isOnline` defaults to `true` (line 34) and
`_currentResults` defaults to `[]`. The `_init()` future is never awaited. In the
logs, the connectivity result arrived 192ms after `connectWithDynamicRoom()` started
running. There is also a small window between `_update(results)` and the stream
subscription where a change event could be missed.

## Root Cause

Two compounding issues:

1. **Network not ready on cold start.** `connectWithDynamicRoom()` begins TCP-racing
   URLs ~1 second after the Dart VM starts, before Android's network stack has
   functional routes. All connections time out. There is no network readiness check
   and no retry mechanism on initial connection failure.

2. **`tryReconnect()` is dead after cold start failure.** The reconnect path requires
   cached `_url` and `_token` (set only in `connect()`), but `connect()` was never
   reached. `_reconnectRoom()` sees null credentials and silently returns with a
   generic error, leaving the user permanently stranded.

## Proposed Fix

### Fix 1: `tryReconnect()` falls back to fresh connect when no credentials cached

```dart
// livekit_service.dart — tryReconnect()
Future<void> tryReconnect() async {
    if (_state.status != ConversationStatus.error &&
        _state.status != ConversationStatus.reconnecting) {
      return;
    }
    if (!connectivityService.isOnline) {
      debugPrint('[Fletcher] tryReconnect skipped — offline');
      return;
    }

    // BUG-049: If we never successfully connected (cold start failure),
    // _url/_token are null. Fall back to a full connection attempt using
    // the stored URLs from the initial connectWithDynamicRoom() call.
    if (_url == null || _token == null) {
      if (_allUrls.isNotEmpty) {
        debugPrint('[Fletcher] tryReconnect — no cached credentials, retrying full connect (BUG-049)');
        await connectWithDynamicRoom(
          urls: _allUrls,
          tokenServerPort: _tokenServerPort,
          departureTimeoutS: _departureTimeoutS,
        );
        return;
      }
      debugPrint('[Fletcher] tryReconnect — no URLs configured, cannot retry');
      return;
    }

    _reconnectScheduler.reset();
    _reconnecting = false;
    await _reconnectRoom();
}
```

**Why:** This makes tap-to-retry work after any failure, not just post-connection
disconnects. The stored `_allUrls`, `_tokenServerPort`, and `_departureTimeoutS`
are always populated by the first `connectWithDynamicRoom()` call (line 214-217),
even when the connection itself fails.

### Fix 2: `ConnectivityService` exposes a readiness future

```dart
// connectivity_service.dart
class ConnectivityService extends ChangeNotifier {
  final Completer<void> _ready = Completer<void>();

  /// Completes when the initial connectivity check has finished.
  Future<void> get ready => _ready.future;

  Future<void> _init() async {
    try {
      final results = await _provider.checkConnectivity();
      _update(results);
      _subscription = _provider.onConnectivityChanged.listen(_update);
    } finally {
      if (!_ready.isCompleted) _ready.complete();
    }
  }
```

### Fix 3: `connectWithDynamicRoom()` waits for network readiness

```dart
// livekit_service.dart — connectWithDynamicRoom(), before URL resolution
// Wait for ConnectivityService to finish its initial platform check (BUG-049).
// On cold start, connectivity_plus may need 100-200ms to query the OS.
await connectivityService.ready.timeout(
  const Duration(seconds: 2),
  onTimeout: () {},  // proceed anyway if it takes too long
);

// If the device is offline, wait briefly for network to come up.
// On cold start, WiFi may take 1-3 seconds to become routable.
if (!connectivityService.isOnline) {
  debugPrint('[Fletcher] Waiting for network before connecting...');
  _updateState(
    status: ConversationStatus.connecting,
    errorMessage: 'Waiting for network...',
  );
  try {
    await connectivityService.onConnectivityChanged
        .firstWhere((online) => online)
        .timeout(const Duration(seconds: 5));
  } on TimeoutException {
    debugPrint('[Fletcher] Network wait timed out — proceeding anyway');
  }
}
```

**Why:** This closes the race between `_init()` completing and `connectWithDynamicRoom()`
using `isOnline`. It also adds a brief wait-for-network that would have given the
first launch enough time — the network was functional within 2 seconds of app start
based on the second launch's 153ms TCP connect.

### Fix 4: Add debug logging to `_reconnectRoom()` null guard

```dart
// livekit_service.dart:2194-2199
if (_url == null || _token == null) {
  debugPrint('[Fletcher] _reconnectRoom — no cached credentials (url=${_url != null} token=${_token != null})');
  _updateState(
    status: ConversationStatus.error,
    errorMessage: 'Disconnected from room',
  );
  return;
}
```

**Why:** Silent failures are debugging nightmares. This would have made BUG-049
immediately diagnosable from the logs.

## Edge Cases

- **Double-tap:** `connectWithDynamicRoom()` sets status to `connecting`, which
  makes `tryReconnect()` return early on its first guard. Safe.
- **Offline tap-to-retry:** The `!connectivityService.isOnline` guard in
  `tryReconnect()` still prevents retry when truly offline. If `ConnectivityService`
  is stale (rare), the worst case is a failed connection attempt, not a crash.
- **`_allUrls` empty:** If `connectWithDynamicRoom()` was never called (shouldn't
  happen in normal flow), `_allUrls` is empty and the fallback prints a message.
- **`onAppResumed` interaction:** `conversation_screen.dart:64-66` calls both
  `onAppResumed()` and `tryReconnect()`. If `onAppResumed()` triggers
  `connectWithDynamicRoom()` (background disconnect recovery), the status will be
  `connecting` by the time `tryReconnect()` runs, so the first guard blocks it. Safe.
- **Network readiness wait vs already-online:** When the network is already up
  (most startups), the `ready` future completes instantly and `isOnline` is true,
  so the wait-for-network block is skipped entirely. Zero latency impact.

## Acceptance Criteria

- [x] Cold start with delayed network: app waits briefly and connects successfully
- [x] Cold start with failed connection: tap-to-retry triggers a fresh `connectWithDynamicRoom()`
- [x] Existing reconnect behavior unchanged: post-disconnect retry uses `_reconnectRoom()` as before
- [x] `_reconnectRoom()` null-credential path produces debug log output
- [x] `ConnectivityService.ready` completes after initial `checkConnectivity()`
- [x] No regression: app still connects in <2s when network is ready on start
- [x] `connectWithDynamicRoom()` retries up to 3 times with backoff (2s, 3s) on cold start
- [x] Tests added for retry utility (9 tests) and ConnectivityService.ready (4 tests)

## Files

- `apps/mobile/lib/services/livekit_service.dart` — Fix 1 (tryReconnect fallback), Fix 3 (network wait), Fix 4 (logging), Fix 5 (retry with backoff)
- `apps/mobile/lib/services/connectivity_service.dart` — Fix 2 (readiness future)
- `apps/mobile/lib/utils/retry_with_backoff.dart` — Reusable retry utility
- `apps/mobile/test/utils/retry_with_backoff_test.dart` — Tests for retry utility (9 tests)
- `apps/mobile/test/services/connectivity_service_test.dart` — Tests for ready future (4 tests)

## Status
- **Date:** 2026-03-17
- **Priority:** HIGH
- **Bug:** BUG-049
- **Status:** COMPLETE — all 5 fixes implemented, tests added
