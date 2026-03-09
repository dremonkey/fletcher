# Epic 17: Text Input Mode

**Status:** 🚧 In Progress
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

**Decision:** Text messages route through the LiveKit data channel (`ganglia-events` topic) with event type `text_message`. This keeps everything within the existing voice session and avoids adding a separate HTTP code path. The agent-side Ganglia plugin needs a handler for the `text_message` event type to inject the text into the LLM pipeline.

## Tasks

### State Management ✅
- [x] [001: Add TextInputMode State to ConversationBloc](./001-text-input-mode-state.md)
- [x] [002: Implement Long-Press Gesture Detector on Mic Button](./002-long-press-gesture-detector.md)
- [x] [003: Add Mode Toggle Logic (Voice-First ↔ Text-Input)](./003-mode-toggle-logic.md)

### Animation & Layout ✅
- [x] [004: Implement Sliding Animation for Mic Button](./004-mic-button-slide-animation.md)
- [x] [005: Implement Expanding/Sliding Animation for Text Input Field](./005-text-field-expand-animation.md)
- [x] [006: Create AnimationController and Tween Setup](./006-animation-controller-setup.md)
- [x] [007: Handle Layout Reflow and Positioning for Hybrid State](./007-hybrid-state-layout.md)

### Text Input Functionality
- [x] [008: Add TextField Widget with TUI Brutalist Styling](./008-text-field-widget.md)
- [x] [009: Wire TextField to ConversationBloc.sendTextMessage()](./009-wire-text-to-bloc.md)
- [x] [010: Implement Text Message Routing (Data Channel vs HTTP)](./010-text-message-routing.md) ✅
- [x] [011: Update ChatTranscript to Render Text-Origin Messages](./011-chat-transcript-text-messages.md)
- [x] [012: Add Enter-Key Submission Handler](./012-enter-key-submission.md)
- [x] [013: Add Send Button (Visible in Text-Input Mode)](./013-send-button.md)

### Agent Integration ✅
- [x] [017: Agent-Side Text Message Handler](./017-agent-text-message-handler.md) ✅

### Polish
- [~] [014: Visual Feedback for Long-Press Detection](./014-long-press-feedback.md) — haptic done, visual cue deferred
- [x] [015: Ensure Text Field Auto-Focuses When Entering Text-Input Mode](./015-auto-focus-text-field.md)
- [x] [016: Ensure Keyboard Dismisses and Text Clears on Revert](./016-cleanup-on-revert.md)

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
