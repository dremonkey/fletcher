# TASK-068: Relay Safety Net — Auto-Dispatch on Orphaned Response

**Status:** [ ] Not started
**Priority:** LOW (edge case — hold mode prevents the primary scenario)
**Epic:** 22 — Dual-Mode Architecture

## Problem

If the voice agent crashes or disconnects unexpectedly mid-request (not via hold mode), the relay may receive a `session/update` from ACP with no voice agent in the room to deliver it. Currently that response is lost.

## Proposed Solution

The relay detects "I have a `session/update` but no agent participant in the room" and calls `POST /dispatch-agent` to bring a fresh agent in. The agent joins, relay forwards the pending response, and the user hears it.

### Detection Logic

1. Relay receives `session/update` notification from ACP subprocess
2. Relay checks if any agent participant (kind=AGENT) is in the room
3. If no agent: buffer the response, call dispatch endpoint
4. New agent joins → relay forwards buffered response via `voice-acp` data channel

### Edge Cases

- Relay must distinguish "agent is absent" from "agent is mid-disconnect" (hold mode's 500ms grace)
- Race condition: dispatch takes 2-3s, more ACP responses may arrive — buffer all
- If dispatch fails (server down, no workers), surface error to client

## Why Deferred

Hold mode's graceful disconnect prevents the primary scenario. The agent clears the hold timer during `thinking`/`speaking`, so it won't disconnect while actively processing. This task catches edge cases that hold mode cannot: agent crashes, SDK bugs, network partitions.

## Dependencies

- Hold mode (TASK-011, Epic 20) — must be implemented first (done)
- Relay participant tracking — relay already tracks room participants
- Dispatch endpoint — `POST /dispatch-agent` already exists
