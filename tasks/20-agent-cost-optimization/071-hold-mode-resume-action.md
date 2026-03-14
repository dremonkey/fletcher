# TASK-071: Hold Mode — Tappable Resume Action

**Status:** [ ] Not started
**Priority:** MEDIUM
**Epic:** 20 — Agent Cost Optimization

## Problem

When the system event says "tap to resume," there's no obvious tappable target. The mic button functionally works (tapping it enters voice mode, unmutes, triggers dispatch), but there's no visual connection between the hold message and the mic button. The user has to know the convention.

## Design Options

### Option A: Pulsing mic button (recommended)

When hold mode is active and the agent is absent, add a visual cue to the mic button:

- Slow amber pulse (1.5s period) on the mic button border — distinct from the breathing glow (500ms) used during active voice mode
- Optional: small "PAUSED" label below the mic button, fading in with the hold state

This leverages the existing mic button as the resume target (tap mic → voice mode → unmute → dispatch) without adding new UI elements. The pulsing signals "I'm waiting for you."

**Mic button states with hold mode:**

| State | Visual |
|---|---|
| Text mode, no hold | Static mic_off icon, no glow |
| Text mode, hold active | Slow amber pulse on border — "tap to resume" |
| Voice mode, active | Breathing glow (existing) |
| Voice mode, muted (via histogram) | Dimmed icon, no glow (existing) |

### Option B: Tappable system event card

Make the hold mode system event card tappable:

- `GestureDetector` on the `SystemEventCard` when the event is a hold event
- Tap triggers `toggleInputMode()` → voice mode → unmute → dispatch
- Card shows a subtle "tap" affordance (amber border instead of cyan, or a chevron icon)

Pro: direct connection between the message and the action.
Con: system event cards are currently non-interactive; making one tappable breaks the pattern.

### Option C: Dedicated hold banner

Show a dedicated overlay/banner above the VoiceControlBar when in hold state:

```
┌──────────────────────────────────────┐
│  ⏸  LIVE MODE PAUSED — TAP TO RESUME │  ← tappable amber banner
└──────────────────────────────────────┘
                [ 🎤 ]
```

Pro: highly discoverable, clear call-to-action.
Con: takes vertical space, adds a new widget type.

## Implementation (Option A)

### 1. Expose hold state to the widget layer

Add a getter to `LiveKitService`:

```dart
bool get isOnHold =>
    agentPresenceService.enabled &&
    agentPresenceService.state == AgentPresenceState.agentAbsent &&
    _lastDisconnectWasHold;
```

The `_lastDisconnectWasHold` flag is set when the agent disconnects due to hold mode and cleared when the agent reconnects or the user enters voice mode.

### 2. Add hold pulse to MicButton

New animation state in `MicButton`: when `isOnHold` is true and `isMuted` is true, use a slow 1.5s amber pulse on the border (distinct from the 500ms breathing glow). The pulse should be gentle — not alarming, just a subtle "I'm here, ready when you are."

### 3. Wire through VoiceControlBar

Pass `isOnHold` from `LiveKitService` to `MicButton` through `VoiceControlBar`.

## Files to Modify

- `apps/mobile/lib/services/livekit_service.dart` — add `isOnHold` getter, track `_lastDisconnectWasHold`
- `apps/mobile/lib/widgets/mic_button.dart` — add hold pulse animation state
- `apps/mobile/lib/widgets/voice_control_bar.dart` — pass `isOnHold` to MicButton

## Dependencies

- TASK-069 (hold mode visual treatment) — message text and status
- TASK-070 (suppress in text mode) — determines when hold state is visible
