# Agent registers but never joins a room

## Symptoms

- `voice-agent` container starts and registers with LiveKit successfully
- LiveKit server logs show `not dispatching agent`
- No agent appears in the room when a participant connects

## LiveKit server logs

```
worker registered      jobType: "JT_ROOM"       agentName: "livekit-ganglia-agent"
not dispatching agent   jobType: "JT_PARTICIPANT" agentName: "livekit-ganglia-agent"
```

The key detail is the job type mismatch: the worker registered as `JT_ROOM` but the dispatch request is `JT_PARTICIPANT`.

## Root cause

This happens when the agent and token config disagree on the dispatch mode:

1. **Agent side:** `ServerOptions` defaults to `JT_ROOM` (auto-dispatch). Setting `agentName` disables auto-dispatch but does **not** change the job type — the worker still registers as `JT_ROOM`.

2. **Token side:** `RoomAgentDispatch` in the client token creates `JT_PARTICIPANT` dispatch requests (explicit dispatch).

3. **Result:** LiveKit receives a `JT_PARTICIPANT` dispatch request, finds no worker registered for that job type, and silently drops it.

### Why it's silent

LiveKit logs `not dispatching agent` at info level, not as an error. There's no client-side feedback — the participant joins the room but no agent ever appears.

## Fix

Use auto-dispatch (the simpler model for single-agent setups):

### 1. Remove `agentName` from `ServerOptions`

```typescript
// apps/voice-agent/src/agent.ts

// Before — auto-dispatch is disabled by agentName
cli.runApp(new ServerOptions({
  agent: import.meta.filename,
  agentName: 'livekit-ganglia-agent',  // ← disables auto-dispatch
  initializeProcessTimeout: 60_000,
}));

// After — auto-dispatch re-enabled
cli.runApp(new ServerOptions({
  agent: import.meta.filename,
  initializeProcessTimeout: 60_000,
}));
```

### 2. Remove `RoomAgentDispatch` from the token

```typescript
// scripts/generate-token.ts

// Before — explicit dispatch config in token
import { AccessToken, RoomConfiguration, RoomAgentDispatch } from "livekit-server-sdk";
token.roomConfig = new RoomConfiguration({
  agents: [new RoomAgentDispatch({ agentName: "livekit-ganglia-agent" })],
});

// After — no dispatch config needed
import { AccessToken } from "livekit-server-sdk";
// (remove roomConfig entirely)
```

### 3. Rebuild and regenerate

```sh
docker compose up -d --build voice-agent
bun run scripts/generate-token.ts --room fletcher-dev
```

## Verification

After the fix, LiveKit server logs should show:

```
worker registered      jobType: "JT_ROOM"
```

No `agentName` in the registration, and no `not dispatching agent` messages. The agent joins the room as soon as it's created.

## If you need explicit dispatch later

For multi-agent setups (different agents for different rooms/participants), you must ensure both sides use `JT_PARTICIPANT`:

**Agent side** — set `serverType` explicitly:
```typescript
import { JobType } from '@livekit/protocol';
cli.runApp(new ServerOptions({
  agent: import.meta.filename,
  agentName: 'livekit-ganglia-agent',
  serverType: JobType.JT_PARTICIPANT,  // ← must match dispatch type
}));
```

**Token side** — restore `RoomAgentDispatch`:
```typescript
token.roomConfig = new RoomConfiguration({
  agents: [new RoomAgentDispatch({ agentName: "livekit-ganglia-agent" })],
});
```

## References

- [LiveKit Agents overview](https://docs.livekit.io/agents/)
- [Agent server lifecycle](https://docs.livekit.io/agents/server/lifecycle/)
- [Agent dispatch modes](https://docs.livekit.io/agents/server/agent-dispatch/)
