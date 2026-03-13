# Task 062: Wire Voice Agent to AcpLLM

**Epic:** 22 — Dual-Mode Architecture
**Status:** [x]
**Depends on:** 061 (AcpLLM Backend)
**Blocks:** none

## Goal

Update the voice agent (`apps/voice-agent/src/agent.ts`) to work with the new `AcpLLM` backend. This involves updating environment variable validation, ensuring `createGangliaFromEnv()` works correctly with ACP config, and verifying session routing flows through ACP `_meta`.

## Context

The voice agent currently validates `OPENCLAW_API_KEY` when `GANGLIA_TYPE=openclaw`. With ACP as the default, authentication is handled by the ACP subprocess itself (OpenClaw handles its own auth when spawned). The voice agent no longer needs to validate an API key for the LLM connection.

The voice agent creates the LLM early via `createGangliaFromEnv()`, then later calls `setSessionKey()` and `setDefaultSession()` when a participant joins. These methods are part of the `GangliaLLM` interface and are already implemented in `AcpLLM`. The session key and session info are passed to the ACP subprocess via `_meta` in `session/new` during lazy init (first `chat()` call).

```
Voice Agent Lifecycle (unchanged flow, new transport)
─────────────────────────────────────────────────────
1. createGangliaFromEnv({ logger, onPondering, onContent })
   → AcpLLM created (subprocess NOT spawned yet)
2. AgentSession starts, participant joins
3. gangliaLlm.setSessionKey(sessionKey)
4. gangliaLlm.setDefaultSession({ roomName, participantIdentity })
5. User speaks → AgentSession calls gangliaLlm.chat()
   → AcpLLM lazy init: spawn subprocess + initialize + session/new
   → session/prompt with user text
   → session/update → ChatChunk → TTS
```

## Implementation

### 1. Update env validation (`apps/voice-agent/src/agent.ts`)

Remove `OPENCLAW_API_KEY` from required env vars when `GANGLIA_TYPE` is `acp` (or unset, since `acp` is now default). The ACP subprocess handles its own authentication.

Keep `OPENCLAW_API_KEY` validation only if `GANGLIA_TYPE=openclaw` (which will now throw "Unknown ganglia type" from the factory, but we should still clean up the validation logic to avoid confusion).

Add optional validation for ACP-specific env vars:
- `ACP_COMMAND` — command to spawn (default: `"openclaw"`)
- `ACP_ARGS` — arguments (default: `"acp"`)
- `ACP_PROMPT_TIMEOUT_MS` — prompt timeout (default: `120000`)

### 2. Update env documentation

Update the env block comment at the top of `agent.ts` to list the new ACP env vars and remove the `OPENCLAW_API_KEY` requirement note for the default backend.

### 3. Verify session routing

The existing code already calls:
```typescript
gangliaLlm.setSessionKey?.(sessionKey);
gangliaLlm.setDefaultSession?.({ roomName, participantIdentity });
```

These are optional-chained, so they work with any `GangliaLLM` implementation. No changes needed here — just verify AcpLLM receives and uses them correctly.

### 4. Update docker-compose / env examples

If there are `.env.example` or `docker-compose.yml` files referencing `GANGLIA_TYPE=openclaw`, update them to show the new ACP defaults.

### 5. Smoke test

Run the voice agent with `GANGLIA_TYPE=acp` (or no `GANGLIA_TYPE` set) and verify:
- Subprocess spawns on first user turn
- Session key is passed via `_meta`
- Text response streams back as speech
- Barge-in sends `session/cancel`

## Not in scope

- AcpLLM implementation (task 061)
- Relay changes (relay has its own ACP client)
- Mobile changes (mobile talks to relay, not ganglia)

## Relates to

- Task 061 (AcpLLM Backend) — this task depends on it
- `apps/voice-agent/src/agent.ts` — primary file modified
- `apps/voice-agent/src/bootstrap.ts` — unchanged (bootstrap message still sent via `session.generateReply`)

## Acceptance criteria

- [ ] Voice agent starts without errors when `GANGLIA_TYPE` is unset (defaults to `acp`)
- [ ] `OPENCLAW_API_KEY` no longer required for default backend
- [ ] ACP env vars documented in agent.ts
- [ ] `createGangliaFromEnv()` returns `AcpLLM` instance
- [ ] Session key and default session flow through to ACP `_meta`
- [ ] Env examples updated if they exist
