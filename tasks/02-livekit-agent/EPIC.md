# Epic: LiveKit Voice Agent (02-livekit-agent)

Build and harden the server-side voice agent — the LiveKit-connected process that runs the STT → LLM → TTS pipeline, handles audio routing, and maintains session resilience under real-world conditions.

## Context

The voice agent is the core runtime of Fletcher. It connects to a LiveKit room as a bot participant, subscribes to human audio tracks, pipes them through Deepgram STT, sends text to the OpenClaw brain (via Ganglia), and streams the response back through TTS (Google/ElevenLabs/Cartesia). Field testing has driven the majority of tasks here — from dispatch failures and memory leaks to TTS error handling and noise robustness.

## Tasks

### Phase 1: Foundation ✅

- [x] **001: Initialize OpenClaw Channel Plugin** — Set up the plugin package structure and integrate `livekit-server-sdk` to create a channel that joins LiveKit rooms.
- [x] **002: Audio Pipeline (STT/TTS)** — Build the real-time audio processing pipeline: mic → LiveKit → agent STT → Ganglia LLM → TTS → LiveKit → speaker. Target <1.5s total latency.
- [x] **003: Debug Agent Response** — Investigate and fix agent not responding to user speech. Resolution: dispatch mode fix (`connect --room`).

### Phase 2: Pipeline Hardening ✅

- [x] **006: Standardize on Google TTS** — Migrated from Cartesia to Google TTS for "Clutch" personality delivery.
- [x] **008: Immediate Acknowledgment Sound** — Emit a non-verbal audio cue on end-of-utterance to bridge the silence gap during LLM thinking time (~8-17s TTFT).
- [x] **009: TTS Empty Chunk Guard** — Guard against Cartesia rejecting empty/punctuation-only initial TTS chunks from LLM deltas.
- [x] **010: Agent Dispatch Failure** — Fix agent not being dispatched after Docker image rebuilds; diagnose `JT_ROOM` vs `JT_PARTICIPANT` mismatch.
- [x] **012: Agent Self-Terminate on Session Error** — Exit the room on unrecoverable `AgentSession` close to prevent zombie agents blocking new dispatches.
- [x] **014: TTS Error Graceful Degradation** — Tolerate TTS rate limit errors (429) without killing the session; fall back to text-only via data channel.

### Phase 3: Resilience & Quality

- [ ] **007: Noise-Robust Voice Detection** — Prevent agent from responding to background noise, music, or non-owner speakers. Requires wake word gating or voice enrollment.
- [ ] **011: Voice Selection Preferences** — Allow switching TTS voices via environment config without rebuilding the Docker container.
- [x] **013: Voice-Aware Metadata** — Inject STT source metadata into outgoing messages so the LLM can handle transcription noise appropriately.
- [ ] **015: Tiered Edge TTS** — Multi-tier TTS strategy: cloud (ElevenLabs/Google) → local fallback (Piper ONNX) → text-only data channel.

### Phase 4: Memory & Stability

- [x] **017: Voice Agent Memory Leak** — Identified `_AudioOut.audio` array as primary cause of unbounded memory growth (7.4 GB observed).
- [x] **018: Upstream AudioOut Memory Leak** — File issue/PR against `livekit/agents-js` for the `_AudioOut.audio` leak in `generation.ts`.
- [x] **019: Internal Memory Leak Mitigations** — Local fixes: `TranscriptManager.knownStreamIds` cleanup, OTel span leak patch, Docker memory limit.

### Backlog

- [ ] **004: Channel Plugin Approach** — Original channel-based architecture exploration (superseded by standalone agent approach).

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Foundation | ✅ Complete |
| 2 | Pipeline Hardening | ✅ Complete |
| 3 | Resilience & Quality | Partially complete |
| 4 | Memory & Stability | ✅ Complete |

## Dependencies

- **Epic 04 (Agent Plugin):** Ganglia LLM integration — the brain that powers agent responses.
- **Epic 05 (Latency):** Optimizations to reduce voice-to-voice latency below 800ms.
- **Epic 06 (Voice Fingerprinting):** Speaker identification feeds into noise-robust detection (Task 007).
- **Epic 10 (Metrics):** Instrumentation for diagnosing pipeline latency and failures.
- **Epic 13 (Edge Intelligence):** Wake word detection could gate agent listening (Task 007).
