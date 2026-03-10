# Task 039: Brain maxWait Timeout

**Epic:** 02 — LiveKit Agent
**Status:** Open
**Priority:** Medium
**Origin:** Field test BUG-008 (2026-03-10)

## Problem

When OpenClaw takes an extremely long time or hangs indefinitely, the agent stays in
`thinking` state forever. The user sees the pondering animation and receives no feedback
about what's happening. There is no recovery path — the agent is stuck until the session
is manually restarted.

BUG-005 documented a 45s+ thinking hang. In practice, hung or slow brain responses appear
to be intermittent but recurring, especially under load.

The BUG-007 fix (reset idle timer on `thinking` entry) prevents false idle sleeps, but
doesn't bound the wait time. A hung stream can lock the agent indefinitely.

## Goal

Add a configurable `maxWait` timeout for brain responses. If no LLM tokens arrive within
`FLETCHER_BRAIN_MAX_WAIT_MS` (default: 60000 = 60s), the pending request should be
cancelled and the user should receive a clear error artifact so they know to retry.

## Acceptance Criteria

- [ ] New env var `FLETCHER_BRAIN_MAX_WAIT_MS` (default: `60000`, `0` = disabled)
- [ ] When agent enters `thinking`, a `maxWait` countdown starts
- [ ] If the first LLM token arrives before `maxWait`, the countdown is cancelled (no-op)
- [ ] If `maxWait` expires with no tokens received:
  - Cancel / abort the pending LLM stream
  - Publish an error artifact to the client: `"Brain timed out — please try again"`
  - Return agent to `listening` state
- [ ] Server logs a warning: `"Brain maxWait exceeded — aborting LLM stream"`
- [ ] The agent remains usable after a timeout (next user input works normally)

## Implementation Options

### Option A: Stream-level timeout in `OpenClawChatStream` (preferred)
Add a `maxWait` option to `OpenClawChatStream` in `livekit-agent-ganglia`.
The stream itself throws a timeout error if no data arrives within the window.
This is self-contained and testable at the ganglia layer.

### Option B: `setTimeout`-based abort in `agent.ts`
On `thinking` entry, start a `setTimeout`. Cancel it when the first `onContent` fires.
If it fires, call `session.interrupt()` or `session.generateReply` to reset the pipeline,
then publish the error artifact manually.

Option A is cleaner but requires ganglia changes. Option B is quicker to ship.

## Related

- BUG-005: Infinite Pondering Loop — `docs/field-tests/20260310-buglog.md`
- BUG-007: Agent attempts sleep during Thinking — fixed by resetting idle timer on `thinking` entry
- `packages/livekit-agent-ganglia/src/` — OpenClawChatStream implementation
- `apps/voice-agent/src/agent.ts` — AgentStateChanged handler, thinking state
