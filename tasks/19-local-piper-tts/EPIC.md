# Epic 19: Local Piper TTS Integration

**Goal:** Move the Piper TTS engine from the server sidecar to the mobile client (Android/iOS) for on-device voice synthesis.

**Purpose:** Eliminate cloud voice-out costs (drop COGS to $0), enable offline operation, and achieve zero-network-hop voice latency.

**Architecture:** Leverage `sherpa-onnx` or `onnxruntime` within the Flutter app to load and run Piper models (.onnx) locally.

**Context:** This is the key to reaching a 50% margin for the Fletcher Pro tier by removing the ~$0.135/min cloud TTS overhead. Moving TTS to the device enables:
- **Zero COGS for voice-out** — no cloud TTS API charges
- **Offline operation** — voice synthesis works without network connectivity
- **Zero-network-hop latency** — no HTTP round-trip to server or cloud provider
- **Privacy** — text never leaves the device for TTS

## Status

**Epic Status:** 📋 BACKLOG (Planning / Discovery Phase)

## Tasks

### 001: Local PiperTTS Discovery & Feasibility
**Migrated from:** `tasks/13-edge-intelligence/031-local-piper-tts.md`

Research and prototype moving PiperTTS from the server-side Docker sidecar to on-device inference in the Flutter mobile client.

**Key Questions:**
- Which Flutter/Dart integration path? (`sherpa-onnx`, FFI, platform channel)
- What are the performance characteristics? (inference latency, memory, battery)
- Which Piper model/voice to ship? (quality vs. size tradeoff)
- How does local TTS integrate with the existing fallback chain?
- Model bundling strategy? (APK bundle vs. download-on-first-use)

**Status:** 📋 BACKLOG (Discovery / Spike)

**See:** [031-local-piper-tts.md](../13-edge-intelligence/031-local-piper-tts.md) for full discovery checklist.

---

### 002: Sherpa-ONNX Flutter Integration
**Status:** 📋 BACKLOG

Integrate the `sherpa-onnx` library into the Flutter app for on-device Piper model inference.

**Scope:**
- Add `sherpa-onnx` Flutter package dependency
- Wire up native platform integration (Android/iOS)
- Implement basic inference pipeline (text → PCM audio)
- Validate model loading and audio output

**Depends on:** 001 (Discovery)

---

### 003: Model Selection & Bundling Strategy
**Status:** 📋 BACKLOG

Select the optimal Piper voice model and implement the bundling/delivery strategy.

**Scope:**
- Benchmark model variants (`low`, `medium`, `high` quality)
- Choose voice character (align with current server-side Piper voice: `en_US-lessac-medium`)
- Implement model bundling (APK asset vs. OBB vs. download-on-first-use)
- Handle model updates and versioning

**Depends on:** 001 (Discovery), 002 (Integration)

---

### 004: Local TTS Pipeline & Fallback Integration
**Status:** 📋 BACKLOG

Wire local Piper TTS into the voice agent pipeline as the new fallback tier.

**Scope:**
- Implement `LocalPiperTTS` service in Flutter app
- Integrate with LiveKit audio track (PCM → LiveKit publish)
- Update fallback chain: Cloud TTS → Server Piper → **Local Piper**
- Handle TTS mode switching and degradation UX (artifacts/notifications)

**Depends on:** 002 (Integration), 003 (Model Selection)

---

### 005: Performance Optimization & Battery Impact
**Status:** 📋 BACKLOG

Optimize on-device inference for production use.

**Scope:**
- Benchmark inference latency on target devices (Pixel 6/7, mid-range Android)
- Evaluate ONNX Runtime acceleration (NNAPI, GPU delegate)
- Measure battery impact during continuous TTS usage
- Implement model quantization if needed (INT8/FP16)
- Memory footprint optimization

**Depends on:** 004 (Pipeline Integration)

---

### 006: Offline Mode & Edge TTS Coordination
**Status:** 📋 BACKLOG

Coordinate local Piper TTS with offline mode and other edge intelligence features.

**Scope:**
- Ensure local TTS works in offline mode (no network connectivity)
- Coordinate with local VAD (Epic 13: Edge Intelligence)
- Voice consistency across server/cloud/local TTS tiers
- Update system prompts for local TTS constraints

**Depends on:** 004 (Pipeline Integration), Epic 13 (Edge Intelligence)

---

## Architecture Notes

### Current State (Server-Side)
```
Voice Agent (Server)
  ├─ Cloud TTS (Google/ElevenLabs) [Primary]
  └─ Piper Docker Sidecar [Fallback]
       └─ HTTP POST → WAV → PCM → LiveKit
```

### Target State (Local TTS)
```
Flutter App (Mobile)
  ├─ Cloud TTS (Google) [Primary, via server]
  ├─ Server Piper Sidecar [Fallback Tier 1]
  └─ Local Piper (sherpa-onnx) [Fallback Tier 2 / Offline]
       └─ Text → ONNX Inference → PCM → LiveKit Track
```

## Dependencies

- **Epic 3 (Flutter App)** — local TTS runs in the mobile client
- **Epic 13 (Edge Intelligence)** — Task 031 (discovery) migrated here
- **Epic 5 (Latency Optimization)** — local TTS eliminates network round-trip
- **Epic 9 (Connectivity)** — local TTS enables offline operation

## Success Metrics

- **COGS Reduction:** Voice-out cost drops to $0 (from ~$0.135/min cloud TTS)
- **Latency:** Local TTS inference <500ms for typical 1-2 sentence utterance
- **Offline:** Voice synthesis works with zero network connectivity
- **Quality:** Voice character matches server-side Piper voice (`en_US-lessac-medium`)
- **Battery:** <5% additional battery drain during continuous TTS usage
- **App Size:** Model bundled in APK or OBB, total app size increase <100MB

## References

- [Sherpa-ONNX Flutter Examples](https://github.com/k2-fsa/sherpa-onnx/tree/master/flutter-examples)
- [Piper Model Zoo](https://github.com/rhasspy/piper/blob/master/VOICES.md)
- [ONNX Runtime Mobile](https://onnxruntime.ai/docs/tutorials/mobile/)
- [Task 13-031: Local PiperTTS on Android](../13-edge-intelligence/031-local-piper-tts.md)
