# Task 064e: Relay Backend Cleanup & Deployment

**Epic:** 04 — Ganglia / Brain Plugin
**Status:** [~]
**Depends on:** 064d
**Blocks:** 064f

## Goal

Once the relay backend is validated in production, remove ACP subprocess dependencies from the voice-agent container — Dockerfile, Docker Compose volume mounts, and env vars. Verify image size reduction and latency overhead.

## Context

With `GANGLIA_TYPE=relay`, the voice-agent no longer needs to spawn its own ACP subprocess. This means we can remove:

1. **pnpm volume mount** — `docker-compose.yml` line 56: `/home/ahanyu/.local/share/pnpm:/home/ahanyu/.local/share/pnpm:ro`
2. **ACP_COMMAND env var** — `docker-compose.yml` line 61: `ACP_COMMAND: /home/ahanyu/.local/share/pnpm/openclaw`
3. **acp-client package** — `apps/voice-agent/Dockerfile` COPY of `packages/acp-client/`
4. **OpenClaw/Python dependencies** — anything in voice-agent's install that's only needed for the ACP subprocess

**This task should only be executed after the relay backend has been field-tested and confirmed stable.** The ACP path remains as a fallback until then.

## Implementation

### 1. Update `docker-compose.yml`

- Remove pnpm volume mount from voice-agent service
- Remove `ACP_COMMAND` env var
- Add `GANGLIA_TYPE: relay` to voice-agent environment
- Keep heap-snapshots volume (still needed)

### 2. Update `apps/voice-agent/Dockerfile`

- ~~Remove COPY of `packages/acp-client/`~~ — **deferred to 064f**: ganglia still has a workspace dep on `@fletcher/acp-client`, so `bun install --frozen-lockfile` requires the package.json to be present. Removing the COPY requires removing the ganglia→acp-client dependency first.

### 3. Update `.env.example`

- Add `GANGLIA_TYPE=relay` option with documentation
- Note that `ACP_COMMAND` / `ACP_ARGS` are only needed for `GANGLIA_TYPE=acp`

### 4. Field test: latency overhead

- Measure voice-to-voice latency with relay backend vs ACP backend
- Target: <50ms added latency from the relay hop
- Co-located (same machine): expect <10ms
- Same region: expect <30ms

### 5. Verify image size reduction

- Build voice-agent Docker image without acp-client
- Compare image size before and after

## Deferred

**Why deferred:** The relay backend must be validated in production before we remove the ACP fallback path. Premature removal would leave no fallback if relay has issues.

**Revisit when:** After at least one successful field test session using `GANGLIA_TYPE=relay` with acceptable latency.

## Not in scope

- Removing AcpLLM/AcpChatStream code — that's 064f
- Multi-tenant relay architecture — separate epic

## Relates to

- [064 — Relay-Mediated LLM Backend](064-relay-llm-backend.md) (parent design doc, Phase 4)
- [064d — Voice-Agent Wiring](064d-voice-agent-wiring.md) (prerequisite)
- [064f — Remove ACP Backend](064f-remove-acp-backend.md) (follow-up code cleanup)

## Acceptance criteria

- [x] pnpm volume mount removed from voice-agent in docker-compose.yml
- [x] ACP_COMMAND env var removed from voice-agent in docker-compose.yml
- [x] GANGLIA_TYPE=relay set in voice-agent environment
- [x] acp-client COPY removed from voice-agent Dockerfile (done in 064f)
- [x] `.env.example` updated with relay option
- [ ] Field test: relay latency overhead <50ms
- [ ] Docker image size compared before/after

<!--
Status key:
  [ ]  pending
  [~]  in progress
  [x]  done
  [!]  failed / blocked
-->
