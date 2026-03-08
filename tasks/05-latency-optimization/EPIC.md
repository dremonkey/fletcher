# Epic: Latency Optimization (05-latency-optimization)

Reduce voice-to-voice latency from ~1.4s to sub-800ms by overlapping pipeline stages — tuning endpointing, enabling speculative LLM inference on interim transcripts, and validating TTS connection reuse. Separately, address the dominant bottleneck: OpenClaw's thinking-token suppression causing 8–17s dead silence on complex prompts.

## Context

Fletcher's voice pipeline is sequential: audio is fully transcribed by STT before the LLM begins inference, and the LLM must produce tokens before TTS starts synthesis. Each stage waits for the previous one to complete. The primary optimization technique is **speculative prefetching** — starting the next pipeline stage before the current one finishes, then discarding wasted work if the input changes.

During a 2026-03-01 field test, a second bottleneck emerged: OpenClaw's backend suppresses `<thinking>` tokens from Gemini, causing 8–17s of dead silence before the first visible token appears. This dwarfs the ~528ms pipeline overhead and became the critical-path issue.

**Spec:** [docs/specs/05-latency-optimization/spec.md](../../docs/specs/05-latency-optimization/spec.md)

## Tasks

### Phase 1: Tuned Endpointing + Preemptive Generation

- [ ] **001: Enable Preemptive Generation & Tune Endpointing** — Enable SDK's `preemptiveGeneration`, reduce `minEndpointingDelay` from 500ms to 200ms. Low-risk config change. (200–400ms savings)

### Phase 1b: Instrumentation

- [→] **002: Latency Instrumentation & Metrics** — Moved to [Epic 10: Metrics & Observability](../10-metrics/).

### Phase 2: Speculative Inference

- [ ] **003: Streaming Interim Transcripts to LLM** — Feed interim transcripts to Ganglia speculatively; cancel and restart on each new interim. Requires `cancelPending()` on GangliaLLM, custom `SpeculativeAgent` node override, and AbortSignal plumbing. Highest complexity. (200–400ms savings)

### Critical: Backend TTFT

- [~] **005: Investigate & Reduce OpenClaw First-Token Latency** — Root cause identified: `<thinking>` tag suppression causes 8–17s TTFT. Phase 1 remediation complete (pondering status phrases + acknowledgment chime fill the silence). Phase 2 (vocalized inner monologue) deferred. Supporting changes (OpenClaw upgrade, delta throttle reduction, TCP Nagle fix) still pending.

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Tuned Endpointing + Preemptive Generation | Not started |
| 1b | Latency Instrumentation | Moved to Epic 10 |
| 2 | Speculative Inference | Not started |
| Critical | OpenClaw TTFT Investigation | Phase 1 complete; supporting changes pending |

## Latency Budget

```
Stage              Current (ms)    Target (ms)
─────────────────  ──────────────  ──────────────
Audio capture        50–100          50–100
STT (Deepgram)      200–400         200–400       (external)
Endpointing delay   500–600         100–300       ← Phase 1
LLM first token     300–600         300–600       (external)
LLM↔STT overlap       0            −200–400      ← Phase 2
TTS TTFB            100–200         100–200       (external)
──────────────────────────────────────────────────
Total              1150–1900        550–1200
```

## Success Criteria

| Metric | Current | Phase 1 Target | Phase 2 Target |
|--------|---------|----------------|----------------|
| Median total latency | ~1400ms | <1100ms | <800ms |
| P95 total latency | ~1900ms | <1500ms | <1200ms |
| Endpointing delay | ~550ms | <250ms | <250ms |
| Speculative hit rate | N/A | >40% | >60% |

## Dependencies

- **Epic 10 (Metrics):** Latency instrumentation (Task 002) moved there; measurement is prerequisite for validating optimizations.
- **Epic 02, Task 008:** Acknowledgment chime on end-of-utterance bridges audio gap during thinking (synergy with Task 005).
- **OpenClaw upstream:** Multiple unmerged PRs (#10588, #24856, #22477, #18695) address voice latency — delta throttle, TCP Nagle, thinking override. None merged as of 2026-03-06.
- **Epic 13 (Edge Intelligence):** On-device STT/VAD could reshape the latency budget if sensing moves to the edge.
