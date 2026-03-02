# Task 005: Investigate & Reduce OpenClaw First-Token Latency

**Epic:** 05 - Latency Optimization
**Priority:** Critical
**Source:** [BUG-006](../../docs/field-tests/20260301-buglog.md#bug-006-perceived-response-latency-too-high--8-10s-silence-highux) — 2026-03-01 field test

## Problem

OpenClaw backend takes ~8-17 seconds to produce the first LLM token (TTFT). This is the dominant bottleneck — the entire voice pipeline (STT → EOU → HTTP → TTS) adds only ~528ms of overhead. No amount of pipeline optimization in Fletcher can fix this; the problem is upstream.

### Measured data (2026-03-01 instrumented session)

| Turn | User said | HTTP fetch | HTTP→first chunk | TTS TTFB |
|------|-----------|-----------|-----------------|----------|
| 1 | "Hey there." | 6ms | **17,275ms** | 248ms |
| 3 | "implementing anything." | 10ms | **11,356ms** | 193ms |

- HTTP fetch is instant (~6-11ms) — OpenClaw gateway accepts immediately
- **The bottleneck is 100% backend TTFT** — 11-17s between SSE stream open and first data chunk
- TTS is fast — Cartesia TTFB is 193-248ms

## Investigation Results (2026-03-01)

### Root Cause: `<thinking>` tag suppression

The SSE pipeline itself has **no explicit buffering**. The flow is event-driven and synchronous:

```
Upstream LLM → streamSimple (fetch+ReadableStream)
  → handleMessageUpdate() processes delta
  → emitAgentEvent() synchronously notifies listeners
  → writeSse(res, chunk) writes directly to HTTP response
```

**The real bottleneck is thinking suppression.** When Gemini uses "low" thinking mode, it generates `<thinking>...</thinking>` blocks before the actual response. OpenClaw's `handleMessageUpdate()` strips these tags and **does not emit any SSE chunks until actual visible content appears**. All thinking tokens are silently consumed, and the first SSE chunk only arrives after thinking completes.

This explains:
- The ~1.5s TTFT on simple prompts (short thinking)
- The 8-17s TTFT during the field test (longer thinking on complex prompts with full Glitch context)
- Why chunks arrive "in a burst" — not batching, but: `[thinking tokens silently consumed for N seconds] → [content tokens rapidly emitted]`

### Model & Configuration

| Setting | Value |
|---------|-------|
| Model | `google/gemini-3-flash-preview` (alias: `gemini-flash`) |
| Thinking | `low` (NOT off) |
| System prompt | ~2,800-3,500 tokens |
| Workspace files loaded | AGENTS.md (229 lines), SOUL.md, IDENTITY.md, TOOLS.md, USER.md, HEARTBEAT.md |
| Memory journals | 15 files, 445 lines total |
| Gateway version | **2026.2.6** (latest: **2026.2.26**) |

### Reproduction (2026-03-01 evening, post-field-test)

Direct requests to OpenClaw gateway (`localhost:18789`) with `x-openclaw-session-key: main`:

| Test | TTFT | Notes |
|------|------|-------|
| Simple "Say hi" | 1,468ms | Trivial thinking |
| 5-turn conversation | 1,643ms | With history |
| Session key `main` | 1,511ms | Same path as voice agent |
| 5 sequential requests | 1,375-1,846ms | Low variability |

TTFT was consistently ~1.5s — the 8-17s from the field test did not reproduce. This confirms the **variable thinking time** hypothesis: simple prompts get short thinking, but complex conversational prompts with full Glitch agent context can trigger much longer internal reasoning.

### Secondary Latency Sources

1. **150ms WebSocket delta throttle** — hardcoded in `server-chat.ts`, designed for chat UIs but harmful for voice. Documented in [Discussion #10588](https://github.com/openclaw/openclaw/discussions/10588). **Not merged.**

2. **No TCP Nagle disable** — `res.socket.setNoDelay(true)` is not called on SSE connections, allowing TCP to coalesce small chunks (~40ms jitter). Proposed in #10588. **Not merged.**

3. **SSE flush missing** — No explicit `.flush()` after `res.write()` in SSE helpers. Proposed in #10588. **Not merged.**

4. **Last-chunk drop bug** — [PR #24856](https://github.com/openclaw/openclaw/pull/24856): the 150ms throttle can drop the final chunk before `emitChatFinal`. **Open.**

### Upstream OpenClaw Issues

Multiple unmerged PRs address voice latency:

| PR | Description | Status |
|----|-------------|--------|
| [#10588](https://github.com/openclaw/openclaw/discussions/10588) | Reducing `/v1/chat/completions` latency for voice agents | Discussion (not merged) |
| [#24856](https://github.com/openclaw/openclaw/pull/24856) | Flush throttled delta before emitChatFinal | Open |
| [#22477](https://github.com/openclaw/openclaw/pull/22477) | Hardcode thinkLevel to off for voice | Open |
| [#21558](https://github.com/openclaw/openclaw/pull/21558) | Per-agent `thinkingDefault` config | Open (stale) |
| [#18695](https://github.com/openclaw/openclaw/pull/18695) | Per-agent thinking override | Open |
| [#28726](https://github.com/openclaw/openclaw/pull/28726) | Add `thinkingDefault` to AgentEntrySchema | Open |
| [#30419](https://github.com/openclaw/openclaw/pull/30419) | Per-model `params.thinking` before global default | Open |

**Dead code note:** The `agents.defaults.models[key].streaming` config field in `openclaw.json` is defined in the Zod schema but [never consumed at runtime](https://github.com/openclaw/openclaw/issues/12217).

## Investigation Checklist

- [x] Identify what LLM model OpenClaw is routing to for this session
  - `google/gemini-3-flash-preview` with `thinking: low`
- [x] Check for cold-start overhead on the OpenClaw side
  - No cold-start observed; TTFT consistent across sequential requests (~1.4-1.8s)
- [x] Profile OpenClaw gateway overhead
  - Gateway overhead is minimal (~28ms HTTP accept)
  - Context assembly (workspace files, memory journals) adds to prompt size, not request processing time
- [x] Check OpenClaw's SSE chunking behavior
  - First SSE chunk is role-only delta (intentional, OpenAI-compatible format)
  - No explicit buffering — but `<thinking>` tags are silently consumed, delaying first visible chunk
- [ ] Evaluate voice-specific model routing
  - Can OpenClaw route voice channel requests to a faster/smaller model?
  - Dedicated voice agent with thinking off + minimal context
- [x] Measure baseline TTFT for the same model via direct API call (bypass OpenClaw)
  - Direct gateway TTFT: ~1.5s (simple prompts), variable on complex prompts
  - Gateway adds negligible overhead; the variance is in Gemini's thinking time

## Remediation Plan

### Primary Direction: Surface thinking tokens instead of suppressing them

**Key insight:** Thinking tokens are not the enemy — their *suppression* is. If OpenClaw passes thinking tokens through (tagged) instead of stripping them, the TTFT problem disappears because thinking tokens become the first content the user sees. The latency is converted from dead silence into meaningful, visible reasoning.

#### Phase 1: Thinking text via data channel (immediate goal)

Get OpenClaw to emit thinking tokens as tagged SSE chunks, then send them to the Flutter client via LiveKit data channel — displayed as a visual "inner monologue" (distinct from spoken output). Combined with Task 008 (acknowledgment sound on EOU), this gives the user two layers of feedback during the wait:

1. **Audio:** Acknowledgment tone on EOU (Task 008)
2. **Visual:** Streaming thinking text on the Flutter client (this task)
3. **Audio+Visual:** Spoken response arrives when content tokens begin

**Implementation:**
- [ ] **OpenClaw: emit thinking tokens tagged** — Modify `handleMessageUpdate()` to pass through `<thinking>` content with a distinguishing marker (e.g., `"thinking": true` on the SSE delta, or a separate `stream: "thinking"` event type). Requires upstream change or local patch.
- [ ] **Ganglia: parse thinking vs. content chunks** — Detect the thinking/content boundary in the SSE stream. Emit thinking chunks as data channel events (not TTS). Emit content chunks normally (TTS + data channel).
- [ ] **Data channel: new `thinking` event type** — Define a new event type in the data channel protocol for streaming thinking text to the client.
- [ ] **Flutter: display thinking text** — Render thinking tokens visually distinct from the response (dimmed, italics, smaller font, different color). Clear/collapse when spoken response begins.

#### Phase 2: Vocalized inner monologue (future exploration)

Once thinking text is flowing through the pipeline, explore speaking it aloud with a distinct voice:
- [ ] Route thinking chunks to a different TTS voice (softer, faster, more contemplative)
- [ ] Handle voice transition from thinking → response smoothly
- [ ] Make inner monologue opt-in (some users may find it annoying)
- [ ] Evaluate whether Gemini's `<thinking>` output sounds natural when spoken

### Supporting Changes

- [ ] **Update OpenClaw to 2026.2.26** — ~20 patch versions behind; may include streaming improvements from v2026.2.17 and v2026.2.25.
- [ ] **Set `OPENCLAW_WS_DELTA_THROTTLE_MS=20`** — If wired up in the latest version, reduces delta throttle from 150ms to 20ms.
- [ ] **Patch OpenClaw locally** with `setNoDelay(true)` + flush fix from #10588.

### Deprioritized (no longer primary direction)

- ~~Turn thinking OFF~~ — Thinking is valuable; surface it instead of suppressing it.
- ~~Create a dedicated lightweight voice agent with no thinking~~ — Unnecessary if thinking tokens flow through.
- ~~Bypass OpenClaw for voice~~ — Only revisit if upstream changes prove infeasible.

## Related Tasks

- [x] Instrumentation — already measuring TTFT per turn (Epic 10)
- [ ] **[Task 008](../02-livekit-agent/008-immediate-acknowledgment.md): Acknowledgment sound** — Complements this task; audio cue on EOU bridges the gap before thinking text starts arriving
- [ ] Task 001: Preemptive generation (saves ~200-400ms)
- [ ] Task 003: Streaming interim transcripts (saves ~200-400ms)

## Files

- `packages/livekit-agent-ganglia/src/client.ts` — HTTP timing data (no buffering, yields chunks immediately)
- `packages/livekit-agent-ganglia/src/llm.ts` — stream timing (no buffering, puts chunks immediately)
- `/home/ahanyu/.openclaw/openclaw.json` — Gateway config (port 18789, model aliases, agent list)
- `/home/ahanyu/openclaw-agents/glitch/` — Glitch workspace (AGENTS.md, SOUL.md, IDENTITY.md, etc.)
- OpenClaw gateway source: `dist/gateway-cli-CVadMy8v.js` (bundled, `handleOpenAiHttpRequest()` at line ~13195)

## Context

- **Target:** Sub-1.5s perceived latency (current: ~8-10s dead silence, ~2s on simple prompts)
- **Key insight:** Thinking tokens aren't the problem — their suppression is. Surfacing them converts dead silence into visible reasoning, making the wait feel purposeful rather than broken.
- **Design philosophy:** Honest UI feedback. Show the user what the AI is actually doing (thinking), don't hide it or fake it.
- **Synergy with Task 008:** Acknowledgment sound provides immediate audio feedback on EOU; thinking text provides ongoing visual feedback until the spoken response begins. Together they eliminate dead silence entirely.
- **Related:** All other Epic 05 tasks — they optimize the ~528ms pipeline overhead, but thinking latency dwarfs them
- This task requires changes outside the Fletcher repo (OpenClaw upstream or local patch)

## Status

- **Date:** 2026-03-01
- **Priority:** Critical
- **Status:** In Progress — investigation complete, remediation direction set (surface thinking tokens)
