# TASK-078: Remove Auto-Dispatch — Voice Agent Joins Only on Demand

**Epic:** 26 — Voice Mode Consolidation
**Status:** [ ]
**Priority:** High

## Problem

The token server embeds `RoomAgentDispatch` in every JWT (`token-server.ts:83-88`), causing the voice agent to auto-join every room on participant connect — even for text/chat-only users. This wastes agent-minutes ($0.01/min per connected agent) and conflicts with the on-demand dispatch architecture (Epic 20).

The on-demand dispatch path (`POST /dispatch-agent`) already exists and works. The auto-dispatch in the JWT is redundant.

## Solution

1. **Token server** — Remove `RoomAgentDispatch` from JWT generation. Tokens grant room access only; agent dispatch happens explicitly via `POST /dispatch-agent`.

2. **Mobile client** — Defer `agentPresenceService.enable()` from room connect to voice mode activation. Text-only users never trigger agent dispatch.

3. **Agent presence service** — Fix `disable()` to set state to `agentAbsent` (no agent needed) instead of `agentPresent` (legacy assumption that token always dispatches).

## Files Changed

| File | Change |
|------|--------|
| `scripts/token-server.ts` | Remove `RoomConfiguration`/`RoomAgentDispatch` imports and JWT embedding |
| `scripts/token-server.spec.ts` | Rewrite test to assert no `roomConfig`; remove auto-dispatch-specific tests |
| `apps/mobile/lib/services/livekit_service.dart` | Move `enable()` to voice mode toggle; add `disable()` on voice→text |
| `apps/mobile/lib/services/agent_presence_service.dart` | Fix `disable()` state: `agentPresent` → `agentAbsent` |

## Verification

- [ ] `bun test scripts/token-server.spec.ts` — all tests pass
- [ ] App connects without agent auto-joining
- [ ] Entering voice mode dispatches agent via `POST /dispatch-agent`
- [ ] Text-only chat works with relay, no agent present
