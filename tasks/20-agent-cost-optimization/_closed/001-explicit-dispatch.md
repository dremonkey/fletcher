# Task 001: Switch Agent to Explicit Dispatch

**Epic:** 20 — Agent Cost Optimization
**Status:** [x] Complete
**Priority:** High (foundation for all other tasks)

## Problem

The Fletcher voice agent currently uses **automatic dispatch** — it auto-joins every new room. This means there's no way to control when the agent connects; it's always present and always billing.

## Solution

Switch to **explicit dispatch** by setting `agentName` on the agent's `ServerOptions`. With explicit dispatch, the agent only joins a room when explicitly dispatched via:
1. `RoomAgentDispatch` in the participant's access token (initial migration path)
2. `AgentDispatchClient.createDispatch()` server API call (on-demand path)

## Implementation

### 1. Set `agentName` in voice agent

In `apps/voice-agent/src/agent.ts`, add `agentName` to `ServerOptions`:

```typescript
cli.runApp(
  new ServerOptions({
    agent: import.meta.filename,
    agentName: 'fletcher-voice',       // ← enables explicit dispatch
    initializeProcessTimeout: 60_000,
    loadFunc: async () => 0,
  }),
);
```

### 2. Update token endpoint to include `RoomAgentDispatch`

In the token generation endpoint, embed agent dispatch in the room configuration so the agent is dispatched when a participant connects (preserving current auto-join behavior during migration):

```typescript
import { RoomConfiguration, RoomAgentDispatch } from 'livekit-server-sdk';

const token = new AccessToken(apiKey, apiSecret, { identity: userId })
  .addGrant({ room: roomName, roomJoin: true })
  .withRoomConfig(new RoomConfiguration({
    agents: [new RoomAgentDispatch({
      agentName: 'fletcher-voice',
      metadata: JSON.stringify({ user_id: userId }),
    })],
  }));
```

### 3. Verify backward compatibility

After this change, the agent should still auto-join rooms when a participant connects (via the token dispatch). The user experience should be identical to today. The difference is that the dispatch mechanism is now explicit and controllable.

## Files to Modify

- `apps/voice-agent/src/agent.ts` — add `agentName` to `ServerOptions`
- Token endpoint (location TBD — may be in `apps/voice-agent/` or a separate service)

## Acceptance Criteria

- [x] Agent has `agentName: 'fletcher-voice'` set
- [x] Token endpoint includes `RoomAgentDispatch` in room configuration
- [x] Agent still auto-joins rooms when participants connect (no UX change) — verified in field testing
- [x] Agent does NOT join rooms that don't include `RoomAgentDispatch` in their token — verified in field testing
- [x] Verified with `lk room list` / `lk room list-participants` that agent appears as before — verified in field testing

## Dependencies

None — this is the foundation task.

## Risks

- **LiveKit Server SDK version** — `RoomConfiguration` and `RoomAgentDispatch` require a recent version of `livekit-server-sdk`. May need to bump dependency.
- **Self-hosted vs. Cloud** — explicit dispatch behavior may differ between self-hosted LiveKit and LiveKit Cloud. Test both if applicable.
