# TASK-059: Voice Mode Bottom Bar — Inline Histogram with Mic Button

**Status:** [x] Complete
**Priority:** MEDIUM
**Epic:** 7 — UI Redesign (TUI Brutalist)

## Problem

The user and agent histograms (HeaderBar) are always visible at the top of the screen, even in chat/text mode where they show flat zeros. This wastes vertical space and is visually confusing — the histograms are a voice-mode concern but occupy permanent screen real estate.

## Design

Move the histograms into the bottom bar, inline with the mic button. They should only appear when voice mode is active (mic on).

### Layout States

**Mic OFF (chat mode):**
```
┌─────────────────────────────────────────┐
│                                         │
│              ChatTranscript             │
│                                         │
├─────────────────────────────────────────┤
│              [ 🎤 ]                     │  ← mic centered, no histograms
└─────────────────────────────────────────┘
```

**Mic ON (voice mode) — animated transition:**
```
┌─────────────────────────────────────────┐
│                                         │
│              ChatTranscript             │
│                                         │
├─────────────────────────────────────────┤
│   ▐▐▐▌▐▌▐▐▐    [ 🎤 ]    ▐▌▐▐▌▐▐▐▐   │
│   user histo              agent histo   │
│   (tap=mute)              (tap=TTS off) │
└─────────────────────────────────────────┘
```

### Animation Sequence (mic tap → voice mode ON)

1. User taps mic button (currently centered)
2. Mic button animates to center of bottom bar (stays centered, but bar expands vertically if needed)
3. User histogram fades in on the **left** side of the mic
4. Agent histogram fades in on the **right** side of the mic
5. Histograms grow outward from the mic (scale from 0 → 1 width)

### Animation Sequence (mic tap → voice mode OFF)

1. Histograms fade out + shrink toward mic
2. Mic button stays centered
3. Bottom bar contracts to compact layout

### Histogram Interactions

| Tap Target | Action | Stays in Voice Mode? |
|------------|--------|---------------------|
| Mic button | Toggle mute (existing) | N/A — this is the mode toggle |
| User histogram (left) | Mute mic | **Yes** — user stays in voice mode but muted |
| Agent histogram (right) | Toggle TTS on/off | Yes — mirrors existing TTS toggle behavior |

**Key distinction:** Tapping the user histogram mutes but keeps voice mode active (histograms stay visible, agent can still speak). This is different from tapping the mic button itself, which exits voice mode entirely.

### Visual Specs

Reuse existing histogram painters from `HeaderBar` / `TtsToggle`:

- **User histogram:** 15 bars, 3.75dp width, 2.5dp gap, cyan (`#00E5FF`), right-to-left (newest toward mic)
- **Agent histogram:** 15 bars, 3.75dp width, 2.5dp gap, amber (`#FFB300`), left-to-right (newest toward mic)
- **Quantization:** 8 levels (same stepped/8-bit look)
- **When muted (user):** histogram dims to 0.3 opacity, bars drop to zero
- **When TTS off (agent):** show "TTS OFF" label (existing behavior from `TtsToggle`)

### Animation Specs

- **Duration:** 300ms
- **Curve:** `easeOutCubic`
- **Histogram fade:** opacity 0 → 1, synchronized with width scale
- **Stagger:** user histogram starts 50ms before agent histogram for a subtle cascade effect

## Implementation Plan

### 1. Remove HeaderBar histogram

- Remove user histogram and TTS toggle from `HeaderBar`
- HeaderBar becomes either empty (remove entirely) or repurposed for other info
- If HeaderBar is removed, reclaim the 48dp + 4dp spacer vertical space for ChatTranscript

### 2. Create `VoiceControlBar` widget

New widget replacing `TextInputBar` (or wrapping it):

```dart
class VoiceControlBar extends StatefulWidget {
  final bool isMuted;
  final bool voiceOutEnabled;
  final List<double> userWaveform;
  final List<double> aiWaveform;
  final VoidCallback onToggleMute;
  final VoidCallback onToggleTts;
  final VoidCallback onMuteOnly;  // mute without exiting voice mode
  final Function(String) onSendText;
  // ...
}
```

### 3. Wire into ConversationScreen

- Replace `TextInputBar` + `HeaderBar` with `VoiceControlBar`
- Pass waveform data, mute state, TTS state
- Handle the three tap targets (mic, user histo, agent histo)

### 4. Update LiveKitService

- May need a new `muteOnly()` method distinct from the existing mute toggle (which currently also controls voice mode activation via `AgentPresenceService`)
- Or: add a parameter to distinguish "mute + exit voice mode" from "mute but stay in voice mode"

## Files to Modify

- `apps/mobile/lib/widgets/header_bar.dart` — remove histogram, simplify or delete
- `apps/mobile/lib/widgets/text_input_bar.dart` — extend or replace with VoiceControlBar
- `apps/mobile/lib/widgets/tts_toggle.dart` — extract painter for reuse, may delete widget
- `apps/mobile/lib/screens/conversation_screen.dart` — rewire layout
- `apps/mobile/lib/services/livekit_service.dart` — add `muteOnly()` if needed

## Dependencies

- Hold mode (TASK-011, Epic 20) — hold mode's "on hold" state should also hide histograms (agent absent = no voice mode)
