# Epic: Voice Fingerprinting (Sovereign Identification)

The goal of this epic is to implement a local-first voice fingerprinting system ("Voice Key") that allows Fletcher (and eventually Knittt) to identify speakers in real-time without external APIs. This enables personalized interactions ("Hi Andre!") by injecting the speaker's identity into the LLM context.

## Tasks

- [ ] **Research & Prototype (Spike)**: `001-research-onnx-models.md`
    - Evaluate `ECAPA-TDNN` vs `WavLM` for Node.js inference speed/accuracy.
    - Create a small standalone script to take a WAV file and output an embedding vector.
    - Confirm `onnxruntime-node` compatibility with the chosen model.

- [ ] **Core Library Implementation (`@fletcher/voice-key`)**: `002-core-library.md`
    - Create a new package `packages/voice-key`.
    - Implement `VoiceProcessor` class:
        - Input: Float32Array (PCM audio).
        - Output: Float32Array (embedding vector).
        - VAD integration (silence filtering).
    - Implement `VoiceRegistry` class:
        - `enroll(name, audioSample)`: Add a new voice.
        - `identify(audioSample)`: Return `{ name, confidence }` or null.
        - Persistence to `~/.openclaw/voice_keys.json`.

- [ ] **LiveKit Integration**: `003-livekit-integration.md`
    - Modify `openclaw-channel-livekit` (or `livekit-agent-ganglia`) to tap into the `RemoteAudioTrack`.
    - Implement a "listening loop" that accumulates audio chunks.
    - Periodically run `VoiceRegistry.identify()` on the buffer (e.g., every 3-5s of active speech).
    - If identified with high confidence, emit a `speaker_identified` event.

- [ ] **Context Injection**: `004-context-injection.md`
    - Update the `LLM` context builder to accept a `speaker_identity` field.
    - When `speaker_identified` fires, update the session state.
    - Inject a system message into the chat history: `[System: Speaker identified as <Name>]`.
    - Test that the LLM uses the name in subsequent responses.

- [ ] **Enrollment UI/Flow**: `005-enrollment-flow.md`
    - Add a way to trigger enrollment.
    - **Option A (Voice Command)**: "Hey Fletcher, learn my voice as Andre." -> Trigger enrollment mode.
    - **Option B (Admin Tool)**: CLI command `fletcher voice enroll <name> <file.wav>`.
    - MVP: Implement Option B (CLI) first for testing.

## Future / Out of Scope (for now)
- Real-time Diarization (separating overlapping speakers).
- Continuous learning (updating the embedding as the user speaks more).
- Knittt integration (desktop app).
