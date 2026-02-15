# Task 004: TTS Pre-warming Validation

**Epic:** 05 - Latency Optimization
**Phase:** 3
**Spec:** [docs/specs/05-latency-optimization/spec.md](../../docs/specs/05-latency-optimization/spec.md) §5

## Objective

Validate that the Cartesia TTS plugin maintains persistent WebSocket connections between utterances, and that sentence-boundary streaming is active. Expected savings: 50–100ms.

## Checklist

- [ ] Verify Cartesia `chunkTimeout` is set appropriately (connection keepalive)
- [ ] Measure TTS TTFB for first vs. subsequent utterances (expect lower on subsequent)
- [ ] Confirm LLM→TTS streaming starts at first sentence boundary, not end of response
- [ ] Document findings in latency instrumentation metrics
- [ ] If connection reuse is not happening, investigate `cartesia.TTS` configuration options

## Files

- `packages/openclaw-channel-livekit/src/livekit/audio.ts` — TTS instantiation

## Notes

This is primarily a validation task. The SDK and Cartesia plugin should already handle this correctly. The goal is to confirm and document, not to build new infrastructure.
