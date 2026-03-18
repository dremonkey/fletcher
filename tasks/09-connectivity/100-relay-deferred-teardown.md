# Task 100: Re-introduce Deferred Teardown on participant_left

## Problem

When a mobile device switches networks (WiFi ↔ cellular), the relay immediately destroys the bridge and ACP subprocess on the `participant_left` webhook — before the client has any chance to reconnect. This causes rooms to last only 18-67 seconds and forces the entire relay lifecycle (room join → bind → ACP spawn) to restart from scratch on every network glitch.

Despite prior fixes (task 007: departure_timeout=120s, task 094: ConnectivityService interface detection), network switching still produces ultra-short sessions because the relay teardown is the bottleneck, not the LiveKit room lifetime.

## Root Cause Analysis

### The cascade

1. WiFi drops (T+0s)
2. LiveKit detects signaling loss → removes participant after ~5-15s
3. LiveKit fires `participant_left` webhook to relay
4. **Relay immediately calls `bridgeManager.removeRoom()`** (`webhook.ts:63-89`)
5. Bridge stopped, ACP killed, relay leaves the room
6. Client SDK spends ~40s trying ICE restart (relay already gone)
7. Client falls back to app-level reconnect: `disconnect()` + `connect()`
8. Each `disconnect()` fires ANOTHER `participant_left` → relay tears down again
9. Each `connect()` fires `participant_joined` → relay joins, starts 30s bind timeout
10. Cycle repeats until network stabilizes

### Why the teardown is immediate

BUG-036 changed the webhook handler from deferred teardown to immediate teardown to fix stale state issues. The comment says: "Once Epic 25 (Session Restoration) is implemented, the relay will be able to restore the previous session state automatically."

### The deferred teardown infrastructure still exists

`bridge-manager.ts:222-240` still has `scheduleRemoveRoom()`, `cancelPendingTeardown()`, and `hasPendingTeardown()` — they're just not called from the webhook handler anymore.

### Evidence: ultra-short rooms from 2026-03-17 field test

```
09:54:37 → 09:54:55  amber-elm-8n2u   [18 seconds]
13:25:42 → 13:26:03  amber-elm-le7h   [21 seconds]
13:45:08 → 13:45:29  amber-elm-pua8   [21 seconds]
19:57:15 → 19:57:54  amber-elm-fbe3   [39 seconds]
20:31:51 → 20:32:58  amber-elm-wg8s   [67 seconds]
```

These are the second-generation rooms — rooms created after the initial disconnect, where the relay was already torn down and rebuilt. Each network glitch restarts the entire cycle.

### Contributing factor: app-level reconnect creates participant churn

Each iteration of `_doReconnectAttempt()` (`livekit_service.dart:2414-2428`) calls `disconnect()` then `connect()`, firing `participant_left` + `participant_joined` webhooks each time. This compounds the teardown problem — the relay churn (tear down + rebuild on every attempt) wastes time and creates windows where the relay is absent from the room.

## Proposed Fix

### Change 1: Deferred teardown in webhook handler (HIGH PRIORITY)

**File:** `apps/relay/src/http/webhook.ts`

Replace the immediate `removeRoom()` with a deferred teardown:

```typescript
if (event.event === "participant_left") {
  // Schedule deferred teardown instead of immediate removal.
  // If the participant rejoins within the grace period, cancel the teardown.
  bridgeManager.scheduleRemoveRoom(roomName, 60_000); // 60s grace
}
```

On `participant_joined`, cancel any pending teardown:

```typescript
if (event.event === "participant_joined") {
  bridgeManager.cancelPendingTeardown(roomName);
  // ... existing addRoom logic
}
```

The `scheduleRemoveRoom()` and `cancelPendingTeardown()` methods already exist in `bridge-manager.ts:222-240`.

### Change 2: Skip disconnect in app-level reconnect when already disconnected (MEDIUM PRIORITY)

**File:** `apps/mobile/lib/services/livekit_service.dart`

In `_doReconnectAttempt()`, skip the `disconnect()` call if the Room is already in a disconnected state — it fires a redundant `participant_left` webhook:

```dart
// Only disconnect if the room is still connected/reconnecting
if (_room?.connectionState != ConnectionState.disconnected) {
  await disconnect(preserveTranscripts: true);
}
```

### BUG-036 stale state concern

The original BUG-036 fix removed deferred teardown because stale bridges caused issues when the same room was re-added. The fix needs to handle this: when `participant_joined` cancels a pending teardown, the existing bridge should be re-bound (not re-created). The `addRoom()` idempotent check (`bridge-manager.ts:73`) already returns early if a bridge exists — this should be sufficient.

## Acceptance Criteria

- [ ] `participant_left` webhook schedules deferred teardown (60s grace period)
- [ ] `participant_joined` webhook cancels pending teardown
- [ ] Existing bridge is preserved and re-bound when client reconnects within grace period
- [ ] Room is cleaned up after 60s if no participant rejoins
- [ ] App-level reconnect does not fire redundant `participant_left` when already disconnected
- [ ] No regression on BUG-036 stale state (bridge reuse, not duplication)

## Files

- `apps/relay/src/http/webhook.ts` — teardown trigger
- `apps/relay/src/bridge/bridge-manager.ts` — `scheduleRemoveRoom()`, `cancelPendingTeardown()` (already exist)
- `apps/mobile/lib/services/livekit_service.dart` — `_doReconnectAttempt()` disconnect guard

## Status

- **Date:** 2026-03-17
- **Priority:** HIGH (highest leverage fix — also reduces BUG-053 ghost rooms)
- **Bug:** BUG-052
- **Status:** RCA COMPLETE
