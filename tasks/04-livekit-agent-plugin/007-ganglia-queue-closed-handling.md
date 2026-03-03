# Task: Handle "Queue is closed" error gracefully during user interruption

## Problem

When a user interrupts the agent while the LLM stream response is in-flight, Ganglia's `OpenClawChatStream.run()` tries to `put()` chunks into an already-closed output queue. The `@livekit/agents` SDK treats this as a non-recoverable `llm_error` and kills the entire `AgentSession`.

**Field test reference:** [BUG-019](../../docs/field-tests/20260302-buglog.md)

## Root Cause

In `packages/livekit-agent-ganglia/src/llm.ts`, the `run()` method processes HTTP response chunks and calls `this.queue.put()` for each one. When the user interrupts:

1. The SDK aborts all pipeline tasks and closes the output queue
2. The OpenClaw HTTP response is still in-flight (network latency)
3. When the response arrives, `run()` calls `queue.put()` → throws `Error: Queue is closed`
4. The error propagates up as a non-recoverable `llm_error`
5. `AgentSession` shuts down permanently

## Fix

Wrap the `queue.put()` call in `run()` with a try/catch that detects queue-closed errors and exits cleanly:

```typescript
try {
  this.queue.put(chunk);
} catch (e) {
  if (e instanceof Error && e.message === 'Queue is closed') {
    // Expected during user interruption — exit cleanly
    break;
  }
  throw e;
}
```

This matches the existing `DEBUG: Queue closed (expected during disconnect)` log pattern already in the codebase.

## Acceptance Criteria

- [ ] User can interrupt the agent mid-response without killing the session
- [ ] After interruption, the agent returns to "listening" state and processes the next turn normally
- [ ] Unit test: verify `run()` exits cleanly when queue is closed mid-stream
- [ ] Unit test: verify non-queue errors still propagate correctly
- [ ] Field test: interrupt agent 5+ times in a session, verify session survives

## Files

- `packages/livekit-agent-ganglia/src/llm.ts` — `OpenClawChatStream.run()` method
- `packages/livekit-agent-ganglia/src/llm.spec.ts` — unit tests

## Priority

**High** — This is the most impactful open bug. It causes permanent session death on a normal user action (interrupting the agent).

## Status
- **Date:** 2026-03-02
- **Priority:** High
- **Status:** Not started
