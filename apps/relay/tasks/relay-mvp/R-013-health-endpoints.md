# R-013: Health Endpoints (`/health`, `/sessions` for Debug)

**Depends On:** R-001  
**Blocks:** None  
**Effort:** 1 hour  

## Objective
Expose HTTP endpoints for health checks and debugging.

## Endpoints
1. `GET /health` → `{ status: "ok" }`
2. `GET /sessions` → List of active sessions

## Key Files
- `src/http/routes/health.ts`
- `src/http/routes/sessions.ts`

## `/health` Response
```json
{
  "status": "ok",
  "uptime": 123456,
  "rooms": 2,
  "sessions": 5
}
```

## `/sessions` Response
```json
{
  "sessions": [
    {
      "sessionId": "sess_abc",
      "roomName": "room-123",
      "state": "active",
      "lastActivity": 1710123456
    }
  ]
}
```

## Acceptance Criteria
✅ `/health` returns 200 OK  
✅ `/sessions` returns active session list  
✅ Endpoints work even if relay is not in any room  
