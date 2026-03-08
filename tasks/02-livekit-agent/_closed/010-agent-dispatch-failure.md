# Task 010: Fix Agent Dispatch in `dev` Mode

**Epic:** 02 - OpenClaw Channel Plugin
**Priority:** High
**Source:** [BUG-007](../../docs/field-tests/20260301-buglog.md#bug-007-agent-dispatch-fails-in-dev-mode-after-container-rebuild-high) — 2026-03-02 testing session

## Problem

After rebuilding the voice-agent Docker image, `docker compose up -d voice-agent` starts the worker and it registers with LiveKit, but LiveKit never dispatches jobs to it when clients join rooms. The agent sits idle while the mobile app shows "agent not present."

The workaround is to use `connect --room fletcher-dev` mode, which bypasses LiveKit's dispatch protocol entirely and joins the room directly. This works but loses automatic lifecycle management.

## Symptoms

1. Worker registers successfully: `registered worker id=AW_...`
2. Mobile app connects to room: `[Fletcher] Connected to room`
3. No `received job request` log appears in the agent
4. Mobile shows "agent not present"

## Investigation Checklist

- [ ] Check if the token grant needs an `agent` or `agentName` field for dispatch
- [ ] Check if LiveKit `agentProtocol: 1` requires room-level configuration (e.g., `roomPreset`)
- [ ] Review LiveKit server logs for dispatch decisions (why it chose not to dispatch)
- [ ] Test with `lk` CLI: manually create a room with agent dispatch enabled
- [ ] Check if `defineAgent()` in `agent.ts` needs a `name` parameter matching a room config
- [ ] Check LiveKit server version (1.9.11) changelog for agent dispatch changes
- [ ] Verify `loadFunc: async () => 0` isn't causing issues (maybe dispatch requires non-zero load reporting?)

## Potential Causes

1. **Missing agent configuration in token** — `scripts/generate-token.ts` doesn't set `agent` or `roomPreset` in the grant. LiveKit may need this to trigger dispatch.
2. **Room-level agent config** — LiveKit may require rooms to be pre-configured for agent dispatch (via room presets or API).
3. **Stale worker state** — After container rebuild, LiveKit server may have stale state from the old worker preventing new dispatch.
4. **Agent protocol mismatch** — `agentProtocol: 1` may have changed behavior in LiveKit 1.9.11.

## Workaround

```bash
# Instead of:
docker compose up -d voice-agent

# Use connect mode:
docker compose run -d --name fletcher-agent-direct voice-agent connect --room fletcher-dev
```

Note: `connect` mode creates a one-off container that must be manually stopped/removed.

## Files

- `apps/voice-agent/src/agent.ts` — `defineAgent()` configuration
- `scripts/generate-token.ts` — token generation (missing agent grant?)
- `docker-compose.yml` — voice-agent service definition
- `livekit.yaml` — LiveKit server configuration

## Context

- **LiveKit server version:** 1.9.11
- **LiveKit agents SDK:** 1.0.48
- **Agent protocol:** 1
- This worked in earlier sessions — the regression may be related to container lifecycle or LiveKit server state

## Status

- **Date:** 2026-03-02
- **Priority:** High
- **Status:** Not started — using `connect` mode workaround
