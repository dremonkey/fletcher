# Task 002: Add Dispatch Endpoint to Token Server

**Epic:** 20 — Agent Cost Optimization
**Status:** [ ]
**Priority:** High

## Problem

Once the agent switches to explicit dispatch (Task 001), we need a server-side endpoint that the mobile client can call to dispatch the agent on demand — specifically when the client's local VAD detects speech.

## Solution

Create a `POST /dispatch-agent` HTTP endpoint on the token server. The endpoint accepts a room name, validates the request, and calls `AgentDispatchClient.createDispatch()` via the LiveKit Server SDK.

## API Design

### Request
```
POST /dispatch-agent
Content-Type: application/json

{
  "room_name": "fletcher-abc123",
  "metadata": { "user_id": "owner" }  // optional
}
```

### Response (Success)
```json
{
  "status": "dispatched",
  "agent_name": "fletcher-voice",
  "dispatch_id": "AD_xxxx"
}
```

### Response (Agent Already Present)
```json
{
  "status": "already_present"
}
```

### Response (Error)
```json
{
  "status": "error",
  "message": "Room not found"
}
```

## Implementation

```typescript
import { AgentDispatchClient } from 'livekit-server-sdk';

const dispatchClient = new AgentDispatchClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

app.post('/dispatch-agent', async (req, res) => {
  const { room_name, metadata } = req.body;

  // Check if agent is already in the room
  const existing = await dispatchClient.listDispatches(room_name);
  const active = existing.filter(d => d.state === 'active');
  if (active.length > 0) {
    return res.json({ status: 'already_present' });
  }

  const dispatch = await dispatchClient.createDispatch(
    room_name,
    'fletcher-voice',
    { metadata: metadata ? JSON.stringify(metadata) : undefined },
  );

  return res.json({
    status: 'dispatched',
    agent_name: 'fletcher-voice',
    dispatch_id: dispatch.id,
  });
});
```

## Idempotency

The endpoint must be idempotent — calling it multiple times for the same room should not dispatch multiple agents. Check for existing active dispatches before creating a new one.

## Authentication

The endpoint should require the same auth as the token endpoint (shared secret, API key, or whatever is currently used). Do not allow unauthenticated dispatch.

## Files to Modify

- Token server (location TBD — find existing token endpoint and co-locate)

## Acceptance Criteria

- [ ] `POST /dispatch-agent` endpoint exists and returns dispatch status
- [ ] Idempotent — no duplicate agents dispatched to same room
- [ ] Authenticated — rejects unauthenticated requests
- [ ] Agent appears in room within ~200ms of dispatch call
- [ ] Error handling for non-existent rooms, dispatch failures

## Dependencies

- Task 001 (Explicit Dispatch) — agent must have `agentName` set for dispatch to work

## Notes

- `AgentDispatchClient` may need to be imported from a specific `livekit-server-sdk` version. Check compatibility.
- Consider rate limiting to prevent abuse (e.g., max 1 dispatch per room per 5 seconds).
