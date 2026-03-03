# Task: Handle "Queue is closed" error gracefully during user interruption

## Problem

When a user interrupts the agent while the LLM stream response is in-flight, Ganglia's `OpenClawChatStream.run()` tries to `put()` chunks into an already-closed queue. The `@livekit/agents` SDK treats this as a non-recoverable `llm_error` and kills the entire `AgentSession`. After 3 rapid interruptions (the default `maxUnrecoverableErrors`), the session is permanently destroyed.

**Field test references:** BUG-019 in [20260302-buglog.md](../../docs/field-tests/20260302-buglog.md) and [20260303-buglog.md](../../docs/field-tests/20260303-buglog.md)

---

## Investigation

### Theory 1: `run()` pushes to a queue that gets closed during interruption

Initial theory: the SDK closes the queue when the pipeline is interrupted, and `run()` doesn't handle that. This is correct, but the deeper question is *which* queue and *why*.

### Grounding in code: The two-queue architecture

The `LLMStream` base class (`@livekit/agents` v1.0.48, `src/llm/llm.ts`) has **two** queues:

```typescript
// llm.ts lines 100-101
protected output = new AsyncIterableQueue<ChatChunk>();  // EXTERNAL — consumers iterate this
protected queue = new AsyncIterableQueue<ChatChunk>();   // INTERNAL — subclasses should push here
```

The intended data flow is:

```
run() --> this.queue.put(chunk) --> monitorMetrics() reads from this.queue --> this.output.put(ev) --> consumers
```

The `monitorMetrics()` method (lines 208-273) reads from `this.queue`, copies each event to `this.output`, and collects timing/usage metrics (TTFT, tokens/sec, etc.). When the stream is aborted, `monitorMetrics()` checks `this.abortController.signal.aborted` and breaks out of its loop (line 216-218).

The abort signal handler (lines 129-133) closes `this.output` — the *external* queue:

```typescript
this.abortController.signal.addEventListener('abort', () => {
    this.output.close();   // closes EXTERNAL queue
    this.closed = true;
});
```

And `this.queue` (the *internal* queue) is closed later, in the `finally` of the constructor's `startSoon()`:

```typescript
// line 139
startSoon(() => this.mainTask().finally(() => this.queue.close()));
```

This is the key insight: **`this.queue` stays open during the abort, while `this.output` is closed immediately.**

### The actual bug: pushing to `this.output` instead of `this.queue`

Our `OpenClawChatStream.run()` in `packages/livekit-agent-ganglia/src/llm.ts` line 383:

```typescript
this.output.put(chatChunk);  // BUG: pushes to EXTERNAL queue directly
```

This **bypasses** the internal queue entirely. When the pipeline is interrupted:

1. `LLMStream.close()` is called (line 296-298), which calls `this.abortController.abort()`
2. The abort handler fires, calling `this.output.close()` (line 131)
3. `run()` is still processing HTTP chunks from the in-flight OpenClaw response
4. `run()` calls `this.output.put(chatChunk)` — **throws "Queue is closed"**

If `run()` had pushed to `this.queue` instead, the abort would close `this.output` but `this.queue` would remain open. The `monitorMetrics()` loop would see the abort signal and break. `this.queue` would be closed later by the `finally` block after `run()` finishes. No error.

### Theory revised: Two bugs, not one

**Bug A (primary):** `run()` pushes to `this.output` instead of `this.queue`. This bypasses the two-queue safety architecture that the SDK designed specifically to decouple subclass writes from consumer-side closures.

**Bug B (secondary):** `run()` has no abort signal checking. Even if we fix Bug A, `run()` should check `this.abortController.signal.aborted` to exit early rather than continuing to fetch and process HTTP chunks for a cancelled request.

**Bug C (tertiary):** `run()` calls `this.output.close()` in its `finally` block (line 395). This is wrong because the base class `monitorMetrics()` already calls `this.output.close()` after draining `this.queue` (line 229). With Bug A fixed, the Ganglia `finally` block would race with `monitorMetrics()` — both trying to close `this.output`. The `AsyncIterableQueue.close()` just pushes a sentinel, so double-close is a no-op functionally, but it's semantically wrong and could drop chunks that `monitorMetrics()` hasn't forwarded yet.

### Verifying: How the error kills the session

The error propagation chain, verified in code:

1. `run()` throws `Error("Queue is closed")` — **not** an `APIError`
2. `_mainTaskImpl` catches it (llm.ts lines 160-188):
   ```typescript
   } else {
       this.emitError({ error: toError(error), recoverable: false });  // line 185
       throw error;                                                      // line 186
   }
   ```
   Since it's not an `APIError`, it hits the `else` branch → emitted as **non-recoverable**
3. `AgentActivity.onError()` forwards to `AgentSession._onError()` (agent_activity.ts line 632)
4. `_onError()` increments `llmErrorCounts` (agent_session.ts line 788)
5. When `llmErrorCounts > maxUnrecoverableErrors` (default: 3), it calls `closeImpl(CloseReason.ERROR)` (line 799)
6. Error counts only reset when the agent reaches `'speaking'` state (line 827)

In the 03-03 field test, the user interrupted 3 times in 7 seconds ("specific", "screenshots or resources", "design artifacts"). Each interruption triggered a "Queue is closed" error. The counter hit 3 before any successful speak cycle could reset it → permanent session death.

### Side-effect: broken metrics

Because `run()` pushes directly to `this.output`, the `monitorMetrics()` loop (which reads from `this.queue`) never receives any chunks. This means LLM metrics like TTFT, completion tokens, and tokens/sec are always 0/-1. Fixing Bug A by pushing to `this.queue` will also fix metrics collection.

---

## Proposed Fix

All changes in `packages/livekit-agent-ganglia/src/llm.ts`, within the `OpenClawChatStream` class.

### Change 1: Push to `this.queue` instead of `this.output`

Line 383, change:
```typescript
this.output.put(chatChunk);
```
to:
```typescript
this.queue.put(chatChunk);
```

This routes chunks through the SDK's intended two-queue pipeline, where `monitorMetrics()` acts as the intermediary and respects the abort signal.

### Change 2: Add abort signal check + try/catch safety net

Wrap the chunk processing loop with an abort check and a catch for queue-closed errors. This handles the edge case where `this.queue` gets closed by the `finally` in `mainTask()` during a race:

```typescript
for await (const chunk of stream) {
    // Exit early if the stream has been aborted (e.g. user interruption)
    if (this.closed) {
        dbg.openclawStream('stream closed, exiting run() loop');
        break;
    }

    // ... existing chunk processing (lines 328-373) ...

    try {
        this.queue.put(chatChunk);
    } catch (e) {
        if (e instanceof Error && e.message === 'Queue is closed') {
            dbg.openclawStream('queue closed during put (expected during interruption)');
            break;
        }
        throw e;
    }
}
```

### Change 3: Remove `this.output.close()` from the finally block

Line 395, remove:
```typescript
this.output.close();
```

The base class `monitorMetrics()` already closes `this.output` after it finishes draining `this.queue` (llm.ts line 229). Calling it from `run()`'s `finally` bypasses the metrics pipeline and can cause chunks to be dropped.

Updated finally block:
```typescript
finally {
    if (ponderingTimer) {
        clearInterval(ponderingTimer);
    }
    this._onPondering?.(null, this._streamId);
    // NOTE: Do NOT close this.output here. The base class monitorMetrics() method
    // handles closing this.output after draining this.queue. Closing it here would
    // bypass metrics collection and could drop in-flight chunks.
}
```

### Summary of changes

| What | Before | After | Why |
|------|--------|-------|-----|
| Line 383 | `this.output.put(chatChunk)` | `this.queue.put(chatChunk)` | Use internal queue (abort-safe) |
| Line 327 | — | `if (this.closed) break;` | Early exit on abort |
| Line 383 | bare `put()` | try/catch for "Queue is closed" | Safety net for race conditions |
| Line 395 | `this.output.close()` | removed | Base class handles it via `monitorMetrics()` |

---

## Edge Cases

**Rapid interruptions (the 03-03 scenario):** With the fix, each interruption closes `this.output` via the abort signal. `run()` sees `this.closed === true` and breaks out of the loop. No error is emitted. The pipeline starts fresh for the next turn. Even 10 rapid interruptions would not accumulate any error counts.

**Slow HTTP response arriving after abort:** The `for await` on the HTTP stream may block waiting for the next chunk. The `this.closed` check runs before each `put()`, so as soon as the next chunk arrives, `run()` will check and exit. In the worst case, the `mainTask().finally(() => this.queue.close())` will close `this.queue` after the cancellation timeout (5s), and the try/catch on `put()` handles that.

**Double-close of `this.output`:** After removing the `this.output.close()` from Ganglia's finally, there are still two potential closers: the abort signal handler and `monitorMetrics()`. Both are idempotent — `close()` just pushes the close sentinel again, which is harmless.

**Metrics accuracy:** Chunks that `run()` pushes to `this.queue` before the abort will be forwarded to `this.output` by `monitorMetrics()` and included in timing metrics. Chunks pushed after the abort but before `run()` checks `this.closed` will be in `this.queue` but `monitorMetrics()` will break before reading them (it checks the abort signal first). These are correctly treated as cancelled.

---

## Acceptance Criteria

- [x] User can interrupt the agent mid-response without killing the session
- [x] After interruption, the agent returns to "listening" state and processes the next turn normally
- [x] Rapid interruptions (3+ in quick succession) do not accumulate unrecoverable errors
- [x] LLM metrics (TTFT, tokens/sec) are correctly reported (no longer always 0/-1)
- [x] Unit test: verify `run()` exits cleanly when stream is closed mid-processing
- [x] Unit test: verify non-queue errors still propagate correctly
- [ ] Field test: interrupt agent 5+ times in a session, verify session survives

## Files

- `packages/livekit-agent-ganglia/src/llm.ts` — `OpenClawChatStream.run()` method (primary)
- `packages/livekit-agent-ganglia/src/llm.spec.ts` — unit tests

## Priority

**Critical** — This is the top open bug. It causes permanent session death on a normal user action (interrupting the agent). Triggered in both the 03-02 and 03-03 field tests.

## Status
- **Date:** 2026-03-03
- **Priority:** Critical
- **Status:** Code complete — awaiting field test verification
