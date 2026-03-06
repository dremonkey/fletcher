# Spec: Wake Word Integration (Edge Intelligence)

## Problem

Currently, Fletcher requires manual interaction (button press) to start listening. This friction reduces spontaneous usage. To enable hands-free interaction, we need a local Wake Word engine running on the edge device (mobile/desktop).

## Goals

1. **Privacy-First:** Wake word detection happens entirely on-device. Audio is only streamed to the cloud *after* the wake word is detected.
2. **Low Latency:** Immediate feedback (<300ms) upon wake word detection.
3. **Battery Efficient:** Minimize CPU usage for continuous listening.
4. **False Positive Resilience:** Avoid accidental activation.

## Architecture

### Components

1. **Wake Word Engine (WWE):**
   - Runs on the edge device.
   - Continuously buffers audio (sliding window).
   - Detects specific keyword (e.g., "Hey Fletcher").
   - Triggers `onWake()` event.

2. **VAD (Voice Activity Detection):**
   - Optional, but recommended to filter silence before WWE.
   - Reduces WWE processing load.

3. **State Machine Integration:**
   - The `AmberOrb` state machine must handle the transition from `Idle` -> `Listening` upon wake word trigger.
   - Visual feedback (Orb pulse/color change) is critical.

### Protocol

1. **Idle State:**
   - Mic is open but local-only.
   - WWE processes audio stream.
   - No data sent to LiveKit/OpenClaw.

2. **Wake Detected:**
   - WWE triggers `onWake()`.
   - App plays "listening" chime (local).
   - App connects to LiveKit room (if not already connected) or unmutes publish track.
   - State transitions to `Listening`.

3. **Listening State:**
   - Audio streamed to LiveKit.
   - Server-side VAD/STT processes speech.
   - Normal conversation flow ensues.

## Implementation Strategy

### Phase 1: Prototype (Spike) — Removed
The Phase 1 spike (`WakeWordService`, `mic_stream`, `onnxruntime`) was removed in commit `e543c7c` because:
- `mic_stream` (latest stable 0.7.2) uses the removed `PluginRegistry.Registrar` API, incompatible with Flutter 3.x.
- `onnxruntime` was pinned to a non-existent version (1.17.0; latest is 1.4.1).
- The service had no real inference logic — `_processAudioFrame()` was a TODO stub.
- The `listeningForWakeWord` state and all UI wiring have been removed.

Any future implementation should start fresh from Phase 2.

### Phase 2: Core Integration
- [ ] Select production-grade WWE library (e.g., Rhasspy, OpenWakeWord, or platform-native).
- [ ] Implement `WakeWordService` in Flutter.
- [ ] Manage audio focus and permissions.

### Phase 3: Optimization
- [ ] Tune sensitivity/thresholds.
- [ ] Implement battery usage monitoring.
- [ ] Add " snooze" or "do not disturb" modes.

## Tech Stack Options

1. **Porcupine (Picovoice):** High accuracy, easy to use, but commercial license constraints.
2. **OpenWakeWord:** Open source, runs on ONNX, good accuracy, but higher resource usage.
3. **Silero VAD + Keyword Spotting:** Lightweight, good for VAD, custom KWS needed.
4. **Android/iOS Native:**
   - Android: `AlwaysOnHotwordDetector` (restricted).
   - iOS: `SFSpeechRecognizer` (requires network/permissions, not true offline wake word).

**Recommendation:** Start with **OpenWakeWord** (via `onnxruntime` in Flutter) for true offline, open-source capability.

## Risks

- **Battery Drain:** Continuous mic access and inference is power-hungry. Needs careful duty cycling or hardware offload if available.
- **False Positives:** Annoying for users. Needs adjustable sensitivity.

## Success Metrics

- Wake word detection latency < 300ms.
- False positive rate < 1 per day.
- Battery impact < 5% per hour of standby.
