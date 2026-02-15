# Task 001: Enable Preemptive Generation & Tune Endpointing

**Epic:** 05 - Latency Optimization
**Phase:** 1
**Spec:** [docs/specs/05-latency-optimization/spec.md](../../docs/specs/05-latency-optimization/spec.md) §3

## Objective

Enable the SDK's built-in `preemptiveGeneration` feature and reduce endpointing delays to save 200–400ms per turn.

## Checklist

- [ ] Pass `voiceOptions` to `AgentSession` in `VoiceAgent.startSession()`
  - `preemptiveGeneration: true`
  - `minEndpointingDelay: 200`
  - `maxEndpointingDelay: 1500`
  - `minInterruptionDuration: 300`
- [ ] Add voice tuning options to `ResolvedLivekitAccount` type
  - `voice.preemptiveGeneration` (boolean, default `true`)
  - `voice.minEndpointingDelay` (number, default `200`)
  - `voice.maxEndpointingDelay` (number, default `1500`)
- [ ] Update config resolution in `config.ts` to merge voice defaults
- [ ] Add unit tests for voice options passthrough
- [ ] Manual test: verify agent responds faster after silence

## Files

- `packages/openclaw-channel-livekit/src/livekit/audio.ts`
- `packages/openclaw-channel-livekit/src/types.ts`
- `packages/openclaw-channel-livekit/src/config.ts`
- `packages/openclaw-channel-livekit/src/livekit/audio.spec.ts`

## Notes

This is a low-risk configuration change using existing SDK capabilities. No changes to Ganglia or the backend.
