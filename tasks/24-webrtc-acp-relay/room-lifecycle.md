# Room Lifecycle

**Status:** [x] Complete
**Depends on:** livekit-participant
**Blocks:** Nothing

## Objective

Implement the join-on-demand pattern: token server signals the relay to join a room, relay auto-disconnects after idle timeout.

## Join signal

The token server (already an HTTP service on the same host) calls the relay when a mobile client requests a token:

```
POST /relay/join
Content-Type: application/json

{ "roomName": "room-abc123", "userId": "alice" }
```

Response:
```json
{ "status": "joined", "roomName": "room-abc123" }
```

If already in the room:
```json
{ "status": "already_joined", "roomName": "room-abc123" }
```

### Security

This endpoint is localhost-only. The relay binds its HTTP server to `127.0.0.1`. No auth needed — the token server and relay are on the same machine.

## Idle timeout

Track `lastActivity` per room. After `RELAY_IDLE_TIMEOUT_MS` (default: 5 minutes) with no data channel messages:

1. Send ACP `shutdown` to ACPX subprocess
2. Kill ACPX subprocess
3. Disconnect from LiveKit room
4. Remove room from tracking

```typescript
// Check every 60s
setInterval(() => {
  for (const [roomName, bridge] of rooms) {
    if (Date.now() - bridge.lastActivity > RELAY_IDLE_TIMEOUT_MS) {
      disconnectRoom(roomName);
    }
  }
}, 60_000);
```

### Activity tracking

Any data channel message on the `"relay"` topic resets the idle timer for that room. ACP responses from ACPX also reset it.

## Graceful shutdown

On SIGINT/SIGTERM:
1. Stop accepting new `/relay/join` requests
2. For each active room: send ACP `shutdown`, kill subprocess, disconnect
3. Close HTTP server

## Changes to existing code

- `src/http/routes.ts` — Add `POST /relay/join` route
- `src/index.ts` — Update graceful shutdown to handle room cleanup

## Acceptance criteria

- [ ] `POST /relay/join` triggers room join
- [ ] Duplicate join requests are idempotent
- [ ] Idle rooms auto-disconnect after timeout
- [ ] ACPX subprocess is killed on room disconnect
- [ ] Graceful shutdown cleans up all rooms
- [ ] HTTP server binds to `127.0.0.1` only

## Environment

```bash
RELAY_HTTP_PORT=7890           # HTTP server port
RELAY_IDLE_TIMEOUT_MS=300000   # 5 minutes
```
