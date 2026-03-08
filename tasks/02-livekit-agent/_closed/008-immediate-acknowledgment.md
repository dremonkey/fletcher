# Task 008: Immediate Acknowledgment Sound

**Epic:** 02 - OpenClaw Channel Plugin
**Priority:** High
**Source:** [BUG-006](../../docs/field-tests/20260301-buglog.md#bug-006-perceived-response-latency-too-high--8-10s-silence-highux) — 2026-03-01 field test

## Problem

After the user finishes speaking, there is ~8-10 seconds of dead silence before hearing any response. The voice pipeline itself is fast (~528ms for STT → EOU → POST → HTTP 200), but the OpenClaw backend takes ~8-17s for first LLM token. Users think the system is broken and interrupt or reconnect.

### Evidence of user frustration

- `firstFrameFut cancelled before first frame` appears 5+ times — user interrupted before hearing ANY response
- Multiple very short sessions (user gave up and reconnected)

## Objective

Emit an immediate non-verbal audio cue as soon as end-of-utterance (EOU) is detected — the auditory equivalent of a "typing..." indicator. This bridges the silence gap while the LLM processes.

## Design Constraints

- **NOT human filler sounds** — no "hmm...", "uh...", "let me think..." (uncanny, misleading)
- **Honest UI feedback** — communicates "heard you, processing" not fake humanness
- **Seamless cutoff** — gets replaced smoothly when real TTS audio starts streaming
- **Non-annoying** — must not become irritating on repeated interactions

### Sound design ideas (needs brainstorming)

- Short mechanical beep/tone (like iMessage send sound)
- Subtle chime or pulse (like Siri/Alexa acknowledgment)
- Repeating soft pulse pattern (every ~2s) so long waits don't feel dead
- Musical "thinking" motif that loops and fades into the response

## Implementation

### Phase 1: Single acknowledgment tone ✅

- [x] Source or synthesize a short acknowledgment sound (~200-500ms) — built-in two-note chime (C5→E5, ~280ms) synthesized programmatically in `ack-tone.ts`
- [x] Play the sound immediately on EOU detection (before LLM response starts) — uses LiveKit SDK `BackgroundAudioPlayer.thinkingSound` which triggers on agent state `thinking` (set on EOU)
- [x] Cut off the acknowledgment when first TTS audio frame arrives — `BackgroundAudioPlayer` stops thinking sound when agent state transitions from `thinking` to `speaking`
- [x] Make the sound configurable (path to audio file or disable entirely) — `FLETCHER_ACK_SOUND` env var: `builtin` (default), custom file path, or `disabled`

### Phase 2: Looping indicator for long waits ✅

- [x] Chime loops continuously while agent is in `thinking` state (1.5s gap between repetitions)
- [x] `BackgroundAudioPlayer` stops the loop automatically when agent state transitions to `speaking`
- [ ] Cap the indicator at some maximum duration (e.g., 30s) to avoid infinite loops

### Phase 3: Client-side visual pairing

- [ ] Send a data channel event on EOU so the Flutter app can show a visual "processing" state
- [ ] Coordinate the visual indicator with the audio cue
- [ ] Stop visual indicator when TTS audio starts

## Files

- `apps/voice-agent/src/ack-tone.ts` — synthesizes the two-note acknowledgment chime (C5→E5)
- `apps/voice-agent/src/ack-tone.spec.ts` — 9 unit tests for tone generation
- `apps/voice-agent/src/ack-sound-config.ts` — resolves FLETCHER_ACK_SOUND env var to audio source
- `apps/voice-agent/src/ack-sound-config.spec.ts` — 12 unit tests for config resolution
- `apps/voice-agent/src/agent.ts` — wires BackgroundAudioPlayer with thinkingSound
- `apps/mobile/lib/` — client-side visual indicator (Phase 3)

## Context

- **Measured latency:** OpenClaw TTFT is 8-17s; pipeline overhead is only ~528ms; TTS TTFB is 193-248ms
- **Related:** Task 007 (noise-robust voice detection) — interaction model changes may affect listening windows
- **Related:** Epic 05 (latency optimization) — reducing actual latency is the real fix; this task addresses perceived latency in the meantime
- **Needs:** Sound design brainstorming session to nail down the right audio cue

## Status

- **Date:** 2026-03-01
- **Priority:** High
- **Status:** Phases 1-2 complete, Phase 3 open
