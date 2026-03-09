# Task 022: Implement Header TTS Toggle

**Status:** In Progress
**Epic:** 03-flutter-app
**Date:** 2026-03-08
**Spec Reference:** `docs/specs/brutalist-ui-spec.md` — Section 1.2 (TTS Toggle/Status)

---

## Objective

Refactor the header bar to split the existing monolithic `CompactWaveform` into a two-zone layout:

- **Left:** User voice-in histogram (existing `CompactWaveform` logic, user channel only)
- **Right:** Interactive TTS toggle with dual-state rendering

## Spec Requirements

### TTS Toggle States

| State | Visual | Interaction |
|-------|--------|-------------|
| TTS OFF | White text `"TTS OFF"` on dark background | Tap → enable TTS, switch to histogram |
| TTS ON | Agent audio histogram (amber, matching user side) | Tap → disable TTS, switch to text |

### Behavior

- Single-tap gesture to toggle between states
- State persists across sessions (already handled by `SessionStorage`)
- Histogram animates only when TTS is ON **and** agent is speaking
- Monospace font for "TTS OFF" text (brutalist aesthetic)
- Accessible: button semantics, focus indicator

## Implementation Plan

### New Widgets

1. **`TtsToggle`** (`widgets/tts_toggle.dart`)
   - Dual-state: text label vs. agent histogram
   - Wraps in `GestureDetector` for tap handling
   - Receives `voiceOutEnabled`, `agentAmplitudes`, `onToggle`

2. **`HeaderBar`** (`widgets/header_bar.dart`)
   - Row layout: `[UserHistogram | TtsToggle]`
   - 48dp height, full width
   - Replaces `CompactWaveform` in `ConversationScreen`

### State Management

- Add `voiceOutEnabled` convenience getter to `LiveKitService` (inverse of `textOnlyMode`)
- Existing `toggleTextOnlyMode()` method handles persistence and agent notification

### Screen Changes

- Replace `CompactWaveform(...)` with `HeaderBar(...)` in `ConversationScreen`
- Remove bottom-row TTS button (moved to header)

## Files Modified

- `lib/widgets/tts_toggle.dart` (new)
- `lib/widgets/header_bar.dart` (new)
- `lib/screens/conversation_screen.dart` (updated)
- `lib/services/livekit_service.dart` (minor: add getter)

## Acceptance Criteria

- [ ] Header splits into left user histogram + right TTS toggle
- [ ] Tapping TTS OFF shows "TTS OFF" text, tapping switches to agent histogram
- [ ] Agent histogram only animates when TTS ON and agent speaking
- [ ] State persists across sessions
- [ ] Bottom-row TTS button removed (replaced by header toggle)
- [ ] Brutalist aesthetic maintained (sharp corners, monospace, amber palette)
