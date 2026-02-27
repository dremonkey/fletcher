# Troubleshooting

## Voice Agent

### Agent registers but never joins a room

**Symptoms:**
- `voice-agent` container starts and registers with LiveKit successfully
- LiveKit server logs show `not dispatching agent`
- No agent appears in the room when a participant connects

**LiveKit server logs look like:**
```
worker registered      jobType: "JT_ROOM"       agentName: "livekit-ganglia-agent"
not dispatching agent   jobType: "JT_PARTICIPANT" agentName: "livekit-ganglia-agent"
```

**Root cause:** Job type mismatch. `ServerOptions` defaults to `JT_ROOM`, but `RoomAgentDispatch` in the client token creates `JT_PARTICIPANT` jobs. LiveKit finds no `JT_PARTICIPANT` worker and silently drops the dispatch.

**Fix:** Use auto-dispatch (the LiveKit default) instead of explicit dispatch:

1. **Remove `agentName`** from `ServerOptions` in `apps/voice-agent/src/agent.ts`. Setting `agentName` disables automatic dispatch per the LiveKit docs.
2. **Remove `RoomAgentDispatch`** and `RoomConfiguration` from the token in `scripts/generate-token.ts`. Auto-dispatch doesn't need token-side config.
3. **Regenerate the token** — `bun run scripts/generate-token.ts --room fletcher-dev`
4. **Rebuild the agent** — `docker compose up -d --build voice-agent`

With auto-dispatch, LiveKit dispatches a `JT_ROOM` job to the worker whenever a room is created — no explicit naming required.

**If you need explicit dispatch later** (e.g., multiple agents per project), set `serverType: JobType.JT_PARTICIPANT` alongside `agentName` so both sides agree on the job type:
```typescript
import { JobType } from '@livekit/protocol';
cli.runApp(new ServerOptions({
  agent: import.meta.filename,
  agentName: 'livekit-ganglia-agent',
  serverType: JobType.JT_PARTICIPANT,
}));
```
And restore `RoomAgentDispatch` in the token.
