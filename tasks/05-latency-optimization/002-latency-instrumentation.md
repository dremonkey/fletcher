# Task 002: Latency Instrumentation & Metrics

**Epic:** 05 - Latency Optimization
**Phase:** 1b
**Spec:** [docs/specs/05-latency-optimization/spec.md](../../docs/specs/05-latency-optimization/spec.md) §6

## Objective

Add per-turn latency measurement so we can quantify improvements from each optimization phase. Publish metrics via the `ganglia-events` data channel for real-time display in the Flutter app.

## Checklist

- [ ] Define `LatencyMetrics` interface in a new `src/livekit/metrics.ts`
- [ ] Subscribe to `AgentSession` events to capture timing:
  - `UserStateChanged` → `userSpeechEnd` (when user stops speaking)
  - `UserInputTranscribed` (isFinal) → `sttFinalTranscript`
  - `AgentStateChanged` (thinking→speaking) → approximate `llmFirstToken`
  - `MetricsCollected` → SDK-provided metrics (if available)
- [ ] Compute derived metrics (endpointing delay, TTFT, total latency)
- [ ] Publish `{ type: "metrics", metrics: {...} }` on `ganglia-events` data channel
- [ ] Add unit tests for metrics computation
- [ ] (Optional) Display latency overlay in Flutter StatusBar

## Files

- `packages/openclaw-channel-livekit/src/livekit/metrics.ts` (new)
- `packages/openclaw-channel-livekit/src/livekit/audio.ts`
- `packages/openclaw-channel-livekit/src/livekit/metrics.spec.ts` (new)

## Notes

The SDK's `MetricsCollected` event may already provide some timing data — check before reimplementing.
