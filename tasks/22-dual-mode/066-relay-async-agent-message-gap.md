# TASK-066: Bridge async agent messages to mobile via relay

**Status:** [~] Workaround implemented — awaiting upstream fix
**Priority:** High
**Epic:** 22 (Dual-Mode Architecture)
**Origin:** BUG-022 (field test 2026-03-13, 21:10 PDT)
**Upstream:** [openclaw/openclaw#40693](https://github.com/openclaw/openclaw/issues/40693)

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

**There is no mechanism to receive async messages** — `session/update`
notifications only arrive during an active prompt cycle. The web UI shows all
messages because it has a direct WebSocket connection to the OpenClaw session
feed. The relay is blind to anything not flowing through the ACP stdio pipe.

**However**, the server advertises `loadSession: true` and supports the ACP
`session/load` method, which replays the full session history as
`session/update` notifications. This enables a catch-up workaround (see below).

### Root cause — upstream bug in OpenClaw ACP dispatch

The relay architecture already handles async pushes correctly — the `onUpdate`
handler (relay-bridge.ts:109-116) forwards `session/update` notifications to
mobile regardless of `activeRequestSource` state. If the ACP server pushed
the sub-agent result, the relay would forward it automatically.

**The server never pushes it.** This is tracked upstream as
[openclaw/openclaw#40693](https://github.com/openclaw/openclaw/issues/40693):

> ACP sessions spawned via `sessions_spawn({ runtime: "acp" })` never trigger
> the auto-announce flow to the parent session.
>
> Standard subagent runs go through `runEmbeddedPiAgent` → emits
> `{ stream: "lifecycle", phase: "end" }` → triggers `completeSubagentRun` →
> `runSubagentAnnounceFlow` → announces to parent.
>
> **ACP sessions take a different code path:** `tryDispatchAcpReply` →
> `acpManager.runTurn()` → calls `recordProcessed("completed")` and
> `markIdle("message_completed")` — **it never emits the `lifecycle` event.**
> So the subagent registry listener never fires → no announce.

Related upstream issues:
- [#38626](https://github.com/openclaw/openclaw/issues/38626) — Subagent
  lifecycle observability + async supervision controls (feature request)
- [#40907](https://github.com/openclaw/openclaw/issues/40907) — Channel-level
  async streaming: messages queued until entire agent run completes
- [#33859](https://github.com/openclaw/openclaw/issues/33859) — ACP sessions
  inherit parent delivery context, ignoring `acp.delivery.mode`

### This is NOT BUG-020

| | BUG-020 | BUG-022 |
|---|---------|---------|
| **Layer** | Transport (WebRTC) | Protocol (ACP) |
| **Relay saw the message?** | Yes — forwarded it | No — never received it |
| **publishData error?** | Silent swallow (fixed) | N/A — nothing to publish |
| **Fix** | Logging + timeout (task 065) | Upstream: emit lifecycle event |
| **Root cause** | Asymmetric channel degradation | ACP dispatch skips announce |

## Proposed Fix

### Primary fix: Upstream (openclaw/openclaw#40693)

The OpenClaw ACP dispatch path needs to emit the `lifecycle` event with
`phase: "end"` when an ACP session completes. This triggers the existing
announce flow, which pushes the result as a `session/update` notification
to the parent session's ACP client (our relay).

**No relay-side changes needed.** The relay's `onUpdate` handler already
forwards all `session/update` notifications to mobile. Once the server
pushes them, they'll flow through automatically.

**Action:** Monitor #40693 for resolution. Once fixed, verify with a field
test that sub-agent results arrive on mobile.

### Workaround: `session/load` catch-up — IMPLEMENTED ✅

Commit `0ff20c5` implements a catch-up workaround using the ACP `session/load`
method ([spec](https://agentclientprotocol.com/protocol/session-setup)).

#### How it works

1. **Chunk counting:** The relay counts `agent_message_chunk` events per prompt
   cycle (`promptChunkCount`) and across the session (`forwardedChunkCount`).

2. **Trigger:** When a prompt completes with `stopReason === "end_turn"` and
   `promptChunkCount === 0`, the relay logs a warning and calls `catchUpSession()`.

3. **Catch-up:** Calls `session/load` (ACP spec method, requires `sessionId`,
   `cwd`, `mcpServers`). The server replays the full session history as
   `session/update` notifications.

4. **Dedup:** The `onUpdate` handler skips the first `forwardedChunkCount`
   `agent_message_chunk` events (already forwarded) and forwards only genuinely
   new content. Non-chunk metadata updates are also skipped during catch-up.

5. **Guards:** Catch-up is skipped if no sessionId, another prompt is active
   (`activeRequestSource !== null`), or catch-up is already in progress.

#### Trigger signal analysis

Log analysis across 48 completed prompts (two field-test sessions):

| Metric | Value |
|--------|-------|
| Total completed prompts analyzed | 48 |
| Zero-text prompts detected | 6 (12.5%) |
| Confirmed BUG-022 instances caught | 1/1 (100%) |
| False negatives | 0 |
| Worst-case false positives | 5 (~10%) |

False positives are tool-only turns or reconnection artifacts. Each costs one
unnecessary `session/load` call — no user-visible harm with dedup in place.

#### Verified against real OpenClaw

Tested `session/load` against `agent:main:relay:sage-mushroom` (58k tokens):
- Server replayed 15 `agent_message_chunk` + 14 `user_message_chunk` +
  `session_info_update`, `usage_update`, `available_commands_update`
- Result contains `configOptions` and `modes` (extra data beyond ACP spec)
- No errors, all notifications arrived via existing `onUpdate` handler

#### ACP spec details

- **Method:** `session/load` (not `loadSession` — that's the capability name)
- **Params:** `{ sessionId, cwd, mcpServers }` (cwd and mcpServers required)
- **Behavior:** Server replays full conversation as `session/update` notifications
  before returning the result
- **Capability:** Requires `loadSession: true` in initialize response (OpenClaw advertises this)

#### Limitation

Only user/assistant text is replayed. Tool calls and system messages are not
reconstructed. Sufficient for BUG-022 (the lost content was agent text) but
won't catch missed tool-result artifacts.

All workaround code is marked with `TODO(BUG-022)` for removal once the
upstream fix lands.

## Edge Cases

- **Session load during active prompt:** Guarded — `catchUpSession()` checks
  `activeRequestSource !== null` and skips if another prompt is in flight.

- **Duplicate messages:** Handled — dedup layer counts `agent_message_chunk`
  events forwarded so far and skips that many during `session/load` replay.

- **Large session history:** `session/load` replays the entire conversation,
  but the dedup layer skips all already-forwarded chunks. Only new chunks
  (the missed sub-agent result) are forwarded. Cost is CPU, not bandwidth.

- **Mobile-side rendering of late messages:** Even if we forward the missed
  message, the mobile needs to handle a message that arrives out of order
  (after the user's follow-up prompt and response). The UI should insert it
  at the correct position in the conversation timeline.

## Acceptance Criteria

- [~] Sub-agent results arrive on mobile (workaround implemented — needs field test to confirm end-to-end)
- [x] No duplicate messages when catch-up and real-time overlap (dedup layer with chunk counting)
- [x] Relay log includes prompt text content for debugging (commit `41edb1e`)
- [x] Trigger signal identified: `end_turn` + zero `agent_message_chunk` (0% false negatives, ~10% false positives — acceptable)
- [x] Existing tests still pass (121/121 pass)
- [x] `session/load` verified against real OpenClaw ACP server
- [ ] Field test: confirm sub-agent result arrives on mobile via catch-up
- [ ] Upstream fix lands (openclaw/openclaw#40693) → remove workaround code (grep `TODO(BUG-022)`)

## Files

Workaround (commit `0ff20c5`):
- `packages/acp-client/src/client.ts` — `sessionLoad()` method (ACP `session/load`)
- `packages/acp-client/test/mock-acpx.ts` — `[no-echo]` + `session/load` mock support
- `apps/relay/src/bridge/relay-bridge.ts` — Chunk counting, catch-up trigger, dedup
- `apps/relay/src/bridge/relay-bridge.spec.ts` — 4 BUG-022 workaround tests

## Related

- **Upstream:** [openclaw/openclaw#40693](https://github.com/openclaw/openclaw/issues/40693) — ACP sessions never trigger auto-announce
- **Upstream:** [openclaw/openclaw#38626](https://github.com/openclaw/openclaw/issues/38626) — Subagent lifecycle observability
- **Upstream:** [openclaw/openclaw#40907](https://github.com/openclaw/openclaw/issues/40907) — Channel-level async streaming
- **BUG-020 / TASK-065:** Transport-layer silent failure — different root cause
  but same user-visible symptom. Task 065 is complete.
- **BUG-021:** Session hang at 20:42 PDT — may be related (the user's prompt
  was lost in the hung crimson-tunic session, triggering the switch to
  sage-mushroom where BUG-022 occurred).

## Date

2026-03-13
