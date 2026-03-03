# Epic: Speaker Isolation (Voice Lock)

Lock onto the primary speaker's voice in a 1-on-1 conversation. Beyond voice fingerprinting (Epic 6), this epic focuses on **actively isolating** the target speaker's audio signal — rejecting background speech, ambient noise, and echo so the STT pipeline only processes the intended user.

**Goal:** Near-zero crosstalk. In a noisy environment, only the person holding the phone should be transcribed.

## Approach Tiers

The techniques below are ordered from lowest effort to highest. They stack — each layer adds incremental isolation on top of the previous ones.

### Tier 1: Free / Near-Zero Effort

These require minimal code changes and exploit what the hardware and protocol already provide.

### Tier 2: Signal Processing

Classical DSP techniques that run on-device with low latency overhead.

### Tier 3: ML-Based Separation

Neural models that actively extract the target speaker's voice from a mixture.

### Tier 4: Conversational Protocol

Leverage the structure of a 1-on-1 voice conversation to disambiguate speakers.

---

## Tasks

### Tier 1: Hardware & Platform

- [x] **001: Audit Android AudioSource selection**
    - Verified: LiveKit Dart SDK uses WebRTC default `AudioSource.MIC` with configurable constraints.
    - Made all audio processing options explicit in `RoomOptions.defaultAudioCaptureOptions`: AEC, NS, AGC, voiceIsolation, highPassFilter (newly enabled), typingNoiseDetection.
    - Set `AudioPreset.speech` (24kbps) bitrate instead of default `music` (48kbps).
    - Added debug log confirming audio config is active for field test verification.

- [x] **002: Verify AEC is active on-device**
    - AEC (`echoCancellation: true`) is explicitly configured in `AudioCaptureOptions`.
    - SDK passes this through to WebRTC constraints as `googEchoCancellation` + `googDAEchoCancellation`.
    - `voiceIsolation: true` adds ML-based voice extraction on top of AEC.
    - Field test verification: check logcat for `[Fletcher] Audio config: AEC=on` line.

### Tier 2: Signal Processing

- [ ] **003: Near-field energy gating**
    - The primary speaker is 10–30cm from the mic; bystanders are 1m+. That's a 10–20dB SNR advantage.
    - Implement an amplitude/energy gate tuned for near-field distance.
    - Reject audio frames below the near-field energy threshold during active speech.
    - Integrate with existing VAD pipeline.

- [ ] **004: Adaptive noise floor subtraction**
    - During VAD silence segments, continuously estimate the ambient noise spectrum.
    - Apply spectral subtraction or Wiener filtering to suppress steady-state noise.
    - Keep latency overhead under 5ms per frame.

- [ ] **005: Speaker F0 (pitch) tracking**
    - Estimate the speaker's fundamental frequency range from the first few utterances.
    - Use as a lightweight spectral gate — if incoming audio has an F0 outside the learned range, flag or attenuate it.
    - Not a replacement for TSE, but a cheap early-rejection filter.

### Tier 3: ML-Based Extraction

- [ ] **006: Research Target Speaker Extraction (TSE) models**
    - Survey real-time-capable TSE models: SpEx+, SpeakerBeam, VoiceFilter, TF-GridNet.
    - Evaluate ONNX export feasibility and inference latency on server (the voice agent, not the phone).
    - Key requirement: must accept a short enrollment clip (2–5s) and process streaming audio.
    - Deliverable: Model recommendation with latency/quality benchmarks.

- [ ] **007: TSE enrollment from first utterance**
    - Capture the user's first utterance (greeting/response to agent prompt) as a clean enrollment sample.
    - Extract a speaker embedding for TSE conditioning.
    - Store per-session (no persistence needed — re-enroll each conversation).

- [ ] **008: TSE integration into voice pipeline**
    - Insert the TSE model into the audio pipeline between mic input and STT.
    - The model receives: (a) enrollment embedding, (b) raw audio frames.
    - Output: cleaned audio containing only the target speaker's voice.
    - Measure impact on end-to-end latency and STT word error rate.

- [ ] **009: Personalized noise suppression fallback**
    - If full TSE is too heavy, evaluate speaker-conditioned noise suppression (Krisp-like models that can be primed with a target speaker embedding).
    - Compare: generic noise suppression vs speaker-conditioned suppression vs full TSE.

### Tier 4: Conversational Protocol

- [ ] **010: Turn-based speaker gating**
    - In a 1-on-1 conversation, turn structure is predictable: agent speaks → user responds.
    - After agent finishes speaking, weight VAD confidence heavily toward the known speaker for a response window.
    - If audio arrives outside the expected response window, apply higher confidence thresholds before sending to STT.

- [ ] **011: Enrollment prompt design**
    - Design the agent's opening interaction to elicit a clean, predictable response for enrollment.
    - Options: natural greeting ("Hi, how are you?"), explicit enrollment ("Say your name to get started"), or passive (use whatever the user says first).
    - Test enrollment quality across approaches.

- [ ] **012: STT confidence-based crosstalk detection**
    - Monitor word-level STT confidence scores during transcription.
    - A sudden drop in confidence mid-utterance may indicate a different speaker or crosstalk.
    - Flag low-confidence segments rather than passing them to the LLM.
    - Optionally inject a system message: `[possible crosstalk detected — ignoring segment]`.

## Recommended Implementation Order

1. **001 + 002** (Tier 1) — audit what we have, fix low-hanging fruit
2. **010 + 011** (Tier 4) — conversational gating is cheap and effective
3. **003** (Tier 2) — energy gating adds another easy layer
4. **006 → 007 → 008** (Tier 3) — TSE is the big investment, do the spike first

## Dependencies

- **Epic 6 (Voice Fingerprinting):** Speaker embeddings from voice-key enrollment could double as TSE enrollment embeddings. If Epic 6 lands first, reuse its infrastructure.
- **Epic 10 (Metrics):** Latency instrumentation is needed to measure TSE overhead.
- **Epic 2 (Voice Agent Pipeline):** TSE integration (008) modifies the audio pipeline.

## Future / Out of Scope

- Multi-speaker isolation (cocktail party problem) — this epic assumes 1-on-1 only.
- On-device TSE inference (phone-side) — run on the voice agent server for now.
- Real-time diarization — covered by Epic 6 if needed.
