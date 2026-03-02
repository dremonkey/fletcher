# Task 007: Noise-Robust Voice Detection

Prevent the agent from responding to unintended audio — background noise, music, and other speakers (e.g., family members) who are not the conversation owner.

## Problem

Two distinct issues observed in real-world use:

1. **Speaker discrimination:** The agent responds to *any* speech it picks up, not just the owner. If someone else in the room talks (e.g., a child), the agent treats it as input and responds. There is no concept of "this voice belongs to the person I'm talking to."

2. **Background noise / music:** Non-speech audio (music, TV, wind, AC) triggers VAD, causing the agent to "listen" to silence or noise and sometimes attempt a response.

These are different problems requiring different solutions — (1) is a speaker identity problem, (2) is a VAD/noise filtering problem.

## Proposed Solutions

### Speaker Discrimination (primary issue)

1. **Wake word / attention gating:** Require a trigger phrase (e.g., "Hey Fletcher") to open a listening window, so ambient speech is ignored unless preceded by the wake word. Could use Picovoice Porcupine or similar on-device wake word engine.
2. **Voice enrollment + embedding:** Enroll the owner's voice at setup time, compute a speaker embedding, and gate STT input on embedding similarity. See [Epic 06: Voice Fingerprinting](../06-voice-fingerprinting/) for the full design. Heavier lift but solves the problem without a wake word.
3. **Deepgram diarization:** Enable Deepgram's speaker diarization and only process segments attributed to the primary speaker. Requires a way to identify which speaker label is the owner (e.g., first speaker = owner).
4. **Push-to-talk fallback:** Add a PTT mode in the Flutter app as a simple opt-in solution for noisy multi-speaker environments.

### Noise Filtering (secondary issue)

5. **Silero VAD:** Use Silero VAD (via `@livekit/agents-plugin-silero`) as a more robust speech/non-speech classifier before Deepgram. ✅ **Implemented** — `activationThreshold: 0.6` (BUG-014 fix)
6. **Noise suppression:** Integrate WebRTC noise suppression or Krisp before the VAD stage.
7. **VAD threshold tuning:** Expose and tune VAD parameters (threshold, prefix/suffix padding) in the `AgentSession` configuration. ✅ **Implemented** — `minEndpointingDelay: 0.8`, `maxEndpointingDelay: 3.0` (BUG-014 fix)
8. **LiveKit turn detector:** Use `@livekit/agents-plugin-livekit` `EnglishModel` for context-aware end-of-turn prediction — uses language understanding alongside VAD to distinguish pauses from turn ends. ✅ **Implemented** (BUG-014 fix)
9. **Deepgram feature flags:** Enable Deepgram's noise reduction or background audio filtering features.

## Relationship to Other Tasks

- [Epic 06: Voice Fingerprinting](../06-voice-fingerprinting/) — the full speaker identity solution; this task may bootstrap with a lighter approach
- [Task 008: Immediate Acknowledgment](./008-immediate-acknowledgment.md) — interaction model changes that may affect how listening windows work

## Success Criteria

- [ ] Agent ignores speech from other people in the room (e.g., child talking nearby).
- [ ] Agent ignores background music and TV audio.
- [ ] Reduced false positives from environmental noise (car, wind, AC).
- [ ] Reliable detection of the owner's speech in a multi-person environment.
- [ ] Adjustable sensitivity / gating mode in config or app UI.
