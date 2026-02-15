# Task 003: Streaming Interim Transcripts to LLM

**Epic:** 05 - Latency Optimization
**Phase:** 2
**Spec:** [docs/specs/05-latency-optimization/spec.md](../../docs/specs/05-latency-optimization/spec.md) §4

## Objective

Overlap STT and LLM processing by feeding interim transcripts to Ganglia speculatively. Start LLM inference while the user is still speaking, saving 200–400ms per turn.

## Checklist

### Ganglia Changes
- [ ] Add `cancelPending()` method to `GangliaLLM` interface
- [ ] Pass `AbortSignal` through to HTTP fetch in `OpenClawClient.chat()`
- [ ] Pass `AbortSignal` through to HTTP fetch in `NanoclawClient.chat()`
- [ ] Unit tests for cancellation behavior

### Custom Agent Node
- [ ] Create `SpeculativeAgent` extending `voice.Agent` in channel plugin
- [ ] Override `transcriptionNode` to tap interim transcripts
- [ ] Implement speculative `chat()` calls with debouncing (100ms stable text)
- [ ] Cancel previous speculative call on each new interim transcript
- [ ] Reuse generation if final transcript matches interim
- [ ] Add discard-rate metric to `LatencyMetrics`

### Integration
- [ ] Wire `SpeculativeAgent` into `VoiceAgent.start()` as opt-in
- [ ] Add `voice.speculativeInference` config flag (default `false` initially)
- [ ] End-to-end test with real Deepgram + Nanoclaw

## Files

- `packages/livekit-agent-ganglia/src/factory.ts` — `GangliaLLM` interface
- `packages/livekit-agent-ganglia/src/llm.ts` — `OpenClawLLM`
- `packages/livekit-agent-ganglia/src/nanoclaw.ts` — `NanoclawLLM`
- `packages/livekit-agent-ganglia/src/client.ts` — `OpenClawClient`
- `packages/livekit-agent-ganglia/src/nanoclaw-client.ts` — `NanoclawClient`
- `packages/openclaw-channel-livekit/src/livekit/speculative-agent.ts` (new)
- `packages/openclaw-channel-livekit/src/livekit/audio.ts`

## Dependencies

- Task 001 (preemptive generation) should be done first for baseline
- Task 002 (instrumentation) should be done first for measurement

## Notes

This is the highest-impact and highest-complexity optimization. Ship behind a feature flag (`voice.speculativeInference`) and validate with real latency measurements before enabling by default.
