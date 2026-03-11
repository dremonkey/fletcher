# R-005: Health & Observability

**Status:** [ ] Not started
**Depends on:** R-001 (LiveKit participant)
**Blocks:** Nothing

## Objective

Update existing health endpoints for the new architecture. Add room/ACP status visibility.

## What exists

- `GET /health` → `{ status: "ok", uptime: <seconds> }`
- `GET /sessions` → `{ sessions: [...] }`

## What to change

### `GET /health`

```json
{
  "status": "ok",
  "uptime": 3600,
  "rooms": 2,
  "acpProcesses": 2
}
```

### `GET /rooms`

Replace `/sessions` with `/rooms` (relay tracks rooms, not sessions):

```json
{
  "rooms": [
    {
      "roomName": "room-abc123",
      "joinedAt": 1710123456,
      "lastActivity": 1710123500,
      "acpStatus": "connected",
      "sessionId": "sess_abc"
    }
  ]
}
```

### Logging

Use structured logging (pino-compatible, matching the project's logging standards from CLAUDE.md):

```typescript
import { createLogger } from './utils/logger';
const log = createLogger('relay');

log.info({ roomName, event: 'room_joined' });
log.info({ roomName, event: 'acp_initialized', sessionId });
log.warn({ roomName, event: 'idle_timeout' });
log.error({ roomName, event: 'acp_crash', exitCode });
```

## Acceptance criteria

- [ ] `/health` includes room and ACP process counts
- [ ] `/rooms` shows active room details
- [ ] Structured logging for key lifecycle events (join, disconnect, ACP init, errors)
- [ ] Old `/sessions` endpoint removed or redirected
