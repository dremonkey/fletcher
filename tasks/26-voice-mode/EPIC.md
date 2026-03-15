# Epic 26 — Voice Mode Consolidation

Consolidated index of all voice-related tasks, previously scattered across Epics 02, 04, 05, 06, 11, 14, 19, 20, 22, and 25. This epic provides a single place to prioritize voice work holistically.

Tasks remain in their original epic directories — this index references them by location.

---

## Phase 0: Architecture

Remove legacy auto-dispatch so voice agent only joins on demand.

- [ ] **078: Remove Auto-Dispatch** — [026/078](./078-remove-auto-dispatch.md)
  Voice agent joins only when voice mode is activated, not on every room connect.

---

## Phase 1: Pipeline Reliability

Stabilize the voice pipeline — fix crashes, leaks, and recovery failures.

- [ ] **073: STT Pipeline Survives Track Resubscription** — [02/073](../02-livekit-agent/073-stt-resubscription.md)
- [ ] **008: Fix Zombie Agent on Disconnect** — [04/008](../04-livekit-agent-plugin/008-fix-zombie-agent.md)
- [ ] **017: Voice Agent Memory Leak (RCA)** — [02/017](../02-livekit-agent)
- [ ] **018: Upstream `_AudioOut.audio` Memory Leak** — [02/018](../02-livekit-agent)
- [~] **019: Internal Memory Leak Mitigations** — [02/019](../02-livekit-agent)
- [ ] **041: Fix SDK ICE Reconnect Loop After Agent Idle** — [02/041](../02-livekit-agent)
- [ ] **016: Explicit Turn Cancellation & Lane Management** — [04/016](../04-livekit-agent-plugin)

---

## Phase 2: Latency

Reduce voice-to-voice latency below 1s.

- [ ] **003: Streaming Interim Transcripts to LLM** — [05/003](../05-latency-optimization)
- [~] **005: Investigate & Reduce OpenClaw TTFT** — [05/005](../05-latency-optimization)
- [~] **008: Immediate Acknowledgment** — [02/008](../02-livekit-agent)
- [ ] **020: Agent Dual-Channel Transcript Emission** — [02/020](../02-livekit-agent)

---

## Phase 3: Voice Quality

Improve speech recognition quality in noisy environments.

- [ ] **007: Noise-Robust Voice Detection** — [02/007](../02-livekit-agent)
- [ ] **003: Near-Field Energy Gating** — [11/003](../11-speaker-isolation)
- [ ] **004: Adaptive Noise Floor Subtraction** — [11/004](../11-speaker-isolation)
- [ ] **005: Speaker F0 (Pitch) Tracking** — [11/005](../11-speaker-isolation)
- [ ] **006–008: Target Speaker Extraction** — [11/006–008](../11-speaker-isolation)
- [ ] **009: Personalized Noise Suppression Fallback** — [11/009](../11-speaker-isolation)
- [ ] **010: Turn-Based Speaker Gating** — [11/010](../11-speaker-isolation)
- [ ] **011: Enrollment Prompt Design** — [11/011](../11-speaker-isolation)
- [ ] **012: STT Confidence-Based Crosstalk Detection** — [11/012](../11-speaker-isolation)

---

## Phase 4: Voice Identity

Per-speaker recognition and context injection.

- [ ] **001: Research & Prototype (Spike)** — [06/001](../06-voice-fingerprinting)
- [ ] **002: Core Library (`@fletcher/voice-key`)** — [06/002](../06-voice-fingerprinting)
- [ ] **003: LiveKit Integration** — [06/003](../06-voice-fingerprinting)
- [ ] **004: Context Injection** — [06/004](../06-voice-fingerprinting)
- [ ] **005: Enrollment UI/Flow** — [06/005](../06-voice-fingerprinting)

---

## Phase 5: On-Device TTS

Move TTS to mobile for $0 voice-out COGS and offline operation.

- [ ] **002: Sherpa-ONNX Flutter Integration** — [19/002](../19-local-piper-tts)
- [~] **003: Model Selection & Bundling** — [19/003](../19-local-piper-tts)
- [ ] **004: Local TTS Pipeline & Fallback** — [19/004](../19-local-piper-tts)
- [ ] **005: Performance & Battery** — [19/005](../19-local-piper-tts)
- [ ] **006: Offline Mode & Edge Coordination** — [19/006](../19-local-piper-tts)

---

## Phase 6: Polish

Voice UX refinements and cost validation.

- [ ] **011: Voice Selection Persistent Preferences** — [02/011](../02-livekit-agent)
- [ ] **013: Voice-Aware Metadata Tagging** — [02/013](../02-livekit-agent)
- [ ] **019: Contextual Noise & Ambiguity Guard** — [14/019](../14-system-prompts)
- [ ] **020: Session Initiation & Warm Start** — [14/020](../14-system-prompts)
- [ ] **008: Integration Test & Cost Validation** — [20/008](../20-agent-cost-optimization)
