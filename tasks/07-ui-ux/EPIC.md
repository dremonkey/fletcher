# Epic: UI Redesign — TUI Brutalist (07-ui-ux)

Complete UI redesign for the Fletcher Flutter app adopting a TUI-inspired, 8-bit, brutalist aesthetic. Chat transcript is front and center. Artifacts are first-class citizens with inline buttons, a bottom sheet drawer, and a browsable list modal.

## Mockups
Reference designs live in [`mockups/`](./mockups/):
- [`chat-main-view.png`](./mockups/chat-main-view.png) — Main screen: waveform, status bar, chat transcript, mic button
- [`artifact-drawer.png`](./mockups/artifact-drawer.png) — Bottom sheet showing a single artifact with syntax-highlighted code
- [`artifacts-list.png`](./mockups/artifacts-list.png) — Full-screen modal listing all session artifacts

## Design Philosophy
Fletcher's UI takes inspiration from **terminal user interfaces**, **8-bit hardware dashboards**, and **brutalist web design**. The intent is to feel like a _sovereign instrument_ — purpose-built, no-nonsense, visually distinct from every other chat app.

**Core principles:**
- **Monospace everything.** Text is the interface. Monospace font signals precision and intentionality. No sans-serif, no variable-width fonts anywhere.
- **Box-drawing characters as structure.** Corner brackets (`┌─ AGENT ─┐`), pipe separators (`|`), and horizontal rules (`---`) replace rounded cards and soft shadows. The UI is _drawn_ in characters.
- **Amber on black.** The primary palette echoes CRT terminals: amber (#FFB300) on near-black (#121212). Cyan (#00E5FF) is the secondary accent — used for system/diagnostic data, agent waveform, and status text. The two colors create a warm/cool tension.
- **No decoration without function.** Every visual element earns its place. No gradients, no shadows (except functional glow on health indicators), no rounded corners. Borders are 1px solid. Backgrounds are flat.
- **Information density over whitespace.** The status bar packs real-time metrics into a single line. Artifact buttons are inline with text. The waveform is compact. Screen real estate is used, not wasted.
- **8-bit texture.** The waveform uses discrete vertical bars (not smooth curves). This pixel-stepped quality carries through to the overall feel — sharp, quantized, intentionally low-fi in a high-fi world.

## Design Direction
- **Chat-first layout** — scrollable chat transcript is the primary content area (replaces the Amber Orb as center of the UI)
- **Compact waveform** — 8-bit dual-color (amber user / cyan agent) histogram bar at the top
- **Mic button with state** — bottom-anchored mic inherits Amber Orb behaviors (spinner during thinking, pulse during speaking)
- **Artifact system** — inline `[ARTIFACT: NAME]` buttons in chat, bottom sheet drawer for single artifacts, full-screen list modal via `[ ARTIFACTS: N ]` button
- **Live diagnostics** — real-time `SYS: OK | VAD: 0.82 | RT: 12ms` status bar with tri-color health orb, tappable for expanded view

## Tasks

### New Direction (TUI Redesign)
- [x] 016: TUI Brutalist Design System — foundational theme tokens, typography, border decorators, color palette
- [x] 017: Chat-First Main View — chat transcript as primary content, compact waveform top, mic button bottom with orb states
- [x] 018: Artifact System Redesign — inline artifact buttons, bottom sheet drawer, artifacts list modal, counter button
- [x] 019: Live Diagnostics Status Bar — real-time VAD/RT/SYS metrics, tri-color health orb, tappable expanded view

### Session Awareness
- [ ] 020: Inline Connection & Room Events — boot sequence + runtime network/room/agent events as inline cards in chat stream

### Retained Tasks
- [~] 015: Single Audio Ack + Visual Spinner — Phases 1-2 complete; spinner behavior migrates to mic button in task 017

### Superseded
- ~~008: Collaborative Waveform~~ — absorbed into 017 (compact 8-bit waveform bar at top of chat-first layout)

### Completed (Voice Pipeline)
- [~] 014: Human-Centric Interruption Handling — Phase 1 done (tuned sensitivity); Phase 3 (soft TTS fade) needs SDK support
