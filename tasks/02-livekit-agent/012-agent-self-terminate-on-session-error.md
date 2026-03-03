# Task: Agent should self-terminate on unrecoverable AgentSession error

## Problem

When `AgentSession` closes with `reason: "error"`, the agent process stays in the room as a participant but with a dead voice pipeline. This "zombie agent" blocks LiveKit from dispatching a new agent, so users who force-quit and reconnect get a room with a braindead agent that never responds — despite diagnostics showing green.

**Field test reference:** [BUG-020](../../docs/field-tests/20260302-buglog.md)

## Root Cause

In `apps/voice-agent/src/agent.ts`, there is no handler for `AgentSession` closing with an error. The session dies but the agent's room connection persists. Combined with the 120s `departure_timeout` (added for BUG-015), the zombie agent occupies the room for up to 2 minutes, blocking recovery.

The cascade:
1. BUG-019 (or any unrecoverable error) kills the AgentSession
2. Agent process stays connected to the room
3. User force-quits app, reconnects to same room (`fletcher-dev`)
4. LiveKit sees agent already present → no new dispatch
5. Diagnostics green, but agent is dead

## Fix

Listen for `AgentSession` close events in `agent.ts`. When the session closes with `reason: "error"`:

1. Log the error clearly
2. Disconnect from the room (so LiveKit can clean up and dispatch a fresh agent on next join)

```typescript
session.on('close', (reason, error) => {
  if (reason === 'error') {
    logger.error({ error }, 'AgentSession died — disconnecting from room to allow fresh dispatch');
    // Disconnect from room so LiveKit can dispatch a new agent
    room.disconnect();
  }
});
```

### Alternative: session restart

A more advanced approach would be to restart the `AgentSession` in-place rather than disconnecting. This would preserve the room and provide seamless recovery. However, the `@livekit/agents` SDK may not support restarting a session on the same room connection — investigate feasibility.

## Acceptance Criteria

- [ ] Agent disconnects from room when AgentSession closes with `reason: "error"`
- [ ] After agent disconnects, user reconnect triggers fresh agent dispatch
- [ ] User-initiated session close (`reason: "user_initiated"`) does NOT trigger disconnect (normal flow)
- [ ] Test: simulate session error, verify agent leaves room within 5s
- [ ] Field test: trigger BUG-019, force-quit app, reconnect — verify fresh agent responds

## Files

- `apps/voice-agent/src/agent.ts` — session close handler

## Priority

**High** — Without this fix, BUG-019 (and any future session errors) leave users stuck with a zombie agent until the departure_timeout expires.

## Status
- **Date:** 2026-03-02
- **Priority:** High
- **Status:** Not started
