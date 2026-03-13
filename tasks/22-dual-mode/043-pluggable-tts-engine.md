# Task 043: Pluggable TTS Engine Abstraction

**Epic:** 22 — Dual-Mode Architecture
**Status:** [ ] Not started
**Priority:** Medium
**Depends on:** 054 (Mobile ACP Client — provides the streaming text deltas)

## Problem

Chat mode streams text responses into the transcript but has no voice output. Users who want audio feedback in chat mode (e.g., hands-free with keyboard STT) have no option. Voice mode uses server-side TTS (Google/Piper via the agent), but chat mode bypasses the agent entirely.

## Goal

Define a `TtsEngine` interface in Dart with pluggable implementations so chat mode can speak responses aloud using client-side TTS. Engine selection is a user preference.

## Design

### Interface

```dart
abstract class TtsEngine {
  /// Speak a sentence. Completes when audio finishes.
  Future<void> speak(String text);

  /// Stop any in-progress speech immediately.
  Future<void> stop();

  /// Stream of engine state (idle, speaking, error).
  Stream<TtsEngineState> get state;

  /// Human-readable name for settings UI.
  String get displayName;

  /// Release resources.
  Future<void> dispose();
}

enum TtsEngineState { idle, speaking, error }
```

### Implementations

1. **NativeTtsEngine** — Wraps `flutter_tts`. Free, offline, platform voices. Default.
2. **CartesiaTtsEngine** — REST/WebSocket API → audio bytes → `just_audio` playback. 40ms TTFA. Requires API key.
3. **GeminiTtsEngine** — Google GenAI SDK with audio response modality. Requires API key.

### Sentence buffering

Relay streams text deltas word-by-word via `RelayContentDelta`. Buffer into sentence-sized chunks (split on `.!?` followed by whitespace) before feeding to `TtsEngine.speak()`. This avoids calling TTS per-word while keeping latency low.

### Engine selection

Persisted in `SharedPreferences`. Selectable from a settings screen (or inline toggle). Default: `NativeTtsEngine`.

## Files

- `apps/mobile/lib/services/tts/tts_engine.dart` — interface + state enum
- `apps/mobile/lib/services/tts/native_tts_engine.dart` — `flutter_tts` wrapper
- `apps/mobile/lib/services/tts/cartesia_tts_engine.dart` — Cartesia API client
- `apps/mobile/lib/services/tts/gemini_tts_engine.dart` — Gemini audio API
- `apps/mobile/lib/services/tts/sentence_buffer.dart` — delta accumulator with sentence splitting
- `apps/mobile/lib/services/livekit_service.dart` — wire sentence buffer into `_sendViaRelay()` response handling

## Acceptance Criteria

- [ ] `TtsEngine` interface defined with `speak()`, `stop()`, `state`, `dispose()`
- [ ] `NativeTtsEngine` implemented using `flutter_tts`
- [ ] Sentence buffer accumulates `RelayContentDelta` text and emits on sentence boundaries
- [ ] Chat mode responses are spoken aloud when TTS is enabled
- [ ] Engine selection persisted in `SharedPreferences`
- [ ] `stop()` interrupts speech immediately (e.g., on new user input)
- [ ] Unit tests for sentence buffer logic
- [ ] CartesiaTtsEngine and GeminiTtsEngine are stretch goals — NativeTTS is the MVP
