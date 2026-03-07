# Epic: UI Redesign — TUI Brutalist (07-ui-ux)

Complete UI redesign for the Fletcher Flutter app adopting a TUI-inspired, 8-bit, brutalist aesthetic. Chat transcript is front and center. Artifacts are first-class citizens with inline buttons, a bottom sheet drawer, and a browsable list modal.

## Design Direction
- **TUI-inspired brutalist design** — monospace typography, corner-bracket headers (`┌─ AGENT`), sharp rectangles, no rounded corners
- **8-bit aesthetic** — discrete vertical bars in waveform, pixel-sharp borders, high contrast
- **Color palette** — dark background (#121212), amber (#FFB300) primary accent, cyan (#00E5FF) secondary accent
- **Chat-first layout** — scrollable chat transcript is the primary content area (replaces the Amber Orb as center of the UI)
- **Compact waveform** — 8-bit dual-color (amber user / cyan agent) histogram bar at the top
- **Mic button with state** — bottom-anchored mic inherits Amber Orb behaviors (spinner during thinking, pulse during speaking)
- **Artifact system** — inline `[ARTIFACT: NAME]` buttons in chat, bottom sheet drawer for single artifacts, full-screen list modal via `[ ARTIFACTS: N ]` button
- **Live diagnostics** — real-time `SYS: OK | VAD: 0.82 | RT: 12ms` status bar with tri-color health orb, tappable for expanded view

## Tasks

### New Direction (TUI Redesign)
- [ ] 016: TUI Brutalist Design System — foundational theme tokens, typography, border decorators, color palette
- [ ] 017: Chat-First Main View — chat transcript as primary content, compact waveform top, mic button bottom with orb states
- [ ] 018: Artifact System Redesign — inline artifact buttons, bottom sheet drawer, artifacts list modal, counter button
- [ ] 019: Live Diagnostics Status Bar — real-time VAD/RT/SYS metrics, tri-color health orb, tappable expanded view

### Retained Tasks
- [ ] 009: Persistent History Discovery — fetch recent history from OpenClaw on rejoin, add Session List UI
- [~] 015: Single Audio Ack + Visual Spinner — Phases 1-2 complete; spinner behavior migrates to mic button in task 017

### Superseded
- ~~008: Collaborative Waveform~~ — absorbed into 017 (compact 8-bit waveform bar at top of chat-first layout)

### Completed (Voice Pipeline)
- [~] 014: Human-Centric Interruption Handling — Phase 1 done (tuned sensitivity); Phase 3 (soft TTS fade) needs SDK support
