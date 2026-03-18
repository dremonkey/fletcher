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

### Why the teardown is immediate (BUG-036 history)

BUG-036 (2026-03-15, commit `dfca227`) deliberately removed deferred teardown because the 2-minute grace period kept **stale bridges** alive. When a client rejoined within the grace period, it got handed back the old bridge — and if that bridge's ACP session was corrupted (bad STT pipeline state, hung session, etc.), the recovery failed silently. The client would reconnect but get a broken session with no way to fix it.

The fix was nuclear: tear down immediately so every reconnection gets a fresh bridge and `session/new`. The commit notes that "Epic 25 (Session Restoration) will eventually handle state persistence across these clean restarts."

**The core tension:** Deferred teardown saves the expensive ACP lifecycle (spawn + init + bind) but risks handing back a poisoned session. Immediate teardown guarantees a clean session but causes the participant churn we're seeing now on every network switch.

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

The fix must solve both problems simultaneously: the relay must **stay in the room** during network switches (no participant churn), but the client must **never get a poisoned session** (the BUG-036 problem).

### Change 1: Deferred teardown with health-gated re-bind (HIGH PRIORITY)

**File:** `apps/relay/src/http/webhook.ts`, `apps/relay/src/bridge/bridge-manager.ts`

On `participant_left`: keep the relay in the room, schedule bridge teardown after 60s:

```typescript
if (event.event === "participant_left") {
  // Keep the relay IN the room — don't leave.
  // Schedule bridge+ACP teardown after 60s grace period.
  bridgeManager.scheduleRemoveRoom(roomName, 60_000); // 60s grace
}
```

On `participant_joined`: cancel pending teardown, then **validate the existing bridge** before re-binding:

```typescript
if (event.event === "participant_joined") {
  bridgeManager.cancelPendingTeardown(roomName);

  if (bridgeManager.hasBridge(roomName)) {
    // Bridge survived the grace period — check if it's healthy.
    // If healthy: re-use it (fast path — no ACP respawn).
    // If unhealthy: tear it down and create a fresh one.
    bridgeManager.validateOrReplaceBridge(roomName);
  } else {
    // No bridge — normal addRoom flow (bind timeout, etc.)
    bridgeManager.addRoom(roomName);
  }
}
```

The `scheduleRemoveRoom()` and `cancelPendingTeardown()` methods already exist in `bridge-manager.ts:222-240`.

### Change 2: Bridge health check (`validateOrReplaceBridge`)

**File:** `apps/relay/src/bridge/bridge-manager.ts`

New method that checks the existing bridge before re-binding:

```typescript
async validateOrReplaceBridge(roomName: string): Promise<void> {
  const bridge = this.bridges.get(roomName);
  if (!bridge) return this.addRoom(roomName);

  // Check ACP subprocess is alive and responsive
  const healthy = bridge.acpClient.isAlive;

  if (healthy) {
    // Fast path: bridge is good, just re-bind when client sends session/bind.
    // Reset bind timeout so the client has 30s to send bind.
    log.info({ roomName, event: "bridge_reuse" }, "Reusing healthy bridge after reconnect");
    this.resetBindTimeout(roomName);
  } else {
    // Slow path: ACP is dead/hung — tear down and create fresh (BUG-036 scenario).
    log.warn({ roomName, event: "bridge_replace" }, "Bridge unhealthy — replacing with fresh instance");
    await this.removeRoom(roomName);  // stop bridge, kill ACP
    this.addRoom(roomName);           // fresh bridge, new bind timeout
  }
}
```

This gives us the best of both worlds:
- **Healthy bridge:** Client reconnects instantly to an existing session. No ACP respawn, no 2.5s startup delay, no lost state.
- **Unhealthy bridge (BUG-036 scenario):** Torn down and replaced, same as today. Client gets a clean session.

The key difference from the old deferred teardown: we don't blindly hand back the old bridge. We validate it first.

### Change 3: Skip disconnect in app-level reconnect when already disconnected (MEDIUM PRIORITY)

**File:** `apps/mobile/lib/services/livekit_service.dart`

In `_doReconnectAttempt()`, skip the `disconnect()` call if the Room is already in a disconnected state — it fires a redundant `participant_left` webhook:

```dart
// Only disconnect if the room is still connected/reconnecting
if (_room?.connectionState != ConnectionState.disconnected) {
  await disconnect(preserveTranscripts: true);
}
```

## Acceptance Criteria

- [ ] `participant_left` webhook schedules deferred teardown (60s grace period); relay stays in room
- [ ] `participant_joined` webhook cancels pending teardown
- [ ] Healthy bridge is reused on reconnect (fast path — no ACP respawn)
- [ ] Unhealthy bridge is torn down and replaced (BUG-036 safety — client never gets poisoned session)
- [ ] Room + bridge cleaned up after 60s if no participant rejoins
- [ ] App-level reconnect does not fire redundant `participant_left` when already disconnected
- [ ] Field test confirms network switch produces room lifetimes >60s (not 18-67s)

## Files

- `apps/relay/src/http/webhook.ts` — teardown trigger
- `apps/relay/src/bridge/bridge-manager.ts` — `scheduleRemoveRoom()`, `cancelPendingTeardown()` (already exist)
- `apps/mobile/lib/services/livekit_service.dart` — `_doReconnectAttempt()` disconnect guard

## Status

- **Date:** 2026-03-17
- **Priority:** HIGH (highest leverage fix — also reduces BUG-053 ghost rooms)
- **Bug:** BUG-052
- **Status:** RCA COMPLETE
