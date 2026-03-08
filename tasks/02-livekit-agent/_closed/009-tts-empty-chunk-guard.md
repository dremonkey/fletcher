# Task 009: Guard Against Empty/Punctuation-Only TTS Chunks

**Epic:** 02 - OpenClaw Channel Plugin
**Priority:** Low
**Source:** [BUG-005](../../docs/field-tests/20260301-buglog.md#bug-005-cartesia-rejects-emptypunctuation-only-tts-chunks-low) — 2026-03-01 field test

## Problem

Cartesia's streaming WebSocket rejects the initial TTS chunk if it contains only whitespace or punctuation. This happens when the LLM's first SSE chunk is a role-only delta or punctuation (e.g., `"` or `—`).

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

The Cartesia plugin's `BUFFERED_WORDS_COUNT` (8 words) sentence tokenizer buffers *subsequent* chunks, but the initial chunk bypass path sends directly to Cartesia without this buffering.

## Proposed Fix

- [ ] Add a text guard before the first `cartesia.stream()` call
  - Strip leading whitespace and punctuation-only content
  - Buffer initial input until at least one non-punctuation word is present
- [ ] Add unit test: empty string → no TTS call
- [ ] Add unit test: punctuation-only string → no TTS call
- [ ] Add unit test: `"Hello"` → TTS call proceeds
- [ ] Verify fix works with Cartesia streaming WebSocket
- [ ] If migrating to ElevenLabs (task 006), verify whether ElevenLabs has the same restriction

## Files

- `packages/openclaw-channel-livekit/src/livekit/audio.ts` — TTS streaming path
- Voice agent TTS plugin configuration

## Context

- **Frequency:** Intermittent — depends on LLM chunking behavior
- **Related:** Task 006 (ElevenLabs migration) — may resolve this if ElevenLabs is more tolerant, but the guard is good defense regardless
- **Related:** `BUFFERED_WORDS_COUNT` in Cartesia plugin's sentence tokenizer

## Status

- **Date:** 2026-03-01
- **Priority:** Low
- **Status:** Open
