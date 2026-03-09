# Epic 17: Text Input Mode

**Status:** 📋 Planned  
**Goal:** Add a text entry field to the Fletcher mobile app as a "safety hatch" for situations where voice is not the right medium.

## Purpose

Voice is not always the ideal input method:
- **Noisy environments** (cafes, streets, airports)
- **Quiet spaces** (libraries, meetings, late-night)
- **High-latency STT** (network drops, "nose hole" air gaps)
- **Precision corrections** (typos, technical terms, complex edits)

Text input provides a reliable fallback that maintains the same conversation context while bypassing the audio pipeline entirely.

## Requirements

- **Text entry field** in the main chat interface
- **Shared conversation context** — typed messages and spoken messages appear in the same transcript
- **Session continuity** — text input uses the same OpenClaw session as voice
- **UI integration** — follows TUI Brutalist design system (AppColors, AppTypography, TuiCard)
- **Send button** or Enter-key submission

### Interaction Design

**Trigger:**
- Long-press on the center **Mic button** (Amber Orb) to enter Text Input mode

**Animation/Transition:**
- Upon long-press detection, the Mic button **slides to the right-hand side**
- Simultaneously, a text input field **expands/slides in from the left** to fill the vacated space
- The transition should be smooth and fluid (~300-500ms)

**Hybrid State:**
- The UI is now in **'Text Input' mode** (Safety Hatch)
- Mic button remains visible on the right side (visual anchor)
- Text field occupies the center/left area for typing
- Designed for noisy/quiet environments or precision typing needs

**Reversion:**
- A second long-press on the Mic button (now positioned on the right)
- Mic button **slides back to center position**
- Text input field **disappears** (slides out or fades)
- App returns to **'Voice-First' mode**

## Architecture

```
User types message in TextField
    ↓
ConversationBloc.sendTextMessage()
    ↓
LiveKitService.sendDataChannelMessage()
    OR
    Direct HTTP to OpenClaw API
    ↓
Agent processes via same pipeline
    ↓
Response appears in ChatTranscript
```

**Open Question:** Should text messages route through the LiveKit data channel (`ganglia-events` topic) or go directly to the OpenClaw HTTP API? Data channel keeps everything within the existing voice session; HTTP API provides a separate, more reliable path when audio is degraded.

## Tasks

### State Management
- [ ] 001: Add `TextInputMode` state to ConversationBloc (voice-first vs text-input)
- [ ] 002: Implement long-press gesture detector on Mic button (Amber Orb)
- [ ] 003: Add mode toggle logic (voice-first ↔ text-input) on long-press

### Animation & Layout
- [ ] 004: Implement sliding animation for Mic button (center → right, right → center)
- [ ] 005: Implement expanding/sliding animation for text input field (left → center)
- [ ] 006: Create AnimationController and Tween setup for smooth transitions (~300-500ms)
- [ ] 007: Handle layout reflow and positioning for hybrid state

### Text Input Functionality
- [ ] 008: Add TextField widget with TUI Brutalist styling
- [ ] 009: Wire TextField to ConversationBloc.sendTextMessage()
- [ ] 010: Implement text message routing (data channel vs HTTP)
- [ ] 011: Update ChatTranscript to render text-origin messages
- [ ] 012: Add Enter-key submission handler
- [ ] 013: Add send button (visible in text-input mode)

### Polish
- [ ] 014: Visual feedback for long-press detection (haptic, visual cue)
- [ ] 015: Ensure text field auto-focuses when entering text-input mode
- [ ] 016: Ensure keyboard dismisses and text clears when reverting to voice-first mode

## Success Criteria

- Users can type messages in the Fletcher app
- Typed messages appear in the same chat transcript as spoken messages
- Agent responds to typed input using the same session/context as voice
- Text input works even when voice pipeline is degraded (network issues, TTS failures)

## Dependencies

- Epic 11 (TUI Brutalist UI) — design system and ChatTranscript component
- Epic 4 (Ganglia) — session routing and message handling

## Related Issues

- [BUG-028](../../docs/field-tests/20260304-buglog.md) — Network drops and "nose hole" air gaps
- [BUG-030](../../docs/field-tests/20260307-buglog.md) — Unidirectional Blackout (no transcript flowing)
