# Task 021: Dynamic Room Names for Agent Restart Recovery

**Status:** ✅ Complete
**Priority:** HIGH
**Related:** [BUG-005](../../docs/field-tests/20260306-buglog.md), [Task 020](020-agent-reconnect-after-restart.md)

## Problem

When the voice-agent container restarts while a client is in a room, LiveKit doesn't re-dispatch an agent to the existing room. The room name `fletcher-dev` was hardcoded in a static JWT token baked into `apps/mobile/.env`. The client always reconnected to the same stale room, so there was no way to get a fresh agent dispatch.

## Solution

Switch to dynamic room names (`fletcher-<unix-millis>`) so the client can create a new room (and get a fresh agent dispatch) after an extended disconnect, while still rejoining the same room for temporary network blips.

### Two behaviors based on disconnect duration

1. **Temporary disconnect (within departure_timeout ~120s):** Rejoin same room using cached token. Existing ReconnectScheduler handles this.
2. **Extended disconnect (budget expired, app killed, agent crashed):** Create a new room with a fresh name → LiveKit dispatches a fresh agent.

### Token endpoint

A lightweight `scripts/token-server.ts` Bun HTTP server generates JWT tokens on demand so API secrets stay off the device.

## Implementation Checklist

### Server-side
- [x] Create `scripts/token-server.ts` — token endpoint (GET /token?room=&identity=)
- [x] Add `token-server` service to `docker-compose.yml`
- [x] Add `scripts/` to Dockerfile COPY steps
- [x] Add sync comment to `livekit.yaml` departure_timeout

### Client-side
- [x] Create `apps/mobile/lib/services/token_service.dart` — fetch tokens from endpoint
- [x] Create `apps/mobile/lib/services/session_storage.dart` — persist room name via SharedPreferences
- [x] Add `shared_preferences` to `pubspec.yaml`
- [x] Update `apps/mobile/.env` — remove LIVEKIT_TOKEN, add TOKEN_SERVER_PORT + DEPARTURE_TIMEOUT_S
- [x] Update `main.dart` — remove LIVEKIT_TOKEN, pass tokenServerPort + departureTimeoutS
- [x] Update `conversation_screen.dart` — remove token parameter, use connectWithDynamicRoom
- [x] Update `livekit_service.dart` — add connectWithDynamicRoom, _connectToNewRoom, dynamic room generation
- [x] Update `reconnect_scheduler.dart` — configurable budget via factory constructor

### Documentation
- [x] Update `docs/architecture/network-connectivity.md`
- [x] Update `docs/architecture/infrastructure.md`
- [x] Update `docs/architecture/mobile-client.md`
- [x] Update `tasks/SUMMARY.md`
- [x] Link BUG-005 to this task

### Verification
- [x] `curl http://localhost:7882/token?room=test&identity=user1` returns valid JWT
- [x] Kill app, reopen → new room created, agent dispatched (e2e test 006)
- [x] Toggle airplane mode ~10s → reconnects to same room (e2e test 007)
- [ ] `docker compose restart voice-agent` → client recovers via new room
- [x] Toggle airplane mode > 2 min → client creates new room (e2e test 008)
