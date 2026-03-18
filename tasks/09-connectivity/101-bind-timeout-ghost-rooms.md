# Task 101: Fix Bind Timeout on Ghost Rooms + session_load_error Race

## Problem

Two related issues from the 2026-03-17 field test:

1. **Bind timeouts on ghost rooms (2 occurrences):** The relay joins abandoned rooms and waits 30s for a `session/bind` that never arrives because the mobile has already moved on.
2. **`session_load_error: "ACP subprocess not running"` (9 occurrences):** Race condition where `session/load` is sent before the ACP subprocess is ready.

## Root Cause Analysis

### Issue 1: Ghost room bind timeouts

During network instability, the mobile's reconnect loop creates multiple rooms in rapid succession. Each room lives for seconds before the mobile disconnects and tries again. Due to `departure_timeout=120s`, these abandoned rooms persist in LiveKit. The relay's discovery timer (30s interval) finds them, joins, and starts a 30s bind timeout — but the mobile has already moved on.

**Log evidence:**
```
09:29:41  room_added_pending_bind   amber-elm-6v1d     [discovery adds room]
09:30:11  bind_timeout              amber-elm-jh4c     [30s — mobile already gone]
09:30:12  room_added_pending_bind   amber-elm-jh4c     [discovery re-adds after cleanup]
09:30:42  bind_timeout              amber-elm-jh4c     [30s — still gone]
09:31:12  room_added_pending_bind   amber-elm-jh4c     [discovery re-adds again]
09:31:21  acp_spawn                 amber-elm-jh4c     [mobile finally reconnected, bind received]
```

The re-adds at 09:30:12 and 09:31:12 are discovery cycles. The mobile was bouncing between rooms during recovery. The relay wasted 2 minutes joining and timing out on ghost rooms before the mobile stabilized.

**Root mechanism:** Discovery checks `hasHumans() && !hasRelay()` but does not check whether the human participant is actively connected vs. just within the departure_timeout window. A participant that disconnected 90s ago still counts as "human in room."

**Note:** Task 100 (deferred teardown) will significantly reduce this problem. If the relay stays in the room during network switches instead of tearing down, there will be far fewer ghost rooms. This task handles the residual cases.

### Issue 2: session_load_error race

After a successful bind, the mobile immediately sends `session/load` to replay history. The error path:

1. ACP subprocess dies between `bridge.start()` completing and `session/load` arriving
2. OR: ACP subprocess is mid-reinit when `session/load` arrives
3. `ensureAcp()` tries re-init but fails (subprocess broken)
4. `session/load` handler catches error, logs `session_load_error`

The `ensureAcp()` guard is insufficient because:
- The `exited` promise handler sets `proc = null` and `needsReinit = true` asynchronously
- There's a window where `send()` writes to a dead process's stdin before the exit handler fires
- `ensureAcp()` re-init can itself fail if the subprocess is fundamentally broken
- No retry logic in the `session/load` handler — it fails once and gives up

All 9 errors are from the mobile client path (`relay-bridge.ts:669`), not the session poller (which logs `poll_error` instead).

## Proposed Fix

### Change 1: Stop re-adding rooms after consecutive bind timeouts

**File:** `apps/relay/src/bridge/bridge-manager.ts`

Track bind-timeout count per room. After 2 consecutive timeouts, mark the room as "bind-failed" and exclude it from discovery re-adds:

```typescript
private bindFailedRooms = new Map<string, number>(); // roomName → timeout count

onBindTimeout(roomName: string) {
  const count = (this.bindFailedRooms.get(roomName) ?? 0) + 1;
  this.bindFailedRooms.set(roomName, count);
  if (count >= 2) {
    log.info({ roomName, count, event: "bind_failed_blacklist" },
      "Room blacklisted after repeated bind timeouts");
  }
  // existing cleanup...
}

// In discovery: skip blacklisted rooms
shouldAddRoom(roomName: string): boolean {
  return !this.bindFailedRooms.has(roomName) ||
         (this.bindFailedRooms.get(roomName)! < 2);
}
```

Clear the blacklist entry when `participant_joined` fires (mobile is back):

```typescript
onParticipantJoined(roomName: string) {
  this.bindFailedRooms.delete(roomName);
  // ... existing addRoom logic
}
```

### Change 2: Retry session/load with backoff

**File:** `apps/relay/src/bridge/relay-bridge.ts`

In the `session/load` handler, retry up to 3 times with backoff on "ACP subprocess not running":

```typescript
} else if (msg.method === "session/load") {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await this.ensureAcp();
      const result = await this.acpClient.sessionLoad({ ... });
      // success — send response and return
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await Bun.sleep(1000 * (attempt + 1)); // 1s, 2s
    }
  }
  reqLog.error({ event: "session_load_error", error: lastErr?.message });
}
```

### Change 3: (Optional) Mobile-side session/load retry

**File:** `apps/mobile/lib/services/livekit_service.dart`

If `_loadSessionHistory()` receives an error response, retry once after 3s:

```dart
Future<void> _loadSessionHistory() async {
  try {
    await _sendSessionLoad();
  } catch (e) {
    log('[Fletcher] session/load failed, retrying in 3s...');
    await Future.delayed(const Duration(seconds: 3));
    await _sendSessionLoad(); // single retry
  }
}
```

## Acceptance Criteria

- [ ] Rooms with 2+ consecutive bind timeouts are excluded from discovery re-adds
- [ ] Blacklist is cleared when a `participant_joined` webhook arrives for that room
- [ ] `session/load` retries up to 3 times with backoff on ACP failure
- [ ] No regression on normal bind flow (first-time rooms still added promptly)

## Files

- `apps/relay/src/bridge/bridge-manager.ts` — discovery filter, bind timeout tracking
- `apps/relay/src/bridge/relay-bridge.ts` — `session/load` handler, retry logic
- `apps/relay/src/livekit/room-discovery.ts` — room eligibility check
- `apps/mobile/lib/services/livekit_service.dart` — (optional) client-side retry

## Status

- **Date:** 2026-03-17
- **Priority:** HIGH (bind timeouts), MEDIUM (session_load_error)
- **Bug:** BUG-053
- **Depends on:** Task 100 (deferred teardown reduces ghost rooms significantly)
- **Status:** RCA COMPLETE
