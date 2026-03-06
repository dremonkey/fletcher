# 020: Agent Reconnect After Worker Restart

## Problem

When the voice-agent container restarts while a client is in a room, LiveKit does not dispatch a new agent job to the room. The client stays connected but talks to an empty room — no STT, no TTS, no agent. This persists across app restarts until the LiveKit server itself is restarted.

**Discovered:** 2026-03-06 field test (BUG-005). Triggered by restarting the voice-agent container for a config change while a client was connected.

**Root cause:** LiveKit's agent dispatch is a one-shot event tied to room/participant arrival. If the dispatch fails (e.g., no worker available during a brief restart window) or the agent crashes mid-session, there is no reconciliation loop that detects "room has participants but no agent" and re-dispatches.

**Timeline of failure:**
1. Voice-agent container stops → old worker deregisters → old agent leaves room
2. LiveKit tries to send TerminateJob RPC → `"no response from servers"` (worker gone)
3. New container starts → new worker registers
4. Client reconnects → joins existing room → `numParticipants: 0` (no agent)
5. LiveKit sees the room already exists with a job record → does NOT dispatch a new job

## Why This Matters

Any scenario that causes the voice-agent to restart breaks all active sessions until the entire LiveKit server is restarted:
- Docker container restart (config change, OOM kill, deployment)
- Agent process crash (unhandled exception, memory exhaustion — see BUG-001)
- Host machine reboot
- `docker compose up -d` after code changes

This is the #1 resilience gap for a self-hosted single-agent setup.

## Proposed Solutions

### Option A: Explicit Agent Dispatch via API (Recommended)

Use LiveKit's `AgentDispatchService` to explicitly dispatch agents instead of relying on automatic dispatch. On worker startup, query all active rooms and dispatch an agent to any room that has participants but no agent.

```typescript
// On worker registration, check for orphaned rooms
async function recoverOrphanedRooms(livekitUrl: string, apiKey: string, apiSecret: string) {
  const roomService = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
  const dispatchService = new AgentDispatchClient(livekitUrl, apiKey, apiSecret);

  const rooms = await roomService.listRooms();
  for (const room of rooms) {
    const participants = await roomService.listParticipants(room.name);
    const hasAgent = participants.some(p => p.kind === ParticipantKind.AGENT);
    const hasUser = participants.some(p => p.kind === ParticipantKind.STANDARD);

    if (hasUser && !hasAgent) {
      await dispatchService.createDispatch(room.name, { agentName: 'fletcher' });
    }
  }
}
```

**Pros:** Clean, uses official API. Handles all crash/restart scenarios. No client changes needed.
**Cons:** Requires `agentName` to be set in agent definition. Needs LiveKit API credentials in the agent process. Adds startup complexity.

### ~~Option B: Client-Side Agent Presence Monitor~~ (Rejected)

**Does not work.** The client rejoining doesn't help because it joins the same named room (`fletcher-dev`), which already exists with a stale job dispatch record. LiveKit won't dispatch a new agent to an existing room. Confirmed in field testing — quitting and reopening the app reconnected to the same stale room with `numParticipants: 0` every time.

### Option C: Room Deletion on Worker Startup

When the new worker starts, delete all rooms that have no agent participant. This forces clients to reconnect to fresh rooms.

```typescript
// On worker startup, clean up stale rooms
async function cleanupStaleRooms(roomService: RoomServiceClient) {
  const rooms = await roomService.listRooms();
  for (const room of rooms) {
    const participants = await roomService.listParticipants(room.name);
    const hasAgent = participants.some(p => p.kind === ParticipantKind.AGENT);
    if (!hasAgent) {
      await roomService.deleteRoom(room.name);
      // Clients will auto-reconnect → create new room → trigger dispatch
    }
  }
}
```

**Pros:** Simple. Guarantees fresh state. Works with existing auto-dispatch.
**Cons:** Destructive — kicks all clients. Loses room state. Bad UX (disconnect + reconnect flash). Race condition if worker registers before old agent fully leaves.

### Option D: Periodic Room Reconciliation Loop

Run a background loop in the agent process that periodically checks for rooms with users but no agent, and dispatches to them.

```typescript
setInterval(async () => {
  const rooms = await roomService.listRooms();
  for (const room of rooms) {
    const participants = await roomService.listParticipants(room.name);
    const hasAgent = participants.some(p => p.kind === ParticipantKind.AGENT);
    const hasUser = participants.some(p => p.kind === ParticipantKind.STANDARD);
    if (hasUser && !hasAgent) {
      logger.warn({ room: room.name }, 'Orphaned room detected — dispatching agent');
      await dispatchService.createDispatch(room.name, { agentName: 'fletcher' });
    }
  }
}, 15_000); // Check every 15 seconds
```

**Pros:** Handles all failure modes (crash, restart, dispatch failure, stale state). Continuously self-healing. Catches edge cases that one-shot recovery (Option A) might miss.
**Cons:** Polling overhead (mitigated by long interval). Same API credential requirement as Option A. Could dispatch multiple agents if timing is unlucky (needs guard).

## Recommendation

**Option A** (explicit dispatch on startup) for the common case + **Option D** (periodic reconciliation) as ongoing safety net. Both are server-side only and don't require client changes.

Option C (room deletion) is the simplest but most disruptive — worth considering as a fallback if the dispatch API doesn't behave as expected.

## Checklist

- [ ] Choose and implement server-side solution (A, C, or D)
- [ ] Add `agentName` to `defineAgent` if using explicit dispatch
- [ ] Test: restart voice-agent while client is connected → agent should rejoin
- [ ] Test: kill voice-agent process (simulate crash) → agent should rejoin
- [ ] Test: stop voice-agent for >120s (departure_timeout) → agent should rejoin after restart
- [ ] Update architecture docs

## Related

- **BUG-005 (2026-03-06):** Discovery — [20260306-buglog.md](../../docs/field-tests/20260306-buglog.md)
- **Task 012:** Agent self-terminate on session error (related — proactive disconnect to allow re-dispatch)
- **Task 04-008:** Fix zombie agent on disconnect (related — ensures clean agent departure)
- **LiveKit issue [#4060](https://github.com/livekit/livekit/issues/4060):** "not dispatching agent job since no worker is available"
- **LiveKit docs:** [Agent Dispatch](https://docs.livekit.io/agents/server/agent-dispatch/)

## Status
- **Date:** 2026-03-06
- **Priority:** HIGH — any agent restart breaks all active sessions
