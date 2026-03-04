# TASK-014: Human-Centric Interruption Handling (Gentle TTS Cutoff)

## Status
- **Status:** Complete (Phase 1)
- **Priority:** Medium
- **Owner:** TBD
- **Created:** 2026-03-03

## Context
In current field testing, the LiveKit agent stops TTS responses immediately upon detecting user VAD (Voice Activity Detection). This feels robotic and jarring. A human listener typically finishes their current sentence or thought before yielding the floor.

## Approach — Phased

The original plan proposed a 5-10 second grace period and "finish current sentence" behavior. After code review, this was revised:

- A 5-10s grace period would make the agent feel like it's *ignoring* the user (worse than abrupt cutoff). Humans trail off within 0.5-1.5s.
- "Finish current sentence" is ill-defined at the TTS layer — there's no clean sentence boundary in streamed audio buffers.
- Volume fade and grace period require hooking below the `AgentSession` SDK abstractions (fragile, breaks on SDK updates).
- STT already runs independently of TTS — user speech is captured regardless. Not a separate requirement.
- The more impactful fix is reducing *false* interruptions rather than softening *real* ones.

### Phase 1: Tune interruption sensitivity (done)

Low-effort, high-impact changes using existing SDK knobs.

- [x] Fix units bug: `minEndpointingDelay` and `maxEndpointingDelay` were passed as seconds (0.8, 3.0) but the SDK expects milliseconds. Changed to 800ms/3000ms.
- [x] Increase `minInterruptionDuration` from default 500ms to 800ms — user must speak for 800ms before triggering an interrupt, reducing false triggers from brief noises.
- [x] Set `minInterruptionWords: 1` — require at least 1 transcribed word before interrupting, preventing non-speech sounds (coughs, sighs, "um") from cutting off the agent.

### Phase 2: Ack sound refinement (future)

The ack (thinking) sound already avoids TTS overlap due to the state machine — it only plays during `thinking` state, which is entered after both TTS and user speech have stopped. No changes needed unless field testing reveals edge cases.

### Phase 3: Soft cutoff (future, requires SDK support)

A short volume fade (200-500ms) instead of abrupt silence would improve perceived naturalness. This requires either:
- LiveKit SDK exposing an `interruptionFadeMs` option
- Hooking into audio output below the SDK (fragile)

Revisit when the SDK adds fade support or when field testing confirms this is a top-priority UX issue.

## Acceptance Criteria
- [x] False interruptions from brief noises/non-speech reduced (Phase 1)
- [ ] User can interrupt the agent without the audio abruptly snapping to silence (Phase 3)
- [x] User's interrupting speech is correctly transcribed and sent to the LLM (already works — STT is independent)
- [x] Thinking sounds do not overlap with TTS or user speech (already works — state machine prevents it)
