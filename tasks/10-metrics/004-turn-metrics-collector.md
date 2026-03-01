# Task 002d: Per-Turn Metrics Collector

**Epic:** 10 - Metrics & Observability
**Depends on:** 001 (needs metric events wired up first)

## Objective

Create a `TurnMetricsCollector` that correlates per-`speechId` metrics (EOU, LLM, TTS) into a single per-turn latency summary. This gives a complete picture of each voice round-trip.

## Background

The SDK emits separate `metrics_collected` events for each pipeline stage, but they share a `speechId`. Correlating them gives:
```
Turn Summary (speech_abc123):
  EOU delay:     513ms
  LLM TTFT:    8,520ms
  TTS TTFB:      180ms
  ──────────────────────
  Est. total:  9,213ms
```

## Checklist

- [x] Create `apps/voice-agent/src/metrics.ts`:
  - [x] `TurnMetrics` interface: `{ speechId, eouDelayMs?, transcriptionDelayMs?, llmTtftMs?, llmDurationMs?, ttsTimeToFirstByteMs?, ttsDurationMs?, estimatedTotalMs? }`
  - [x] `TurnMetricsCollector` class:
    - `collect(metrics: AgentMetrics): TurnMetrics | null` — accumulates by speechId, returns complete summary when all three (EOU + LLM + TTS) are present
    - `prune(maxAgeMs = 30_000): void` — clears stale entries to prevent memory leaks
    - Computes `estimatedTotalMs = eouDelayMs + llmTtftMs + ttsTimeToFirstByteMs`
  - [x] Export for use in agent.ts
- [x] Create `apps/voice-agent/src/metrics.spec.ts`:
  - [x] Test: collecting LLM, TTS, EOU metrics with same speechId returns complete TurnMetrics
  - [x] Test: metrics with different speechIds don't cross-contaminate
  - [x] Test: prune() removes entries older than maxAge
  - [x] Test: partial collection (only 2 of 3 metric types) returns null
  - [x] Test: STT metrics (no speechId) are handled gracefully
- [x] Integrate in `apps/voice-agent/src/agent.ts`:
  - Instantiate `TurnMetricsCollector`
  - In the `MetricsCollected` listener (from 002a), call `collector.collect(metrics)`
  - When a complete `TurnMetrics` is returned, log it as a summary:
    ```
    logger.info({ ...turnMetrics, metric: 'turn_summary' }, 'Turn complete')
    ```
- [x] Run `bun test apps/voice-agent/src/metrics.spec.ts`

## Files

- `apps/voice-agent/src/metrics.ts` (new)
- `apps/voice-agent/src/metrics.spec.ts` (new)
- `apps/voice-agent/src/agent.ts` — integrate collector in MetricsCollected listener

## Success Criteria

1. All tests pass
2. Docker logs show per-turn summaries:
```json
{"level":30,"metric":"turn_summary","speechId":"speech_abc123","eouDelayMs":513,"llmTtftMs":8520,"ttsTimeToFirstByteMs":180,"estimatedTotalMs":9213,"msg":"Turn complete"}
```
