# TASK-031/032: TTS Toggle Component + Agent Wiring

## Status
- **Status:** Complete
- **Priority:** High
- **Created:** 2026-03-08
- **Closed:** 2026-03-08
- **Phase:** Phase 1 — Header Refactor (Brutalist UI)
- **Depends On:** TASK-030 (header split layout)

## Summary

Created `TtsToggle` widget and wired it to the voice agent via data channel.

### What was built
- **TTS ON state:** Amber agent histogram bars (left-to-right, tappable)
- **TTS OFF state:** "TTS OFF" text in grey bordered box (matching histogram width)
- Single-tap toggles between states
- State persists via `SessionStorage`
- Sends `tts-mode: on/off` event via `ganglia-events` data channel
- TTS preference sent on initial room connect and reconnect
- Agent stops producing audio and ack chimes when TTS is OFF

### Files
- `apps/mobile/lib/widgets/tts_toggle.dart` — TtsToggle widget + AgentHistogramPainter
- `apps/mobile/lib/services/livekit_service.dart` — toggleTextOnlyMode, voiceOutEnabled getter, data channel wiring

## Acceptance Criteria
- [x] Component renders in right header column
- [x] Tap toggles between "TTS OFF" text and agent histogram
- [x] State persists across sessions via SessionStorage
- [x] Agent histogram animates only when agent is actively speaking
- [x] Toggling TTS OFF sends `tts-mode: off` event via data channel
- [x] Toggling TTS ON sends `tts-mode: on` event via data channel
- [x] TTS preference is sent on initial room connect
- [x] Agent stops producing audio when TTS is OFF
- [x] Toggling mid-conversation takes effect immediately
