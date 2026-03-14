# TASK-066: Bridge async agent messages to mobile via relay

**Status:** [ ] Not started
**Priority:** High
**Epic:** 22 (Dual-Mode Architecture)
**Origin:** BUG-022 (field test 2026-03-13, 21:10 PDT)

## Problem

When an OpenClaw sub-agent (e.g., Static) completes a background task and posts
results to the conversation, the message appears in the OpenClaw web UI but
**never reaches the mobile client** through the relay bridge.

From the user's perspective, the agent says "I just sent the summary" but the
summary never arrives on their phone. The relay has zero errors — it doesn't
even know the message exists.

## Investigation

### Theory 1: Same transport failure as BUG-020 — REFUTED

BUG-022 was initially filed as "a second instance of the silent push failure"
(BUG-020). BUG-020's root cause was asymmetric WebRTC data channel degradation
where `publishData` succeeded but the data never reached mobile.

The task-065 fix (commit `8074a81`) was deployed at 20:25 PDT. The relay
restarted at 20:36 PDT. BUG-022 occurred at 21:10 PDT — **after the fix**.

The relay log (`logs/relay-2026-03-14.log`) shows:
- **81 `forward_to_mobile` events**, all successful
- **Zero `forward_to_mobile_failed` events**
- **Zero errors or warnings** in the entire session
- The `publishData` timeout (5s) never triggered

The task-065 fix is working correctly. This is a different failure mode.

### Theory 2: ACP subprocess never received the message — CONFIRMED

The conversation in the sage-mushroom room (session `0fe76b49`) proceeded:

| # | Time | Content |
|---|------|---------|
| 8 | ~21:08 | Glitch: "I've just spawned Static... He'll be writing the spec to `ux-silence-scenarios.md`" |
| — | 21:08–21:10 | *Static runs in background. No ACP session/update notifications arrive.* |
| 9 | 21:10:10 | User sends prompt. ACP returns `end_turn` with **NO text** — only `session_info_update` + `usage_update` metadata. 3 messages forwarded. |
| 10 | 21:10:35 | User asks "how much time?" Glitch replies: "He actually moved fast—he's already done! I just sent over his summary, but the timing might have crossed with your message." |
| 11 | later | User: "where is it?" Glitch: "I just posted it right here in our chat! It should be the message immediately preceding your 'how much time' question." |
| 12 | later | Glitch logs BUG-022: "silent delivery failure of my assistant response" |

**Critical evidence:** Between prompt #8 completion and prompt #9 receipt
(the window where Static was running), the relay log shows **ZERO
`session/update` notifications from ACP**. Only room discovery heartbeats
(every 30s). The ACP subprocess never received Static's output.

**File:** `logs/relay-2026-03-14.log`, lines 2100–2348 — 22 minutes of
room discovery events with no ACP activity between the two prompts.

### Theory 3: ACP protocol doesn't push async agent messages — CONFIRMED

The relay's ACP client (`packages/acp-client/src/client.ts`) communicates via
stdio JSON-RPC 2.0. It supports three operations:

1. `session/new` → creates a session (returns only `sessionId`, no history)
2. `session/prompt` → sends prompt, receives response stream
3. `session/update` notifications (pushed by server during prompt processing)

**There is no mechanism to receive async messages:**
- No `session/load` or `session/history` method (despite `loadSession: true`
  in the server's advertised capabilities — `client.ts:113`)
- No polling or subscription for background activity
- `session/update` notifications only arrive during an active prompt cycle

The web UI shows all messages because it has a direct WebSocket connection to
the OpenClaw session feed. The relay is blind to anything not flowing through
the ACP stdio pipe.

**File:** `packages/acp-client/src/client.ts:191-216` — only three session
methods: `sessionNew`, `sessionPrompt`, `sessionCancel`. No load/history.

**File:** `packages/acp-client/src/types.ts:86-88` — `SessionNewResult` returns
only `{ sessionId: string }`, no conversation history.

### Root cause — architectural gap

The relay architecture is a **synchronous request/response bridge**:

```
Mobile → prompt → Relay → ACP → OpenClaw → response → ACP → Relay → Mobile  ✓
```

It does NOT bridge **asynchronous agent output**:

```
Sub-agent finishes → OpenClaw session → Web UI  ✓
                                      → Relay   ✗ (never pushed)
                                      → Mobile  ✗ (relay never saw it)
```

The ACP server advertises `loadSession: true` in its `initialize` response,
indicating the protocol supports session loading. But the relay never uses this
capability — it creates a fresh session and only sees messages that flow through
prompt/response cycles.

### This is NOT BUG-020

| | BUG-020 | BUG-022 |
|---|---------|---------|
| **Layer** | Transport (WebRTC) | Protocol (ACP) |
| **Relay saw the message?** | Yes — forwarded it | No — never received it |
| **publishData error?** | Silent swallow (fixed) | N/A — nothing to publish |
| **Fix** | Logging + timeout (task 065) | Session catch-up mechanism |
| **Root cause** | Asymmetric channel degradation | ACP doesn't push async messages |

## Proposed Fix

### Fix 1: Implement `session/load` in ACP client

**File:** `packages/acp-client/src/client.ts`

Add a `sessionLoad` method that retrieves the current session state, including
any messages not seen through real-time notifications:

```typescript
interface SessionLoadResult {
  sessionId: string;
  messages: Array<{
    role: "user" | "assistant";
    content: ContentPart[];
    timestamp?: string;
    sequenceId?: number;
  }>;
}

async sessionLoad(params: { sessionId: string }): Promise<SessionLoadResult> {
  this.log.info({ event: "session_load", sessionId: params.sessionId }, "loading session state");
  return (await this.request("session/load", params)) as SessionLoadResult;
}
```

**Depends on:** OpenClaw ACP server supporting `session/load`. The server
already advertises `loadSession: true`, so this may already be implemented
server-side.

### Fix 2: Post-prompt catch-up in RelayBridge

**File:** `apps/relay/src/bridge/relay-bridge.ts`

After each prompt completes, check if the session has messages that weren't
forwarded to mobile. This catches async messages that arrived between prompts:

```typescript
// In the prompt completion handler (line 237-244):
.then(async (result) => {
  reqLog.info({ event: "mobile_prompt_completed", stopReason: (result as any).stopReason });
  this.activeRequestSource = null;
  this.forwardToMobile({
    jsonrpc: "2.0",
    id: msg.id,
    result,
  });

  // Catch-up: check for async messages we missed
  await this.catchUpMissedMessages();
})
```

The `catchUpMissedMessages()` method calls `session/load`, compares with a local
sequence counter, and forwards any messages the mobile hasn't seen.

### Fix 3: (Pragmatic alternative) Periodic session poll

If `session/load` is not available or too expensive, add a lightweight periodic
poll that checks a message count or sequence number and alerts when messages are
missed:

**File:** `apps/relay/src/bridge/relay-bridge.ts`

```typescript
private messageSequence = 0;
private pollInterval: Timer | null = null;

private startSessionPoll(): void {
  this.pollInterval = setInterval(async () => {
    if (!this.sessionId || this.activeRequestSource) return;
    // Check for new messages via a lightweight endpoint
    // Forward any that weren't seen through the notification channel
  }, 10_000); // every 10 seconds
}
```

### Fix 4: (Minimal) Log detection of async gap

If the full fix is deferred, at minimum add detection logging so async message
gaps are visible in the relay log. When a prompt response references content
that wasn't part of the current prompt cycle, log a warning:

```typescript
// In the onUpdate handler (line 109):
this.acpClient.onUpdate((params: SessionUpdateParams) => {
  this.log.debug({ event: "acp_update_received", params }, "← acp session/update");
  this.messageSequence++;  // Track messages we've seen
  // ... existing routing logic
});
```

## Edge Cases

- **Session load during active prompt:** Don't call `session/load` while a
  prompt is being processed — it could interfere with the streaming response.
  Only catch up when `activeRequestSource === null`.

- **Duplicate messages:** If `session/load` returns messages that were already
  forwarded via real-time notifications, the mobile would receive duplicates.
  Need a sequence number or message ID to deduplicate.

- **Large session history:** `session/load` might return the entire conversation
  history. The catch-up should only forward messages newer than the last seen
  sequence ID, not replay the whole session.

- **Mobile-side rendering of late messages:** Even if we forward the missed
  message, the mobile needs to handle a message that arrives out of order
  (after the user's follow-up prompt and response). The UI should insert it
  at the correct position in the conversation timeline.

- **ACP server doesn't support `session/load`:** The server advertises
  `loadSession: true` but the actual protocol method may differ. Need to verify
  against OpenClaw's ACP server implementation before building the client.

## Acceptance Criteria

- [ ] `session/load` (or equivalent) implemented in `AcpClient`
- [ ] Relay catches async messages that arrive between prompt cycles
- [ ] Missed messages are forwarded to mobile with correct ordering
- [ ] No duplicate messages when catch-up and real-time overlap
- [ ] Relay log includes a warning when async messages are detected
- [ ] Existing tests still pass

## Files

- `packages/acp-client/src/client.ts` — Add `sessionLoad()` method
- `packages/acp-client/src/types.ts` — Add `SessionLoadResult` type
- `apps/relay/src/bridge/relay-bridge.ts` — Post-prompt catch-up logic
- `apps/relay/src/bridge/relay-bridge.spec.ts` — Tests for catch-up

## Related

- **BUG-020 / TASK-065:** Transport-layer silent failure — different root cause
  but same user-visible symptom. Task 065 is complete.
- **BUG-021:** Session hang at 20:42 PDT — may be related (the user's prompt
  was lost in the hung crimson-tunic session, triggering the switch to
  sage-mushroom where BUG-022 occurred).
- ACP `initialize` response: `agentCapabilities.loadSession: true` — suggests
  the protocol supports session loading, but the client doesn't implement it.

## Date

2026-03-13
