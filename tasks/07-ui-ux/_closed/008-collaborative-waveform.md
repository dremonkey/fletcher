# 008: Collaborative Waveform

Implement an 8-bit histogram/audio graph for the main conversation view with dual-color blending and front-and-center transcript display.

## Description
The "Collaborative Waveform" replaces the current simple visualizer with a high-fidelity 8-bit style histogram that represents the dual-audio interaction between the user and the agent.

### Key Requirements
1. **8-bit Histogram/Audio Graph:**
   - Visual representation of audio levels (user vs agent).
   - "8-bit" aesthetic (discrete vertical bars/steps).
   - Rolling buffer for continuous movement.

2. **Dual-Color Blending:**
   - User color (Amber/Orange) vs Agent color (Cyan/Blue).
   - Smooth blending/transition between colors when both are active or switching states.
   - Represents the "handshake" of conversation visually.

3. **Front-and-Center Transcript:**
   - Bring the live transcript from the drawer to the main view.
   - High readability, prominently placed above or integrated with the waveform.
   - Real-time updates as STT/TTS events arrive.

## Technical Details
- **Component:** `CollaborativeWaveformPainter` (CustomPainter)
- **State:** Connect to `Participant.audioLevel` for both Local (User) and Remote (Agent) participants.
- **Blending:** Use `Color.lerp` or shader-based blending for the visual transitions.
- **Transcript:** Use a sliding text window or overlay for the "Front-and-Center" experience.

## Acceptance Criteria
- [ ] Waveform accurately reflects audio levels of both user and agent.
- [ ] Visual transitions between user and agent colors are smooth and intuitive.
- [ ] Live transcript is easily readable without opening the drawer.
- [ ] 8-bit aesthetic is consistent with the Fletcher design language.
