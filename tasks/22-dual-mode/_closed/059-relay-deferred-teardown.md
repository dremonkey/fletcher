# TASK-059: Deferred Teardown on `participant_left` (Network Switch Fix)

**Status:** [x] Complete
**Priority:** High
**Epic:** 22 — Dual-Mode Architecture
**Origin:** TEST-001 (field test 2026-03-12, network handover "Nose Hole" test)

## Problem

When a mobile user's network switches (WiFi → cellular), the LiveKit ICE connection drops momentarily. The LiveKit server fires a `participant_left` webhook immediately on ICE drop — **before** the configured `departure_timeout` (120s) expires. The relay's webhook handler called `bridgeManager.removeRoom()` immediately, which:

1. Killed the ACP subprocess (losing session state)
2. Left the LiveKit room (removing the relay participant)

When the mobile SDK auto-reconnected (within ~5-30s), the relay was no longer in the room. Both voice and chat modes broke — the user had to start a new session.

The mobile client already handles reconnection correctly (130s budget via ReconnectScheduler). The voice-agent stays in the room for `departure_timeout`. Only the relay tore down prematurely.

## Solution

Added a departure grace period to `BridgeManager`. On `participant_left`, the webhook schedules a **deferred teardown** instead of tearing down immediately. If `participant_joined` fires for the same room before the grace period expires, the teardown is cancelled. The bridge (and ACP subprocess) stays alive during the grace period so data channel messages flow immediately when the participant reconnects.

## Changes

- **`apps/relay/src/bridge/bridge-manager.ts`** — `scheduleRemoveRoom()`, `cancelPendingTeardown()`, `hasPendingTeardown()`, `getPendingTeardowns()`; `removeRoom()` and `addRoom()` cancel pending teardowns internally; `shutdownAll()` clears all timers; configurable `departureGraceMs` (default 120s) via `BridgeManagerOptions`
- **`apps/relay/src/http/webhook.ts`** — `participant_left` calls `scheduleRemoveRoom()` (sync, no await); `participant_joined` calls `cancelPendingTeardown()` before `hasRoom()` check
- **`apps/relay/src/index.ts`** — reads `RELAY_DEPARTURE_GRACE_MS` env var
- **Tests:** 6 new BridgeManager tests + 2 new webhook tests; existing tests updated

## Edge Cases

| Case | Behavior |
|------|----------|
| Multiple `participant_left` for same room | Deduplicated — one timer per room |
| Idle timeout fires during grace period | `removeRoom()` calls `cancelPendingTeardown()` — no double-remove |
| `participant_joined` during grace period | Teardown cancelled, bridge stays alive |
| Process exit during grace period | Timers are `.unref()`'d — don't block exit |

## Env Vars

- `RELAY_DEPARTURE_GRACE_MS` — grace period in ms before tearing down after `participant_left` (default: `120000`)

## Commit

`9e387c8` — `fix(relay): defer teardown on participant_left to survive network switches`
