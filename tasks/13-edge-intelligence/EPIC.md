# Epic: Edge Intelligence (13-edge-intelligence)

Enable on-device intelligence — wake word detection, local voice activity detection, and offline capabilities — to reduce latency, improve privacy, and allow Fletcher to function without a constant network connection.

## Context

Fletcher currently relies entirely on cloud services for audio processing. This epic moves key capabilities to the edge (mobile/desktop devices) to enable hands-free activation via wake words, reduce bandwidth by filtering silence locally, and provide basic functionality when offline. The approach is local-first and privacy-focused, using lightweight ONNX models that run efficiently on mobile hardware.

## Tasks

### Phase 1: Wake Word — Spec & Prototype

- [x] **001: Create Wake Word Spec** — Define architecture, requirements, and implementation strategy for local wake word detection using OpenWakeWord (ONNX), integrated into the AmberOrb state machine.
- [x] **002: Wake Word Prototype (Spike)** — Proof-of-concept using `onnxruntime` with quantized models and `mic_stream` for audio capture, achieving sub-250ms latency.

### Phase 2: Wake Word — Production Integration

- [ ] **003: Integrated Wake Word** — Integrate the validated prototype into the production Flutter app with state machine wiring, background audio capture, battery optimization, and user controls.

### Phase 3: Local VAD & Offline

- [ ] **004: Local VAD Evaluation** — Benchmark local Voice Activity Detection candidates (Silero VAD, WebRTC VAD) against server-side streaming for latency, bandwidth, and privacy gains.
- [ ] **005: Offline Mode** — Enable basic offline functionality: local wake word detection, interaction caching with sqflite/hive, fallback responses, and automatic retry on network restoration.

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Wake Word — Spec & Prototype | ✅ Complete |
| 2 | Wake Word — Production Integration | Not started |
| 3 | Local VAD & Offline | Not started |

## Dependencies

- **Epic 02 (LiveKit Agent):** Wake word gating feeds into noise-robust voice detection (Task 02-007).
- **Epic 03 (Flutter App):** Edge intelligence integrates directly into the Flutter mobile app.
