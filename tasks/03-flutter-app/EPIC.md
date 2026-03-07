# Epic: Flutter Mobile App (03-flutter-app)

Build the Flutter client application — the user-facing mobile interface that connects to LiveKit rooms, captures microphone audio, and provides visual feedback for the voice conversation experience.

## Context

The Flutter app is Fletcher's primary user interface. It connects to a LiveKit room as a human participant, streams microphone audio to the voice agent, and renders real-time visual feedback including a voice-reactive visualizer and live transcription. The app must handle connection lifecycle robustly, including reconnection scenarios.

## Tasks

### Phase 1: Foundation ✅

- [x] **001: Flutter Project Initialization** — Create the Flutter project with `livekit_client` dependency, permissions, basic UI, and connection management for voice conversations.

### Phase 2: Visual Experience ✅

- [x] **002: Amber Heartbeat Visualizer** — Voice-reactive visualizer with state-driven animations (breathing, pulse, ripple, shimmer) responding to real-time audio levels.
- [x] **003: Voice Activity Indicator & Real-Time STT Display** — Visual feedback for microphone input and live speech-to-text transcription to confirm the audio pipeline works end-to-end.

### Phase 3: Stability

- [ ] **004: Fix `addTransceiver: track is null` Crash** — Resolve unhandled exception during rapid reconnection cycles when LiveKit SDK attempts to republish audio tracks with null references.

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Foundation | ✅ Complete |
| 2 | Visual Experience | ✅ Complete |
| 3 | Stability | In progress |

## Dependencies

- **Epic 02 (LiveKit Agent):** The server-side voice agent that the Flutter app connects to via LiveKit rooms.
- **Epic 13 (Edge Intelligence):** Wake word detection and local VAD will integrate into the Flutter app.
