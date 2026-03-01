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

## Investigation Checklist

- [ ] Identify what LLM model OpenClaw is routing to for this session
  - Is it a large/slow model? (e.g., Claude Opus, GPT-4?)
  - Is there a faster model option for voice use cases?
- [ ] Check for cold-start overhead on the OpenClaw side
  - First request vs. subsequent requests — is there model loading delay?
  - Is there a warm-up or prefill phase?
- [ ] Profile OpenClaw gateway overhead
  - Time from receiving HTTP request to forwarding to LLM provider
  - Any preprocessing (context assembly, tool resolution, memory retrieval) adding latency?
- [ ] Check OpenClaw's SSE chunking behavior
  - First SSE chunk has empty content (role-only delta) — is this intentional?
  - Does this add a round-trip or delay before real content starts?
- [ ] Evaluate voice-specific model routing
  - Can OpenClaw route voice channel requests to a faster/smaller model?
  - E.g., use Haiku/Sonnet for voice, Opus for text channels
- [ ] Measure baseline TTFT for the same model via direct API call (bypass OpenClaw)
  - Isolates whether the latency is in the LLM provider or OpenClaw's processing

## Potential Mitigations (Fletcher side)

These don't fix the root cause but can mask it:

- [x] Instrumentation — already measuring TTFT per turn (Epic 10)
- [ ] Task 008: Immediate acknowledgment sound (bridges perceived silence)
- [ ] Task 001: Preemptive generation (saves ~200-400ms)
- [ ] Task 003: Streaming interim transcripts (saves ~200-400ms)
- [ ] Voice-specific model routing in Ganglia session key (request faster model for voice)

## Files

- `packages/livekit-agent-ganglia/src/client.ts` — HTTP timing data
- `packages/livekit-agent-ganglia/src/llm.ts` — stream timing
- OpenClaw gateway configuration (external to Fletcher)

## Context

- **Target:** Sub-1.5s voice-to-voice latency (current: ~8-10s)
- **Key insight:** Fletcher's pipeline is already fast. The problem is upstream.
- **Related:** All other Epic 05 tasks — they optimize the ~528ms pipeline overhead, but the ~8-17s TTFT dwarfs them
- This task may require changes outside the Fletcher repo (OpenClaw configuration)

## Status

- **Date:** 2026-03-01
- **Priority:** Critical
- **Status:** Open
