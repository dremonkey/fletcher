# Fletcher Mobile App - UI/UX Specification

## Vision

A minimal, voice-first conversational interface. Dark background with a single amber orb that responds to voice. No clutter - pure conversation.

## Core Design Principles

1. **Voice-first**: No typing, no buttons during conversation
2. **Ambient presence**: App auto-connects, always ready
3. **Single visual focus**: One orb, one purpose
4. **Hidden complexity**: Transcript available but not visible by default

---

## App States & Orb Behavior

| State | Orb Appearance | Description |
|-------|----------------|-------------|
| **Connecting** | Soft pulse, dimmed | App launching, connecting to LiveKit |
| **Idle/Listening** | Gentle ambient glow | Connected, waiting for speech |
| **User Speaking** | Ripples outward | Reacts to user's voice amplitude |
| **Processing** | Subtle shimmer | AI is thinking (between user stop & AI start) |
| **AI Speaking** | Pulses inward/outward | Synced to AI voice amplitude |
| **Muted** | Dim, static | User toggled listening off |
| **Error** | Red tint, static | Connection lost or error |

---

## Screen Layout

```
┌─────────────────────────────────┐
│                                 │
│         (status bar)            │  ← System status bar only
│                                 │
│                                 │
│                                 │
│                                 │
│            ┌─────┐              │
│            │     │              │
│            │  ◉  │              │  ← Amber Orb (center)
│            │     │              │
│            └─────┘              │
│                                 │
│                                 │
│                                 │
│                                 │
│              ◦                  │  ← Mute toggle (small, subtle)
│                                 │
└─────────────────────────────────┘
```

---

## Interactions

### Primary
- **Tap orb**: No action (voice-only interaction)
- **Tap mute toggle**: Toggle listening on/off

### Gestures
- **Swipe up from bottom**: Reveal transcript drawer
- **Swipe down on transcript**: Hide transcript drawer

### Transcript Drawer (Hidden by Default)

```
┌─────────────────────────────────┐
│            ┌─────┐              │
│            │  ◉  │              │  ← Orb moves up
│            └─────┘              │
├─────────────────────────────────┤
│  ─────  (drag handle)  ─────    │
│                                 │
│  You: What's the weather?       │
│                                 │
│  Fletcher: It's 72°F and sunny  │
│  in San Francisco today.        │
│                                 │
│  You: Thanks                    │
│                                 │
└─────────────────────────────────┘
```

---

## Color Palette

| Element | Color | Hex |
|---------|-------|-----|
| Background | Near black | `#0D0D0D` |
| Orb (idle) | Warm amber | `#F59E0B` |
| Orb (glow) | Lighter amber | `#FBBF24` |
| Orb (user speaking) | Bright amber | `#FCD34D` |
| Mute icon | Dim gray | `#4B5563` |
| Mute icon (active) | Amber | `#F59E0B` |
| Error state | Soft red | `#EF4444` |
| Transcript text | Off-white | `#E5E7EB` |
| Transcript bg | Dark gray | `#1F1F1F` |

---

## Animation Specifications

### Orb - Idle State
- Soft, slow breathing animation (scale 1.0 → 1.02 → 1.0)
- Cycle duration: 4 seconds
- Subtle outer glow with gaussian blur

### Orb - User Speaking
- Ripple rings emanate outward from center
- Ring count: 2-3 concurrent
- Ring speed tied to voice amplitude
- Rings fade out as they expand

### Orb - AI Speaking
- Orb scale pulses with voice amplitude (1.0 → 1.15)
- Glow intensity increases with amplitude
- Smooth easing (ease-in-out)

### Orb - Processing
- Subtle rotation of internal gradient
- Slight shimmer effect
- Duration: until AI starts speaking

### Transitions
- State transitions: 300ms ease-in-out
- Transcript drawer: 250ms spring animation

---

## File Structure

```
lib/
├── main.dart                    # App entry, auto-connect logic
├── screens/
│   └── conversation_screen.dart # Main (only) screen
├── widgets/
│   ├── amber_orb.dart          # The orb widget + animations
│   ├── mute_toggle.dart        # Mute button
│   └── transcript_drawer.dart  # Pull-up transcript
├── services/
│   └── livekit_service.dart    # LiveKit connection & audio
└── models/
    └── conversation_state.dart # State management
```

---

## Implementation Order

1. **Scaffold & Auto-connect** - Dark theme, LiveKit connection on launch
2. **Amber Orb (Static)** - Centered orb with idle glow
3. **Orb Animations** - Breathing, ripples, pulses tied to audio levels
4. **Mute Toggle** - Small toggle at bottom
5. **Transcript Drawer** - Swipe-up gesture, scrollable history
