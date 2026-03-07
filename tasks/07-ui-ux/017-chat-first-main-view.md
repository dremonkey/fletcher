# TASK-017: Chat-First Main View Redesign

## Status
- **Status:** Not started
- **Priority:** High
- **Depends on:** 016 (TUI Design System)
- **Owner:** TBD
- **Created:** 2026-03-07

## Context
The current Fletcher UI centers on the Amber Orb visualizer with a pull-up transcript drawer. The new direction puts the chat transcript front and center as the primary content area, with a compact waveform at the top and a mic button at the bottom.

This is the core layout change — it restructures the entire main screen.

## Reference Mockups
- `Screenshots/Screenshot From 2026-03-06 23-47-03.png` — Main chat view

## Layout (top to bottom)

### 1. Compact 8-Bit Waveform Bar (top)
- Horizontal bar of discrete vertical bars (8-bit histogram style)
- Dual-color: amber for user audio levels, cyan for agent audio levels
- Driven by `Participant.audioLevel` for both local and remote participants
- Compact height (~40-50px), full width
- Supersedes task 008 (Collaborative Waveform) — the waveform is now a compact top element rather than a centerpiece

### 2. Diagnostics Status Bar (below waveform)
- See task 019 for full spec
- Left: `SYS: OK | VAD: 0.82 | RT: 12ms` with health orb
- Right: `[ ARTIFACTS: N ]` button

### 3. Chat Transcript (main content area)
- Scrollable list of message cards (see TUI message card format below)
- Auto-scrolls to latest message
- `┌─ USER` and `┌─ AGENT` headers on each message card
- Agent messages have amber left border or full amber card border
- `---` separator between exchange pairs
- Inline `[ARTIFACT: NAME]` buttons within agent messages (see task 018)
- Real-time updates as STT/TTS events arrive
- Replaces the current transcript drawer — transcript is no longer hidden

### 4. Mic Button (bottom, anchored)
- Centered microphone icon button
- **Inherits Amber Orb state behaviors:**
  - Idle: static amber mic icon
  - Listening: subtle pulse or glow
  - Thinking/processing: spinning arc overlay (from task 015 Phase 2)
  - Speaking: active pulse synced to agent audio
  - Muted: dimmed/crossed-out mic icon
- Tap to toggle mute (existing behavior)

## TUI Message Card Format
```
┌─ AGENT
│ Fletcher console initialized.
│ System diagnostics: NOMINAL
│ Voice Activity Detection: ACTIVE
│ Latency: 12ms
│
│ Ready for input.
│
│  ┌──────────────────────┐
│  │ [ARTIFACT: INIT_LOG] │
│  └──────────────────────┘
└──
```

## Migration Notes
- The `AmberOrb` widget is retired from center stage; its state machine logic (idle, listening, thinking, speaking) migrates to the mic button
- The existing `TranscriptDrawer` becomes the primary `ChatTranscript` widget (promoted from drawer to main view)
- The existing `AudioWaveform` CustomPainter is adapted to the compact 8-bit style at the top
- `_spinController` from task 015 moves to the mic button widget

## Acceptance Criteria
- [ ] Chat transcript is the primary content area (visible without pulling up a drawer)
- [ ] Compact 8-bit waveform bar at top reflects real audio levels (dual-color)
- [ ] Mic button at bottom shows conversation state (idle, listening, thinking, speaking, muted)
- [ ] Spinner overlay on mic button during thinking state
- [ ] Messages use TUI-style card format with corner bracket headers
- [ ] Auto-scroll to latest message with ability to scroll up
- [ ] Amber Orb removed from center of screen
- [ ] Existing mute toggle still works via mic button tap
