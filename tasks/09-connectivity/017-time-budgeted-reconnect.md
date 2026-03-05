# Task: Extend reconnection window to match departure_timeout budget

## Problem

During mobile driving sessions, cell tower handoffs tear down the Tailscale WireGuard tunnel. The current reconnection strategy (SDK auto-reconnect ~40s + 5 app-level retries ~31s = ~71s total) exhausts before the tunnel recovers (40-80s), leaving a 49s gap where the server is still waiting but the client has stopped trying. This causes repeated short-lived sessions: 7 disconnects in 90 minutes, only 2 successful reconnects (BUG-028).

## Investigation

### Theory 1: Reconnect budget is too small for Tailscale tunnel recovery

**Evidence from LiveKit server logs (20260304-livekit-1446-1616.txt):**

All 5 failed disconnects show the same pattern:
- `participant closing` → reason: `PEER_CONNECTION_DISCONNECTED`, `isExpectedToResume: false`
- 120s later → `closing idle room` → reason: `departure timeout`

The 2 successful reconnects in Session 3:
- First (15:00:53 → 15:01:17 = **24s**): Tunnel recovered within SDK's auto-reconnect window
- Second (15:08:41 → 15:08:43 = **instant**): Server reports `DUPLICATE_IDENTITY` — the SDK re-joined with the same identity, evicting the old connection. Near-instant tunnel recovery.

**Conclusion: CONFIRMED.** Quick tunnel recovery → SDK reconnect succeeds. Slow tunnel recovery → all retries exhaust → session dies.

### Theory 2: `connectivity_plus` doesn't detect Tailscale tunnel state

During a cell tower handoff, the phone transitions between towers. `connectivity_plus` checks for `ConnectivityResult.none` (`connectivity_service.dart:65`):

```dart
final online = !results.every((r) => r == ConnectivityResult.none);
```

During handoffs, the phone's cellular radio stays "connected" (just switching towers), so `ConnectivityResult.mobile` persists. The `_waitForNetworkRestore()` offline-aware path (`livekit_service.dart:797-810`) is never triggered because the client reports as "online" the entire time.

**Conclusion: CONFIRMED.** The offline-aware retry path is designed for airplane mode / no-signal scenarios, not for "online but tunnel is down" scenarios.

### Theory 3: Post-exhaustion dead zone with no recovery mechanism

After 5 app-level retries exhaust (`livekit_service.dart:816-824`):
1. Status set to `ConversationStatus.error`
2. `_reconnecting = false`, `_reconnectAttempt = 0`
3. `_connectivitySub` was cancelled in the last `disconnect()` call at line 881
4. `_networkRestoreSub` was never set (because `isOnline` was true)

**The client has no active listener for connectivity changes.** The only way to recover is:
- User brings app to foreground → `didChangeAppLifecycleState(resumed)` → `tryReconnect()` (`conversation_screen.dart:57`)
- No automatic recovery exists

**Conclusion: CONFIRMED.** After retries exhaust, the client is a dead endpoint with no auto-recovery.

### Key Insight: Timeline gap analysis

```
0s          40s        71s                    120s
|-----------|----------|----------------------|
|  SDK auto |  5 app   |  DEAD ZONE           |  Server
|  reconnect|  retries |  Client gave up       |  departure_timeout
|           |          |  Server still waiting  |  expires
|<-- tunnel may recover anywhere in here -->  |
```

The current strategy covers 0-71s. The server allows 120s. The tunnel typically recovers in 40-80s. The overlap between the retry window and the tunnel recovery window is only 71-40 = 31s in the best case, and 71-80 = -9s (no overlap) in the worst case.

## Proposed Fix

Replace the fixed 5-attempt retry budget with a time-budgeted strategy that continues trying for the full departure_timeout duration.

### Change 1: Add slow-poll phase after fast retries exhaust

**File:** `apps/mobile/lib/services/livekit_service.dart`

Replace the "give up" logic at line 816-824 with a transition to slow-poll mode:

```dart
// Before:
static const _maxReconnectAttempts = 5;

// After:
static const _fastRetryAttempts = 5;
static const _slowPollInterval = Duration(seconds: 10);
static const _reconnectBudget = Duration(seconds: 130); // departure_timeout + margin
```

```dart
// Before (line 812-824):
Future<void> _doReconnectAttempt() async {
    _reconnectAttempt++;
    if (_reconnectAttempt > _maxReconnectAttempts) {
      debugPrint('[Fletcher] Reconnect exhausted after $_maxReconnectAttempts attempts — giving up');
      _reconnecting = false;
      _reconnectAttempt = 0;
      _updateState(
        status: ConversationStatus.error,
        errorMessage: 'Failed to reconnect after $_maxReconnectAttempts attempts',
      );
      return;
    }
    // ... backoff and connect ...
}

// After:
DateTime? _disconnectTime;

Future<void> _doReconnectAttempt() async {
    _reconnectAttempt++;

    // Check time budget before giving up
    final elapsed = DateTime.now().difference(_disconnectTime!);
    if (elapsed > _reconnectBudget) {
      debugPrint('[Fletcher] Reconnect budget exhausted (${elapsed.inSeconds}s) — giving up');
      _reconnecting = false;
      _reconnectAttempt = 0;
      _disconnectTime = null;
      _updateState(
        status: ConversationStatus.error,
        errorMessage: 'Failed to reconnect — server session expired',
      );
      return;
    }

    // Phase 1: fast retries with exponential backoff
    if (_reconnectAttempt <= _fastRetryAttempts) {
      debugPrint('[Fletcher] Fast reconnect attempt $_reconnectAttempt/$_fastRetryAttempts');
      _updateState(status: ConversationStatus.reconnecting);
      final delay = Duration(seconds: 1 << (_reconnectAttempt - 1));
      await Future.delayed(delay);
    } else {
      // Phase 2: slow poll every 10s
      final slowAttempt = _reconnectAttempt - _fastRetryAttempts;
      debugPrint('[Fletcher] Slow reconnect poll #$slowAttempt (${elapsed.inSeconds}s/${_reconnectBudget.inSeconds}s)');
      _updateState(
        status: ConversationStatus.reconnecting,
        errorMessage: 'Reconnecting (${elapsed.inSeconds}s)...',
      );
      await Future.delayed(_slowPollInterval);
    }

    // Bail out if we went offline during the wait
    if (!connectivityService.isOnline) {
      debugPrint('[Fletcher] Went offline during backoff — waiting for network');
      _waitForNetworkRestore();
      return;
    }

    // Clean up old room/listeners but keep credentials
    await disconnect(preserveTranscripts: true);

    // Attempt fresh connect (re-resolves URL for network changes)
    await connect(url: _url!, token: _token!, tailscaleUrl: _tailscaleUrl);

    // If connect failed, try again
    if (_state.status == ConversationStatus.error) {
      _reconnecting = false;
      _reconnectRoom();
    }
}
```

### Change 2: Record disconnect time when entering reconnection

**File:** `apps/mobile/lib/services/livekit_service.dart`

In `_reconnectRoom()`, record the time when reconnection starts:

```dart
// Before (line 769-793):
Future<void> _reconnectRoom() async {
    if (_reconnecting) return;
    // ...
    _reconnecting = true;
    // ...

// After:
Future<void> _reconnectRoom() async {
    if (_reconnecting) return;
    // ...
    _reconnecting = true;
    _disconnectTime ??= DateTime.now(); // Record first disconnect time, don't overwrite on re-entry
    // ...
```

### Change 3: Reset disconnect time on successful connection

**File:** `apps/mobile/lib/services/livekit_service.dart`

In the success paths (RoomReconnectedEvent handler and connect success), clear the timestamp:

```dart
// In RoomReconnectedEvent handler (line 205-237):
_listener?.on<RoomReconnectedEvent>((_) async {
    debugPrint('[Fletcher] SDK reconnected successfully');
    _reconnectAttempt = 0;
    _reconnecting = false;
    _disconnectTime = null;  // ADD THIS
    // ...

// In connect() success path (line 148-152):
_reconnectAttempt = 0;
_reconnecting = false;
_disconnectTime = null;  // ADD THIS
```

### Change 4: Reset disconnect time in tryReconnect

**File:** `apps/mobile/lib/services/livekit_service.dart`

When an external trigger (app resume) starts a reconnect, it should start a fresh budget:

```dart
// In tryReconnect() (line 854-867):
Future<void> tryReconnect() async {
    // ...
    _reconnectAttempt = 0;
    _reconnecting = false;
    _disconnectTime = null;  // ADD THIS — fresh budget on manual trigger
    await _reconnectRoom();
}
```

## Edge Cases

1. **Token expiry:** If the LiveKit token expires during the 130s retry window, all connect attempts will fail with auth errors. This is acceptable — the token typically has a longer TTL than the retry budget. If it's an issue later, the connect error handler could detect auth failures and give up early.

2. **Server restarts during retry window:** If the LiveKit server restarts (Docker restart, etc.) during the retry window, the slow poll will naturally succeed once the server is back up. This is a bonus — the current strategy would give up too early.

3. **Multiple disconnect/reconnect cycles:** The `_disconnectTime ??=` pattern ensures the budget starts from the FIRST disconnect. If the client briefly reconnects and disconnects again, the budget is reset via the success path (`_disconnectTime = null`), so a new cycle gets a fresh 130s budget.

4. **User navigates away during reconnection:** The `disconnect()` method cancels all timers and subscriptions. If the user leaves the conversation screen, the reconnection loop is cleanly terminated.

5. **`connectivity_plus` false offline during handoff:** During cell tower handoffs, `connectivity_plus` might briefly report offline (ConnectivityResult changes). The existing `_waitForNetworkRestore()` path handles this — it pauses retries and resumes when online, preserving the time budget.

6. **Rapid fire disconnects during driving:** Multiple quick disconnects in succession won't stack up reconnect loops thanks to the `if (_reconnecting) return` guard in `_reconnectRoom()`.

## Acceptance Criteria

- [ ] After SDK auto-reconnect fails, app-level retries continue for ~130s total (not just 5 attempts)
- [ ] Fast phase: 5 attempts with exponential backoff (1s, 2s, 4s, 8s, 16s) — same as current behavior
- [ ] Slow phase: attempts every 10s until time budget expires
- [ ] Successful reconnection resets all state (attempt counter, disconnect time)
- [ ] `tryReconnect()` from app resume starts a fresh time budget
- [ ] UI shows elapsed time during slow poll phase ("Reconnecting (45s)...")
- [ ] Client still gives up after budget expires (doesn't retry forever)
- [ ] No regression in brief-blip reconnection (SDK auto-reconnect still handles <40s outages)

## Files

- `apps/mobile/lib/services/livekit_service.dart` — reconnection logic (Changes 1-4)

## Status

- **Date:** 2026-03-04
- **Priority:** HIGH
- **Bug:** BUG-028
- **Status:** Implemented (`livekit_service.dart`), needs field testing
