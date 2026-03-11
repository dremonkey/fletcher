# 007: HTTP Status Routes

**Status:** Not Started
**Depends on:** 004
**Blocks:** 008

## Objective

Implement thin HTTP endpoints for health checks and session status, used by monitoring and debugging.

## Files

- `src/http/routes.ts`

## Details

### `handleHttpRequest(req: Request, sessionManager: SessionManager): Response`

Route based on URL pathname:

### `GET /health`

Returns:
```json
{ "status": "ok", "uptime": 12345 }
```

HTTP 200. Used by load balancers and monitoring.

### `GET /sessions`

Returns:
```json
{
  "sessions": [
    { "id": "abc12345", "status": "running", "createdAt": 1710000000, "prompt": "Fix the bug..." }
  ]
}
```

HTTP 200. Calls `sessionManager.listSessions()`.

### Default (404)

Any other path returns:
```json
{ "error": "Not found" }
```

HTTP 404.

### WebSocket upgrade

The `/ws` path is NOT handled here — it's handled by the WebSocket upgrade logic in `index.ts`. This module only handles plain HTTP requests.

## Acceptance Criteria

- `GET /health` returns 200 with status and uptime
- `GET /sessions` returns 200 with session list from manager
- Unknown paths return 404
- All responses are `application/json`
- `tsc --noEmit` passes
