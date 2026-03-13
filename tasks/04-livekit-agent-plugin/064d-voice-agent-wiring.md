# Task 064d: Voice-Agent Relay Wiring

**Epic:** 04 — Ganglia / Brain Plugin
**Status:** [ ]
**Depends on:** 064b, 064c
**Blocks:** 064e

## Goal

Wire `GANGLIA_TYPE=relay` in the voice-agent so it passes `ctx.room` to `createGangliaFromEnv()`, enabling the relay-mediated LLM path. This is the integration point that ties the relay-side handler (064b) to the Ganglia backend (064c).

## Context

In `apps/voice-agent/src/agent.ts`, the current Ganglia creation (line 207):

```typescript
const gangliaLlm = await createGangliaFromEnv({
  logger,
  onPondering: (phrase, streamId) => transcriptMgr.onPondering(phrase, streamId),
  onContent: (delta, fullText, streamId) => transcriptMgr.onContent(delta, fullText, streamId),
});
```

`ctx.room` is available at this point (the room is connected before `entry()` is called). We just need to pass it through. The `RelayLLM` backend (064c) validates that the room has a relay participant on first `chat()` call.

No changes to env validation — `GANGLIA_TYPE=relay` doesn't require any additional env vars beyond what's already validated (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`).

## Implementation

### 1. Pass room to createGangliaFromEnv (`apps/voice-agent/src/agent.ts`)

Add `room: ctx.room` to the opts:

```typescript
const gangliaLlm = await createGangliaFromEnv({
  logger,
  room: ctx.room,  // Used by GANGLIA_TYPE=relay; ignored by other backends
  onPondering: (phrase, streamId) => transcriptMgr.onPondering(phrase, streamId),
  onContent: (delta, fullText, streamId) => transcriptMgr.onContent(delta, fullText, streamId),
});
```

### 2. Update env var documentation (`apps/voice-agent/src/agent.ts`)

Update the JSDoc header to include `GANGLIA_TYPE=relay` as a valid option:

```typescript
 *   GANGLIA_TYPE - Backend type: 'acp' (default), 'relay', or 'nanoclaw'
```

And add relay-specific notes:

```typescript
 * Relay backend env vars (when GANGLIA_TYPE=relay):
 *   (No additional env vars — uses the LiveKit room connection.)
```

## Not in scope

- Fallback to ACP if relay not in room — stretch goal for a later task
- Docker/deployment changes — deferred to 064e
- Removing ACP-related env vars — they're still valid for `GANGLIA_TYPE=acp`

## Relates to

- [064 — Relay-Mediated LLM Backend](064-relay-llm-backend.md) (parent design doc)
- [064b — RelayBridge Voice-ACP Handler](064b-relay-bridge-voice-acp.md) (relay-side)
- [064c — Ganglia RelayLLM Backend](064c-ganglia-relay-backend.md) (Ganglia-side)
- [064e — Relay Cleanup](064e-relay-cleanup.md) (follow-up)

## Acceptance criteria

- [ ] `ctx.room` passed to `createGangliaFromEnv()` opts
- [ ] `GANGLIA_TYPE=relay` selects RelayLLM backend
- [ ] Voice pipeline works end-to-end: user speech → STT → RelayLLM → voice-acp → Relay → ACP → response → voice-acp → RelayChatStream → TTS → user
- [ ] Agent transcript bypass still works (onContent → ganglia-events → mobile)
- [ ] JSDoc header updated with relay backend info
- [ ] Existing `GANGLIA_TYPE=acp` and `GANGLIA_TYPE=nanoclaw` paths are unaffected

<!--
Status key:
  [ ]  pending
  [~]  in progress
  [x]  done
  [!]  failed / blocked
-->
