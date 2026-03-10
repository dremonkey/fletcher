# Task 009: Guard Against Empty/Punctuation-Only TTS Chunks

**Epic:** 02 - OpenClaw Channel Plugin
**Priority:** Low
**Source:** [BUG-005](../../docs/field-tests/20260301-buglog.md#bug-005-cartesia-rejects-emptypunctuation-only-tts-chunks-low) — 2026-03-01 field test

## Problem

Cartesia's streaming WebSocket rejects the initial TTS chunk if it contains only whitespace or punctuation. This happens when the LLM's first SSE chunk is a role-only delta or punctuation (e.g., `"` or `—`). The problem is provider-agnostic: ElevenLabs, Google TTS, and Piper can all behave similarly.

### Error

```
ERROR (1412): Cartesia returned error
    error: "Invalid transcript: Your initial transcript is empty or contains only punctuation."
```

### Impact

- First TTS audio frame is lost
- Short responses may produce no audio at all
- Longer responses have a noticeable gap at the start

## Root Cause

The LLM (via OpenClaw) streams SSE chunks. The first chunk sometimes contains:
- Empty `content` (role-only delta)
- Punctuation only (`"`, `—`, `...`)

The initial chunk is passed directly to the TTS engine before any real word content has arrived.

## Implementation

Provider-agnostic guard applied at the `ttsNode()` level in the voice pipeline.

### Approach

- `guardTTSInputStream(text: ReadableStream<string>)` — wraps the LLM text stream
  - Buffers all chunks until the accumulated text contains at least one `\w` character
  - Once a word is found, flushes the buffer as a single chunk and passes all subsequent chunks through immediately
  - Empty string chunks are dropped in the pre-word buffering phase
  - If the stream ends with only punctuation, the buffer is flushed rather than dropped (lets the TTS handle it gracefully)
- `GuardedAgent extends voice.Agent` — overrides `ttsNode()` to apply the guard before the stream reaches any TTS provider

### Files Changed

- `apps/voice-agent/src/tts-chunk-guard.ts` — guard implementation (new)
- `apps/voice-agent/src/tts-chunk-guard.spec.ts` — 18 unit tests (new)
- `apps/voice-agent/src/agent.ts` — `GuardedAgent` class + import

## Checklist ✅

- [x] Add a text guard before the TTS stream processes input
  - Buffers initial chunks until at least one word character (`\w`) is present
  - Once a word is detected, flushes the buffer and resumes normal flow
- [x] Add unit test: empty string chunk is dropped (pre-word phase)
- [x] Add unit test: punctuation-only chunks are buffered
- [x] Add unit test: word-containing chunk (`"Hello"`) passes through immediately
- [x] Add unit test: mixed chunk (`"Hello,"`) passes through correctly
- [x] Add unit test: buffer flushed as single chunk when word arrives
- [x] Guard is provider-agnostic (applied at `ttsNode()`, not Cartesia-specific)
- [x] 18 unit tests passing (`bun test src/tts-chunk-guard.spec.ts`)
- [~] Verify fix works with live TTS providers (pending field test)

## Status

- **Date:** 2026-03-10
- **Priority:** Low
- **Status:** Complete — implementation done, field verification pending
