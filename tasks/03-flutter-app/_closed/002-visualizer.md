# Task: Amber Heartbeat Visualizer ✅

## Description
Implement the "Amber Heartbeat" visualizer that reacts to voice intensity.

## Checklist
- [x] Research voice intensity data from `livekit_client`.
    - Audio levels from LocalAudioTrack.currentBitrate
    - Audio levels from RemoteAudioTrack.currentBitrate
    - 50ms polling interval for smooth updates
- [x] Create custom animations for conversation states:
    - Breathing animation (idle) - gentle 4s ease-in-out scale
    - Pulse animation (AI speaking) - responds to aiAudioLevel
    - Ripple animation (user speaking) - expands outward
    - Shimmer overlay (processing) - rotating sweep gradient
- [x] Link real-time audio levels to visualizer intensity.
    - userAudioLevel drives ripple trigger
    - aiAudioLevel drives pulse scale (1.0 → 1.15)
- [x] Polish UI/UX for voice-first experience:
    - Dark theme with amber accent
    - State-based color changes (amber → bright amber → red)
    - Opacity changes for muted/error states
    - Minimal UI - just orb and mute toggle

## Implementation
- `lib/widgets/amber_orb.dart` - Full visualizer with:
    - ConversationStatus-based rendering
    - TickerProviderStateMixin for multiple animations
    - Ripple management with automatic cleanup
    - State table: Connecting, Idle, UserSpeaking, Processing, AISpeaking, Muted, Error
