# R-009: Auto-Rejoin Rooms on Relay Restart

**Status:** [x] Complete
**Priority:** High
**Epic:** Relay resilience

## Problem

When the relay process restarts (crash, deploy, manual restart), it loses all in-memory room state. Users still connected to LiveKit rooms see the relay as disconnected. The only recovery path is the user leaving and rejoining (triggering a `participant_joined` webhook).

## Solution

On startup, query LiveKit's `RoomServiceClient` to discover rooms with active human participants but no relay participant, and auto-join them. This preserves the relay's stateless design — LiveKit is the source of truth, no persistence files needed.

## Implementation

### 1. Shared participant filter — `src/livekit/participant-filter.ts` (new)
- [x] `isHumanParticipant(p)` — returns false for relay (`relay-*` identity) and agent (kind === 4)
- [x] Constants: `PARTICIPANT_KIND_AGENT`, `RELAY_IDENTITY_PREFIX`
- [x] Unit tests in `participant-filter.spec.ts`

### 2. URL helper — `src/utils/url.ts` (new)
- [x] `wsUrlToHttp(wsUrl)` — converts `ws://` → `http://`, `wss://` → `https://`
- [x] Needed because `LIVEKIT_URL` is WS but `RoomServiceClient` expects HTTP
- [x] Unit tests in `url.spec.ts`

### 3. Room discovery module — `src/livekit/room-discovery.ts` (new)
- [x] `discoverAndRejoinRooms({ roomService, bridgeManager, logger })`
- [x] Call `roomService.listRooms()`, then `listParticipants()` per room
- [x] Skip rooms with no human participants or already containing a relay
- [x] Call `bridgeManager.addRoom()` for orphaned rooms
- [x] Never throws — catches errors per-room so one failure doesn't block others
- [x] Returns structured `DiscoveryResult` for logging/testing
- [x] Unit tests in `room-discovery.spec.ts`

### 4. Refactor webhook — `src/http/webhook.ts` (modify)
- [x] Replace inline relay/agent filtering with `isHumanParticipant()` from shared filter
- [x] Verify existing webhook tests still pass

### 5. Wire into entry point — `src/index.ts` (modify)
- [x] After `Bun.serve()`, fire-and-forget `discoverAndRejoinRooms()`
- [x] Create `RoomServiceClient` using `wsUrlToHttp(LIVEKIT_URL)` + existing API key/secret
- [x] No `await` — runs async so server is immediately ready for webhooks

## Edge Cases

- **Stale relay participant:** Old process died without disconnecting → LiveKit may still show `relay-*`. Discovery skips these. LiveKit departure timeout (~20s) cleans them up.
- **Race with webhooks:** Both discovery and webhook may call `addRoom` concurrently. Safe — `addRoom` is idempotent.
- **LiveKit unreachable on startup:** `listRooms` fails → logs warning, returns empty. Relay still works via webhooks.
- **No new env vars or dependencies needed.** `livekit-server-sdk` already exports `RoomServiceClient`.

## Verification

- [x] `bun test` — all new + existing tests pass (95 tests, 0 failures)
- [ ] Manual: start relay with user already in a LiveKit room → relay auto-joins
- [x] Check logs for `room_discovery_complete` event
