# TASK-067: Fix large payload delivery failure in relay

**Status:** [ ] Not started
**Priority:** High
**Epic:** 22 (Dual-Mode Architecture)
**Origin:** BUG-024 (field test 2026-03-14, 00:15 PDT)

## Problem

Long assistant responses (e.g., a task rundown ~1.5KB) appear in the OpenClaw
web UI but are not delivered to the mobile client via the relay bridge. Short
messages (like "Loud and clear") work fine.

User impact: forced to check the web UI to see full responses — communication
loop breaks for complex information.

## Investigation

### Theory 1: Data channel payload size limit — REFUTED

Initial hypothesis was a WebRTC data channel or ACP JSON-RPC buffer size
limit. However:

- The `forwardToMobile()` method (`relay-bridge.ts:508-538`) has **no payload
  size limit** (unlike `forwardToVoiceAgent()` which has a 15KB cap at line 462).
- `sendToRoomOnTopic()` (`room-manager.ts:179-204`) uses `publishData({ reliable: true })`
  with a 5-second timeout — no size restriction.
- WebRTC SCTP data channels support messages up to ~64KB.
- The ~1.5KB payload is well under all limits.

Payload size is not the cause.

### Theory 2: ACP subprocess returns result with zero notifications — CONFIRMED

The relay log from 00:15:05 tells the full story:

```
00:15:05.884  mobile_prompt_received  "you still there?"
00:15:05.884  session_prompt          sent to ACP
00:15:05.997  session_prompt_result   stopReason: "end_turn"    ← 113ms!
00:15:05.997  mobile_prompt_completed stopReason: "end_turn"
00:15:05.997  zero_text_prompt        promptChunkCount === 0
00:15:05.997  catch_up_start          skipCount: 9
00:15:06.011  catch_up_complete       newChunks: -4             ← BROKEN
```

**Key evidence:**

1. **113ms response time.** The ACP subprocess returned `end_turn` in 113ms
   with **zero `agent_message_chunk` notifications**. A genuine LLM response
   would take 500ms-2s minimum. The response content exists in OpenClaw
   (visible in web UI) but was never streamed to the relay via stdio.

2. **This is the BUG-022 failure mode for regular prompts.** Originally
   BUG-022 was scoped to sub-agent results, but the same upstream bug
   (openclaw/openclaw#40693) also affects regular prompts — the ACP dispatch
   path sometimes returns the result without streaming notifications first.

3. **The catch-up mechanism was triggered but failed** — see Theory 3.

### Theory 3: Catch-up dedup has a counting bug — CONFIRMED (root cause we can fix)

The BUG-022 catch-up triggered correctly (`promptChunkCount === 0` + `end_turn`),
but the dedup logic failed:

```
catchUpSkipCount = forwardedChunkCount = 9
loadSession replayed 5 agent_message_chunk events

Chunk 1: catchUpChunksSeen=1  ≤ 9  → SKIP
Chunk 2: catchUpChunksSeen=2  ≤ 9  → SKIP
Chunk 3: catchUpChunksSeen=3  ≤ 9  → SKIP
Chunk 4: catchUpChunksSeen=4  ≤ 9  → SKIP
Chunk 5: catchUpChunksSeen=5  ≤ 9  → SKIP

Result: newChunks = 5 - 9 = -4 (ALL chunks skipped!)
```

**Why `forwardedChunkCount` drifts from the actual session history:**

The count-based dedup assumes `forwardedChunkCount` matches the number of
`agent_message_chunk` events that `loadSession` will replay. This invariant
breaks because:

1. **Previous catch-up rounds inflate the count.** When a catch-up forwards
   "new" chunks (the async sub-agent result), it increments `forwardedChunkCount`
   (line 161). But those chunks were already in the session history — the next
   `loadSession` call won't add extra entries for them. So the count grows
   faster than the history.

2. **Session history may not replay all chunks.** OpenClaw's `session/load`
   may return a subset of the original chunks (due to session compaction,
   or because some chunks were transient metadata not persisted).

3. **The mock-acpx test hides this.** The test mock (`mock-acpx.ts:54-68`)
   appends each async result to `chunkHistory` during `loadSession`, so the
   mock's history grows in lockstep with `forwardedChunkCount`. Real OpenClaw
   doesn't behave this way — the session history is stored by the server, not
   by the relay.

**Result:** The dedup over-skips, treating ALL replayed chunks as
"already forwarded." Genuinely new content (the missing response) is
silently dropped. The catch-up mechanism is effectively broken after
the first successful catch-up round.

### Theory 4: Result-before-chunks ordering race — NOT TRIGGERED HERE, but a latent risk

The mobile client closes its stream immediately upon receiving the result
(`relay_chat_service.dart:208-210`). If the relay sends the result BEFORE
some `session/update` chunks (due to ACP sending the result on a separate
stdout buffer), those late chunks would be silently dropped:

```dart
void _handlePromptResult(JsonRpcResponse response) {
  _activeStream?.close();  // closes the stream
  _activeStream = null;    // subsequent chunks → _activeStream?.add() → no-op
  _activeRequestId = null;
}
```

The relay's `sendQueue` serialization prevents this for chunks in the same
`readLoop()` iteration (they're queued before the `.then()` microtask runs
for the result). But if the ACP subprocess flushes the result in a separate
write buffer from the notifications, the relay would read the result first,
queue it, then read the notifications — wrong order.

This race was NOT the trigger for BUG-024 (the logs show zero chunks, not
out-of-order chunks), but it's a latent reliability risk for long responses
where many chunks may arrive across multiple `readLoop()` iterations.

### Root cause summary

| Factor | Impact |
|--------|--------|
| **Upstream ACP bug** (openclaw#40693) | Agent response exists but zero `session/update` notifications streamed to relay |
| **Catch-up dedup counting bug** | `forwardedChunkCount` (9) > actual replay chunks (5) → all chunks skipped → recovery fails |
| **Insufficient relay logging** | LOG_LEVEL=info hides chunk-level detail; can't verify forwarding without debug level |

## Proposed Fix

### Fix 1: Replace count-based dedup with content-based dedup

The current approach tracks `forwardedChunkCount` and skips that many chunks
during catch-up. Replace with content fingerprinting:

**File:** `apps/relay/src/bridge/relay-bridge.ts`

Replace the counter-based state:
```ts
// REMOVE:
private forwardedChunkCount = 0;
private catchUpSkipCount = 0;
private catchUpChunksSeen = 0;

// ADD:
/** Running concatenation of all agent text forwarded, for catch-up dedup. */
private forwardedAgentText = "";
/** Accumulated text during catch-up replay, for comparison. */
private catchUpAccumulatedText = "";
```

Update the normal-path handler (line 172-176):
```ts
// Normal (non-catch-up) path
if (isAgentChunk) {
  this.promptChunkCount++;
  const text = this.extractChunkText(params);
  if (text) this.forwardedAgentText += text;
}
```

Update the catch-up handler (line 150-170):
```ts
if (this.inCatchUp) {
  if (isAgentChunk) {
    const text = this.extractChunkText(params);
    if (text) this.catchUpAccumulatedText += text;
    // Only forward content beyond what we've already forwarded
    if (this.catchUpAccumulatedText.length <= this.forwardedAgentText.length) {
      this.log.debug({ event: "catch_up_skip_known" }, "skipping already-forwarded content");
      return;
    }
    // New content found — forward it
    this.forwardedAgentText = this.catchUpAccumulatedText;
  } else {
    this.log.debug({ event: "catch_up_skip_metadata" }, "skipping non-chunk during catch-up");
    return;
  }
  this.forwardToMobile({ jsonrpc: "2.0", method: "session/update", params });
  return;
}
```

Update `catchUpSession()` (line 280-312):
```ts
private async catchUpSession(): Promise<void> {
  // ... existing guards ...
  this.inCatchUp = true;
  this.catchUpAccumulatedText = "";
  const textBefore = this.forwardedAgentText.length;
  // ... existing try/catch ...
  this.log.info({
    event: "catch_up_complete",
    newChars: this.forwardedAgentText.length - textBefore,
  }, "loadSession catch-up complete");
}
```

Add helper method:
```ts
private extractChunkText(params: SessionUpdateParams): string | null {
  const update = (params as any).update;
  if (update?.sessionUpdate !== "agent_message_chunk") return null;
  const content = update?.content;
  if (content?.type !== "text" || typeof content?.text !== "string") return null;
  return content.text;
}
```

### Fix 2: Set LOG_LEVEL=debug as relay development default

**File:** `apps/relay/.env.example` (or however relay env is configured)

```
LOG_LEVEL=debug
```

This ensures chunk-level events (`acp_update_received`, `forward_to_mobile`,
`catch_up_skip`) are visible during development and field tests.

### Fix 3: Add INFO-level delivery diagnostics

**File:** `apps/relay/src/bridge/relay-bridge.ts`

In `forwardToMobile()` (line 508-538), add INFO-level logging for successful
deliveries (currently only errors are logged at INFO+):

```ts
private forwardToMobile(msg: object): void {
  if (!this.started) return;

  const method = (msg as any).method ?? (msg as any).result ? "result" : "unknown";
  const payloadSize = JSON.stringify(msg).length;

  this.log.debug({ event: "forward_to_mobile", msg }, "→ mobile");

  this.sendQueue = this.sendQueue.then(() =>
    this.options.roomManager
      .sendToRoom(this.options.roomName, msg)
      .then(() => {
        this.forwardFailures = 0;
        this.log.info({
          event: "forward_to_mobile_ok",
          method,
          payloadSize,
        }, "→ mobile delivered");
      })
      // ... existing .catch ...
  );
}
```

This makes delivery success visible at INFO level without requiring debug mode
for basic monitoring.

## Edge Cases

- **Content-based dedup with identical chunks:** If two different agent messages
  contain the exact same text prefix, the dedup would incorrectly skip the second
  one. In practice, this is extremely unlikely for agent responses (the session
  context ensures unique content). If needed, include the sessionUpdate `kind` and
  position in the comparison.

- **Very large session history:** The `forwardedAgentText` string grows
  unboundedly across the session. For a typical session (~50 prompts, ~100KB
  total text), this is negligible. For extreme sessions, consider using a
  rolling hash instead of full text concatenation.

- **Catch-up during mobile disconnect:** If mobile disconnects while catch-up
  forwards new chunks, the `publishData` calls will fail (logged but not fatal).
  When mobile reconnects, the user can resend the prompt.

- **Multiple zero-text prompts in a row:** Each triggers a catch-up with a fresh
  `catchUpAccumulatedText = ""`. The content comparison correctly handles this —
  it rebuilds from the replay and compares against the running total.

## Acceptance Criteria

- [ ] `newChunks` is never negative after catch-up (the counting bug is gone)
- [ ] Catch-up correctly forwards missing content even after multiple prompt rounds
- [ ] Existing BUG-022 tests still pass (4 tests in relay-bridge.spec.ts)
- [ ] New test: catch-up dedup works after multiple rounds (reproduces the skipCount drift)
- [ ] Field test: relay debug logs visible during testing (`LOG_LEVEL=debug`)
- [ ] Field test: long agent response delivered to mobile after fix

## Files

- `apps/relay/src/bridge/relay-bridge.ts` — dedup mechanism rewrite + INFO-level delivery logs
- `apps/relay/src/bridge/relay-bridge.spec.ts` — new test for multi-round catch-up dedup drift
- `packages/acp-client/test/mock-acpx.ts` — may need update if test relies on chunk counting

## Related

- **BUG-022 / TASK-066:** Async agent message gap — same upstream cause, existing workaround with the broken dedup
- **BUG-020 / TASK-065:** Silent message loss in relay→mobile path — different root cause (WebRTC transport), already fixed
- **Upstream:** [openclaw/openclaw#40693](https://github.com/openclaw/openclaw/issues/40693) — ACP dispatch doesn't stream notifications

## Date

2026-03-14
