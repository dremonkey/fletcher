# TASK-074: Background Room Disconnect (BUG-034)

**Epic:** 22 — Dual-Mode Architecture
**Status:** [ ]
**Depends on:** none
**Blocks:** none
**Bug ref:** BUG-034
**Filed:** 2026-03-15

## Goal

When the Flutter app is backgrounded in **chat mode**, disconnect from the LiveKit room immediately instead of waiting 10 minutes. On resume, reconnect automatically. This eliminates unnecessary battery drain and relay reconnect noise observed during field testing (6+ hours of continuous relay churn from 1:42am to 8:16am while the app was idle). Voice mode keeps the existing 10-minute timeout.

## Context

**Current behavior:** `onAppBackgrounded()` starts a 10-minute countdown timer. When it fires, `disconnect()` is called. On resume, `onAppResumed()` cancels the timer. If the timer already fired, the user is disconnected and must reconnect manually.

**Problem:** In chat mode, the user can't interact while backgrounded. There's no reason to keep the room alive — the 10-minute timer just delays the inevitable and wastes battery/bandwidth in the meantime.

**Why not gate the relay?** We explored signaling foreground state via participant metadata and data channel messages so the relay could decide whether to stay connected. This was over-engineered (and had a critical deadlock bug in the `clientPausedRooms` set). If the user isn't using the app, just disconnect at the source.

**Relay teardown is automatic:** When the client disconnects, the relay receives a `participant_left` webhook, schedules a deferred teardown (120s grace), and cleans up. Zero relay changes needed.

**Reconnect window:** `connectWithDynamicRoom()` calls `SessionStorage.getRecentRoom(stalenessThreshold)`. If the user returns within the departure timeout (120s), the same room name is reused — the relay may still be alive in its grace period, giving a seamless rejoin. After 120s, a new room is created.

```
Background (chat mode)          Resume
─────────────────────           ──────
onAppBackgrounded()             onAppResumed()
  │                               │
  ├─ room == null? → return       ├─ _backgroundDisconnected?
  ├─ screenLocked? → return       │   ├─ yes → clear flag
  ├─ voiceModeActive?             │   │         connectWithDynamicRoom()
  │   ├─ yes → 10min timer        │   │           └─ getRecentRoom()
  │   └─ no (chat mode)           │   │               ├─ <120s → same room
  │       ├─ set flag              │   │               └─ >120s → new room
  │       └─ disconnect()          │   └─ no → cancel timers (existing)
  │           (preserveTranscripts)│
  └───────────────────────────────┘
```

## Implementation

### 1. Add background disconnect flag (`apps/mobile/lib/services/livekit_service.dart`)

Add near the existing background state vars (around line 63):

```dart
// Background disconnect for chat mode (TASK-074 / BUG-034)
bool _backgroundDisconnected = false;
```

Add a `@visibleForTesting` getter for test access:

```dart
@visibleForTesting
bool get backgroundDisconnectedForTest => _backgroundDisconnected;
```

### 2. Modify `onAppBackgrounded()` (`apps/mobile/lib/services/livekit_service.dart`, lines 1897-1925)

Add a chat-mode branch **before** the existing 10-minute timer logic:

```dart
void onAppBackgrounded({required bool isScreenLocked}) {
  if (_room == null) return;
  if (isScreenLocked) return;

  // Chat mode: disconnect immediately — no reason to keep room alive
  if (!_voiceModeActive) {
    debugPrint('[Fletcher] Chat mode backgrounded — disconnecting immediately');
    _backgroundDisconnected = true;
    disconnect(preserveTranscripts: true);
    return;
  }

  // Voice mode: existing 10-minute timeout (user may switch back quickly)
  debugPrint('[Fletcher] Voice mode backgrounded — starting ${_backgroundTimeout.inMinutes}min timeout');
  _backgroundMinutesRemaining = _backgroundTimeout.inMinutes;
  // ... (rest of existing timer logic unchanged)
}
```

Key decisions:
- `disconnect(preserveTranscripts: true)` — preserves `_allUrls`, `_tokenServerPort`, `_departureTimeoutS` for reconnect, and keeps transcript history visible in UI.
- Set `_backgroundDisconnected = true` **before** calling disconnect (synchronous flag, async disconnect).
- Voice mode keeps existing 10-minute timeout — user may briefly switch apps during a voice conversation.

### 3. Modify `onAppResumed()` (`apps/mobile/lib/services/livekit_service.dart`, lines 1929-1945)

Add background-disconnect handling at the top of the method:

```dart
void onAppResumed() {
  // Reconnect after chat-mode background disconnect (TASK-074)
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

  // Existing: cancel voice-mode background timeout
  if (_backgroundTimeoutTimer == null) return;
  // ... (rest of existing timer cancellation unchanged)
}
```

Key decisions:
- Uses cached `_allUrls`, `_tokenServerPort`, `_departureTimeoutS` — these survive `disconnect(preserveTranscripts: true)`.
- `connectWithDynamicRoom()` is fire-and-forget (returns Future but not awaited — matches existing async patterns in lifecycle callbacks).
- Returns early — no need to cancel timers (they were never started in the chat-mode path).

### 4. Write minimal unit test (`apps/mobile/test/services/background_disconnect_test.dart`)

Test the branching logic without mocking LiveKit. Focus on the flag lifecycle:

- `onAppBackgrounded(isScreenLocked: false)` with `_voiceModeActive == false` and `_room != null` → `_backgroundDisconnected` should be `true`
- `onAppBackgrounded(isScreenLocked: false)` with `_voiceModeActive == true` → `_backgroundDisconnected` should be `false` (timer path)
- `onAppBackgrounded(isScreenLocked: true)` → no action regardless of mode
- `onAppResumed()` with `_backgroundDisconnected == true` → flag cleared

Note: Testing the full disconnect/reconnect flow requires LiveKit mocks and is covered by field verification instead.

## Not in scope

- **Session resumption** (restoring conversation context after reconnect) — tracked in EPIC-25
- **Relay-side changes** — relay teardown is automatic via existing departure logic
- **iOS-specific background behavior** — iOS kills apps aggressively; existing behavior is fine
- **Foreground service lifecycle** — `disconnect()` already stops the foreground service; `connect()` restarts it

## Relates to

- `tasks/25-session-resumption/EPIC.md` — EPIC-25: restoring conversation state after disconnect
- `tasks/09-connectivity/_closed/019-background-session-timeout.md` — original 10-minute timeout implementation
- `docs/field-tests/20260315-buglog.md` — BUG-034 field observations

## Acceptance criteria

- [ ] In chat mode (`!_voiceModeActive`), backgrounding disconnects from room immediately
- [ ] In voice mode, backgrounding uses existing 10-minute timeout (no behavior change)
- [ ] Screen lock still skips all background disconnect logic (earbud usage)
- [ ] On resume after background disconnect, `connectWithDynamicRoom()` is called with cached params
- [ ] If resume within departure timeout (120s), same room name is reused via `SessionStorage.getRecentRoom()`
- [ ] Minimal unit test covers flag lifecycle (set on background, cleared on resume) and mode branching
- [ ] Field-verify: no relay reconnect loops when app backgrounded in chat mode
- [ ] Field-verify: room reconnect works on resume

<!--
Status key:
  [ ]  pending
  [~]  in progress
  [x]  done
  [!]  failed / blocked
-->
