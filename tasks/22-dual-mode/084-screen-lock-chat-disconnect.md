# TASK-084: Disconnect in chat mode regardless of screen lock state (BUG-042)

**Epic:** 22 — Dual-Mode Architecture
**Status:** [ ]
**Depends on:** none
**Blocks:** none
**Bug ref:** BUG-042
**Filed:** 2026-03-16

## Problem

When the user locks their phone screen overnight in chat mode, the app stays connected to the LiveKit room indefinitely. The foreground service keeps the process alive, and the relay's 30-minute idle timeout fires repeatedly — disconnecting and reconnecting the relay participant in an infinite cycle. This causes battery drain, log noise, and unnecessary session rebinds (~every 31 minutes observed in field).

The user reported this as "app still reconnecting every 30m in background/screen-off" despite the BUG-034 fix.

## Investigation

### Theory 1: BUG-034 fix incomplete — app reconnecting from cached credentials

The explore agent initially theorized that the LiveKit SDK's auto-reconnect was firing after network timeouts, using cached credentials that `disconnect(preserveTranscripts: true)` intentionally doesn't clear.

**Refuted by logs.** The `[Fletcher]` logs from 01:30–08:19 PDT show:

```
07:16:33  Remote participant disconnected: relay-amber-elm-arjk (remaining agents=0)
07:17:00  Remote participant connected: relay-amber-elm-arjk
07:17:00  Sending session/bind: agent:main:relay:amber-elm-20260315
07:17:02  Session bound

07:47:33  Remote participant disconnected: relay-amber-elm-arjk (remaining agents=0)
07:48:00  Remote participant connected: relay-amber-elm-arjk
07:48:00  Sending session/bind: agent:main:relay:amber-elm-20260315
07:48:03  Session bound

08:18:33  Remote participant disconnected: relay-amber-elm-arjk (remaining agents=0)
08:19:00  Remote participant connected: relay-amber-elm-arjk
08:19:00  Sending session/bind: agent:main:relay:amber-elm-20260315
08:19:03  Session bound
```

**Key observation:** There are zero `onAppBackgrounded`, `RoomDisconnectedEvent`, or `_reconnectRoom` entries during this window. The **app's room connection stayed alive the entire time.** Only the relay participant was cycling.

### Theory 2: `isScreenLocked` guard prevents chat-mode disconnect

When the user locks their screen, Android fires `AppLifecycleState.paused`. The lifecycle observer calls:

```dart
// conversation_screen.dart:59-62
case AppLifecycleState.paused:
  final locked = await ScreenStateService.isScreenLocked();
  _liveKitService.onAppBackgrounded(isScreenLocked: locked);
```

The Android native method (`MainActivity.kt:16-18`) uses `KeyguardManager.isKeyguardLocked`, which returns `true` when the screen is locked.

In `onAppBackgrounded()` (`livekit_service.dart:2260-2266`):

```dart
void onAppBackgrounded({required bool isScreenLocked}) {
  if (_room == null) return;
  if (isScreenLocked) {           // ← Guard fires BEFORE mode check
    debugPrint('[Fletcher] Screen locked — skipping background timeout');
    return;                        // ← Returns early for ALL modes
  }
  // Chat mode disconnect (line 2270) is never reached
```

**Confirmed.** The `isScreenLocked` guard is positioned before the `_voiceModeActive` check. When the screen is locked:
- Chat mode: **stays connected** (bug — can't chat with locked screen)
- Voice mode: **stays connected** (correct — earbuds use case)

### Theory 3: Relay idle timeout causes the 30-minute cycling

The relay's `RELAY_IDLE_TIMEOUT_MS=1800000` (30 min) fires every 60 seconds via `bridge-manager.ts:392-397`. When `checkIdleRooms()` finds a room with `lastActivity` older than 30 minutes, it calls `removeRoom()`, disconnecting the relay from the room (`bridge-manager.ts:418-431`).

LiveKit's agent dispatch then detects the human participant still in the room without an agent, redispatches the relay, and the relay rejoins ~27 seconds later. The session bind handshake completes, `lastActivity` is touched, and the 30-minute countdown resets.

**Confirmed by timing:** 07:16:33 → 07:47:33 → 08:18:33 = exactly 31 minutes each (30 min timeout + 1 min check interval).

### Root Cause (confirmed)

1. User locks phone screen in chat mode → `isScreenLocked: true` → early return, no disconnect
2. Foreground service keeps app process and WebRTC connection alive indefinitely
3. No messages flow between mobile and relay (app is idle)
4. Every 30 minutes, relay idle timeout fires → relay leaves → LiveKit redispatches → relay rejoins
5. Cycle repeats until user unlocks phone

The `isScreenLocked` guard was designed for voice mode (earbuds use case) but was placed before the mode check, incorrectly applying to chat mode too. In chat mode, there's no valid reason to keep the room alive when the screen is locked — the user can't interact.

## Proposed Fix

Move the `isScreenLocked` guard to only apply to voice mode. Chat mode always disconnects immediately.

**File:** `apps/mobile/lib/services/livekit_service.dart` (lines 2260-2276)

Before:
```dart
void onAppBackgrounded({required bool isScreenLocked}) {
  debugPrint('...');
  if (_room == null) return;
  if (isScreenLocked) {
    debugPrint('[Fletcher] Screen locked — skipping background timeout');
    return;
  }

  // Chat mode: disconnect immediately
  if (!_voiceModeActive) {
    debugPrint('[Fletcher] Chat mode backgrounded — disconnecting immediately');
    _backgroundDisconnected = true;
    disconnect(preserveTranscripts: true);
    return;
  }

  // Voice mode: 10-minute timeout
  ...
```

After:
```dart
void onAppBackgrounded({required bool isScreenLocked}) {
  debugPrint('...');
  if (_room == null) return;

  // Chat mode: always disconnect immediately — can't interact with a
  // backgrounded or locked screen. Keeps room alive = relay idle churn. (BUG-042)
  if (!_voiceModeActive) {
    debugPrint('[Fletcher] Chat mode backgrounded — disconnecting immediately');
    _backgroundDisconnected = true;
    disconnect(preserveTranscripts: true);
    return;
  }

  // Voice mode: screen lock means earbuds in use — stay connected
  if (isScreenLocked) {
    debugPrint('[Fletcher] Voice mode screen locked — skipping background timeout');
    return;
  }

  // Voice mode: 10-minute timeout
  ...
```

**Why this works:** Swapping the order so the chat-mode check comes first means screen lock state only matters for voice mode. This preserves the earbuds use case (voice + screen locked = stay connected) while ensuring chat mode always disconnects.

## Edge Cases

1. **User in chat mode switches to voice mode, then locks screen immediately:** Not affected — by the time `onAppBackgrounded` fires, `_voiceModeActive` reflects the current state. If voice is active, the screen lock guard applies correctly.

2. **User in voice mode with earbuds, screen locks:** Behavior unchanged — voice mode + `isScreenLocked` still skips disconnect.

3. **Rapid background/resume in chat mode with screen locked:** Same behavior as current chat-mode background without screen lock — `_backgroundDisconnected` is set, `disconnect(preserveTranscripts: true)` is called, and `onAppResumed()` reconnects. Works correctly per BUG-034 field verification.

4. **Screen lock check fails (returns false):** Falls through to voice mode 10-minute timeout — same as current behavior, not a regression.

## Test Changes

**File:** `apps/mobile/test/services/background_disconnect_test.dart`

Update the existing test "does nothing when screen is locked — chat mode" (lines 131-139):

Before: expects no disconnect when `isScreenLocked=true` in chat mode.
After: expects immediate disconnect when `isScreenLocked=true` in chat mode (same as `isScreenLocked=false`).

Add a new test: "chat mode disconnects immediately even with screen locked" — set `_voiceModeActive = false`, `_room != null`, call `onAppBackgrounded(isScreenLocked: true)`, verify `_backgroundDisconnected == true` and `disconnectCalled == true`.

## Acceptance Criteria

- [ ] Chat mode + screen locked → disconnects immediately (no early return)
- [ ] Chat mode + screen unlocked → disconnects immediately (unchanged)
- [ ] Voice mode + screen locked → stays connected (unchanged)
- [ ] Voice mode + screen unlocked → 10-minute timeout (unchanged)
- [ ] Unit test updated for new screen lock behavior in chat mode
- [ ] Field-verify: no relay cycling when phone locked overnight in chat mode

## Files

- `apps/mobile/lib/services/livekit_service.dart` — reorder guards in `onAppBackgrounded()`
- `apps/mobile/test/services/background_disconnect_test.dart` — update screen lock test

## Relates to

- `tasks/22-dual-mode/074-background-room-disconnect.md` — TASK-074: original background disconnect implementation
- `docs/field-tests/20260316-buglog.md` — BUG-042 field observation
- `docs/field-tests/20260315-buglog.md` — BUG-034 original relay churn observation

## Status

Filed 2026-03-16. Priority: HIGH. Ready to implement.

<!--
Status key:
  [ ]  pending
  [~]  in progress
  [x]  done
  [!]  failed / blocked
-->
