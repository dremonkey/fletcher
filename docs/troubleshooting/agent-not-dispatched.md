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

---

# Agent registers but dispatch fails with "no servers available"

## Symptoms

- `voice-agent` container starts and registers with LiveKit successfully
- LiveKit server logs show `failed to send job request` with `no servers available (received 1 responses)`
- The voice-agent logs show `registered worker` but never `received job request`
- The error is intermittent — sometimes the agent joins, sometimes it doesn't

## LiveKit server logs

```
worker registered    jobType: "JT_ROOM"  agentName: ""  workerID: "AW_xxx"
failed to send job request  {"error": "no servers available (received 1 responses)", "jobType": "JT_ROOM", "agentName": ""}
```

The worker registers correctly, but when a room is created the server considers the worker unavailable without even sending it a job request.

## Root cause

The `@livekit/agents` Node.js SDK periodically reports CPU load to the LiveKit server via `os.cpus()`. The server uses this reported load to decide whether a worker can accept jobs.

Inside a Docker container, `os.cpus()` returns **host** CPU counters, not the container's cgroup allocation. This produces unreliable load measurements that can cause the server to consider the worker full even when it's idle.

In dev mode, the SDK sets `loadThreshold: Infinity` so the Node.js side never marks itself as `WS_FULL`. However, the raw load *value* is still sent to the Go server, which may interpret it independently of the threshold the worker reports.

## Fix

Override `loadFunc` in `ServerOptions` to always report zero load:

```typescript
// apps/voice-agent/src/agent.ts
cli.runApp(new ServerOptions({
  agent: import.meta.filename,
  initializeProcessTimeout: 60_000,
  loadFunc: async () => 0,
}));
```

This tells the LiveKit server "this worker is always available for dispatch."

### Is this safe?

- **Single-worker / low room count (< ~10):** Yes. The worker will never be under meaningful load, so there's nothing useful to report.
- **LiveKit Cloud:** The SDK ignores custom `loadFunc` and forces its own defaults, so this override has no effect.
- **High-scale multi-worker deployments:** You'd want real load reporting so the server can distribute jobs across workers. Remove the override and ensure containers have accurate CPU accounting (e.g., `--cpus` flag matching cgroup limits).

## Verification

After the fix, LiveKit server logs should show `assigned job to worker` instead of `failed to send job request` when a room is created.

## References

- [LiveKit Agents overview](https://docs.livekit.io/agents/)
- [Agent server lifecycle](https://docs.livekit.io/agents/server/lifecycle/)
- [Agent dispatch modes](https://docs.livekit.io/agents/server/agent-dispatch/)
