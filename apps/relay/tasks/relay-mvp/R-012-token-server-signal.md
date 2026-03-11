# R-012: Token Server Signal (HTTP `/relay/join` Endpoint)

**Depends On:** R-001, R-002  
**Blocks:** None  
**Effort:** 1 hour  

## Objective
Expose HTTP endpoint for token server to signal relay to join a room.

## Reference
See `docs/gateway-api-contract.md` section "Token Server Signal API" (Gap 3)

## Endpoint
```typescript
POST /relay/join
Content-Type: application/json

{
  "roomName": "room-abc123",
  "userId": "user-123"  // Optional
}

Response:
{
  "success": true
}
```

## Key File
- `src/http/routes/join.ts`

## Logic
1. Validate request body (roomName required)
2. Generate LiveKit token for relay participant
3. Call `participantManager.joinRoom(roomName, token)`
4. Return success or error

## Security
- Localhost-only (bind to 127.0.0.1)
- Optional: Shared secret header (`X-Relay-Secret`)

## Acceptance Criteria
✅ `POST /relay/join` accepts roomName  
✅ Relay joins LiveKit room  
✅ Returns success response  
✅ Returns 400 if roomName missing  
✅ Returns 503 if join fails  
