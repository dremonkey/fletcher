# Task 031: Local PiperTTS on Android Device

> **⚠️ MIGRATED:** This task has been promoted to **Epic 19: Local Piper TTS Integration** due to its strategic importance for COGS reduction and offline operation.  
> **See:** [tasks/19-local-piper-tts/SUMMARY.md](../../19-local-piper-tts/SUMMARY.md) for the current epic plan.

---

## Summary

Investigate moving the PiperTTS fallback from its current Docker sidecar (running on the server alongside the voice agent) to run locally on the Android device. This would enable offline TTS, eliminate network round-trips for fallback speech, and improve resilience when cloud TTS is unavailable.

## Status

**Status:** 📋 BACKLOG (Discovery / Spike)

## Context

### Current Architecture

PiperTTS currently runs as a **server-side Docker sidecar** (`waveoffire/piper-tts-server`) with GPU acceleration:
- Voice agent POSTs text to `http://localhost:5000` → receives WAV → strips header → feeds PCM to LiveKit
- Model: `en_US-lessac-medium.onnx` (~63MB)
- Integrated via `FallbackAdapter` — activates when primary cloud TTS (Google/ElevenLabs) fails
- Sample rate: 22050 Hz, mono, non-streaming

### Why Move to Device?

1. **Offline TTS** — device can speak even with no server connectivity (ties into Task 005: Offline Mode)
2. **Eliminate network hop** — current fallback still requires server reachability; a truly local fallback has zero network dependency
3. **Latency** — on-device inference avoids HTTP round-trip to sidecar (though CPU-only inference may be slower than GPU sidecar)
4. **Privacy** — text never leaves the device for fallback speech

## Discovery Checklist

### Flutter / Dart Piper Options

- [ ] **Survey existing Flutter/Dart Piper packages** — check pub.dev for `piper_tts`, `flutter_piper`, `sherpa_onnx`, or any wrapper around Piper's C++ library
- [ ] **Evaluate `sherpa-onnx`** — the Sherpa-ONNX project (k2-fsa/sherpa-onnx) has Flutter bindings and supports Piper VITS models natively; this is likely the most mature path
- [ ] **Evaluate `flutter_tts` with custom engines** — can Android's native TTS engine load Piper models? (Probably not without a custom TTS engine APK)
- [ ] **Evaluate platform channel approach** — call Piper's native C/C++ library via FFI (`dart:ffi`) or a Kotlin/Java wrapper via method channel

### Model Considerations

- [ ] **Benchmark model sizes** — `en_US-lessac-medium.onnx` is ~63MB; check if smaller variants exist (`low`, `x_low`) and their quality tradeoff
- [ ] **Model bundling strategy** — bundle in APK (increases app size) vs. download on first use vs. OBB/asset pack
- [ ] **ONNX Runtime on Android** — verify `onnxruntime-android` supports Piper's VITS architecture; check NNAPI/GPU delegate availability for acceleration
- [ ] **Quantized models** — INT8 or FP16 quantized variants for faster CPU inference on mobile

### Performance & Feasibility

- [ ] **Benchmark inference time** — how long does Piper take on a mid-range Android device (e.g., Pixel 6/7) for a typical 1-2 sentence utterance? Target: <500ms for fallback to feel responsive
- [ ] **Memory footprint** — model loaded in RAM; acceptable for a background voice app?
- [ ] **Battery impact** — CPU inference vs. idle; acceptable for occasional fallback use?
- [ ] **Audio output** — can we feed synthesized PCM directly into LiveKit's local audio track, or does it need to go through Android's AudioTrack?

### Integration Architecture

- [ ] **Where does local TTS fit in the pipeline?** Options:
  - **(A) Client-side fallback** — Flutter app detects "Voice Unavailable" data channel event → synthesizes locally → plays through device speaker (bypasses LiveKit audio track entirely)
  - **(B) Client-side TTS → LiveKit track** — synthesize locally → inject PCM into the outgoing audio track so the agent hears it too (complex, probably unnecessary)
  - **(C) Hybrid** — server still tries cloud TTS + Piper sidecar; if both fail, client plays local TTS as last resort (4th tier)
- [ ] **Interaction with existing FallbackAdapter** — local TTS would be a client-side concern, orthogonal to the server-side FallbackAdapter chain
- [ ] **Voice consistency** — use the same Piper model/voice as the server sidecar to avoid jarring voice switches (or accept the difference for fallback scenarios)

### Prior Art / References

- [ ] **sherpa-onnx Flutter examples** — https://github.com/k2-fsa/sherpa-onnx/tree/master/flutter-examples
- [ ] **Piper model zoo** — https://github.com/rhasspy/piper/blob/master/VOICES.md
- [ ] **ONNX Runtime Mobile** — https://onnxruntime.ai/docs/tutorials/mobile/
- [ ] **Flutter FFI for native libs** — https://docs.flutter.dev/platform-integration/android/c-interop

## Deliverable

A written assessment document (can be added to this task file or a linked spike doc) covering:
1. **Recommended approach** (sherpa-onnx vs. FFI vs. platform channel vs. other)
2. **Proof-of-concept results** — inference latency, memory, audio quality on a real device
3. **Model selection** — which Piper voice/quality level to ship
4. **Integration plan** — how local TTS slots into the existing fallback chain
5. **Estimated effort** — to go from spike to production

## Dependencies

- **Task 015 (Tiered Edge TTS)** ✅ — existing Piper sidecar infrastructure
- **Task 005 (Offline Mode)** — local TTS is a prerequisite for meaningful offline voice
- **Epic 03 (Flutter App)** — changes are in the Flutter client

## Notes

- The wake word prototype (Task 002) already uses `onnxruntime` in Flutter, so there's precedent for ONNX model inference on-device in this project.
- `sherpa-onnx` appears to be the strongest candidate — it's purpose-built for on-device speech (STT + TTS), has Flutter bindings, and supports Piper VITS models out of the box.
