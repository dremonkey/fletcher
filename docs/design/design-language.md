# Fletcher Design Language

## Visual Identity

Fletcher uses a **TUI Brutalist** aesthetic — a terminal-inspired, high-contrast interface with monospace typography, sharp corners, and neon accent colors on dark backgrounds. Every pixel is functional; nothing is decorative.

The look evokes a hardware diagnostic console or retro command terminal, reinforcing Fletcher's identity as a developer power tool rather than a consumer chat app.

## Color Palette

### Core

| Token | Hex | Usage |
|-------|-----|-------|
| `background` | `#121212` | Main scaffold, screen backgrounds |
| `surface` | `#1A1A1A` | Cards, modals, elevated surfaces |
| `amber` | `#FFB300` | Primary accent — borders, labels, mic button, active states |
| `cyan` | `#00E5FF` | Secondary accent — system events, diagnostics, data channel |
| `textPrimary` | `#FFFFFF` | Body text, primary content |
| `textSecondary` | `#888888` | Muted text, timestamps, hints, inactive labels |

### Status

| Token | Hex | Usage |
|-------|-----|-------|
| `healthGreen` | `#00FF00` | Healthy / success |
| `healthYellow` | `#FFD600` | Degraded / warning |
| `healthRed` | `#FF1744` | Error / unhealthy |

### Special

| Token | Usage |
|-------|-------|
| `amberGlow` | `#FFB300` @ 30% opacity — breathing glow on mic button, ambient effects |
| Amber @ 60% | Border accents on TuiHeader box-drawing characters |
| Amber @ 38% | Muted/disabled state for interactive elements |

### Color Rules

- **Two accents only**: amber (primary action) and cyan (system/info). No other hues except status indicators.
- **No gradients** on surfaces. Gradients appear only in animated elements (orb shimmer, mic spin).
- **Borders, not fills**: Cards use colored left borders (2px), not background fills. Buttons use outlines, not solid backgrounds.
- **Status colors are literal**: green = good, yellow = degraded, red = bad. No semantic overloading.

## Typography

**Font**: Monospace (platform default; JetBrains Mono preferred if bundled).

All text is monospace. No sans-serif or serif anywhere in the app.

| Style | Size | Weight | Usage |
|-------|------|--------|-------|
| `body` | 14sp | w400 (regular) | Message text, main content |
| `label` | 12sp | w700 (bold) | Section headers, role labels (USER/AGENT), button text |
| `statusMetric` | 12sp | w500 (medium) | Diagnostics metrics (RT, tokens, latency) |
| `artifactBadge` | 12sp | w500 (medium) | Artifact type badges (CODE, DIFF, TEXT) |
| `artifactContent` | 13sp | w400 (regular) | Code/log content in artifact viewers |
| `overline` | 11sp | w500 (medium) | Timestamps, minimal metadata |

### Typography Rules

- **All-caps** for labels, headers, button text, role names (USER, AGENT, DIAGNOSTICS).
- **No font size below 11sp.** Dense but legible.
- **No typographic hierarchy beyond bold/regular.** Size range is intentionally narrow (11–14sp).

## Spacing

4dp base grid. Consistent across all components.

| Token | Value | Usage |
|-------|-------|-------|
| `xs` | 4dp | Minimal gaps, tight list spacing |
| `sm` | 8dp | Small padding, inter-element gaps |
| `md` | 12dp | Card content padding |
| `base` | 16dp | Standard padding, screen edge margins, section gaps |
| `lg` | 24dp | Large separation between major sections |
| `xl` | 32dp | Extra large spacing |
| `xxl` | 48dp | Reserved for major layout breaks |

## Components

### TuiHeader

Section header using Unicode box-drawing characters.

```
┌─ DIAGNOSTICS ─┐
```

- Characters: `U+250C` (┌), `U+2500` (─), `U+2510` (┐)
- Text: uppercase, `label` style
- Color: configurable (default amber), border at 60% opacity

### TuiCard

Primary content container.

- Background: `surface` (#1A1A1A)
- Corners: **sharp** (BorderRadius.zero) — never rounded
- Left border: 2px colored stripe (amber for messages, cyan for system events, red for errors)
- Padding: `md` (12dp) all sides
- No shadows, no elevation

### TuiButton

Interactive button element.

- Height: 36dp visible (48dp touch target with padding)
- Style: **outline** (border, not filled)
- Text: monospace, uppercase
- Colors: amber (default), cyan, red depending on context
- Active state: opacity change, no elevation
- Minimum touch target: 48dp

### TuiModal

Full-screen or bottom-sheet overlay.

- Full border in configurable color (default amber)
- TuiHeader at top
- Padding: `base` (16dp) all around
- Column layout
- Background: `surface`

### MicButton

Central voice control, 56x56dp square.

- Sharp corners (no border radius)
- States:
  - **Idle**: amber border, breathing glow (500ms cycle, 15–35% opacity)
  - **Muted**: dimmed to 38% opacity, dashed mic icon
  - **Processing**: spinning arc overlay (1200ms rotation)
  - **AI Speaking**: pulse glow synced to audio level
  - **Error**: red border
- Haptic feedback on tap

### CompactWaveform

8-bit style audio histogram, 48dp height.

- Split design: user bars (left, amber) + agent bars (right, cyan)
- 15 bars per side, 3px width, 2px gaps
- 8 discrete height levels (quantized, not smooth)
- Sharp corners on all bars

### SystemEventCard

Inline system event display.

- Cyan left border
- Row: `[prefix] [TYPE] [message] [timestamp]`
- Prefix symbols: `⚡` (network), `•` (room), `•` (agent)
- Text animates on status change (300ms crossfade)

### DiagnosticsBar

Compact top bar showing system health.

- Format: `SYS: OK | VAD: 0.82 | RT: 12ms | TOK: 87K / 1M`
- Tri-color health square (green/yellow/red) at left
- `[ARTIFACTS: N]` button at right (amber border)
- Monospace, `statusMetric` style

### Diagnostics Panel (Bottom Sheet)

Expanded view of system metrics.

- TuiHeader: `┌─ DIAGNOSTICS ─┐`
- Key-value rows: cyan labels (left-aligned), white values (right-aligned)
- Rows: SYS, CONNECTION, STT, TTS, LLM, VAD, TOKENS, RT, SESSION, AGENT, UPTIME
- Error line at bottom in red if present

## Layout Structure

Portrait-only, single-column layout.

```
┌────────────────────────────────────┐
│ DiagnosticsBar (compact, ~32dp)    │ SYS/VAD/RT + [ARTIFACTS: N]
├────────────────────────────────────┤
│ ChatTranscript (fills remaining)   │ Scrollable message list
│  ├ Agent messages (amber border)   │
│  ├ User messages (no border)       │
│  ├ System events (cyan, inline)    │
│  ├ Tool calls (gray, compact)      │
│  ├ Thinking spinner (amber card)   │
│  └ Command results (green/red)     │
├────────────────────────────────────┤
│ VoiceControlBar (~56dp + padding)  │ Mic button + waveforms or text input
└────────────────────────────────────┘
```

### Voice Mode (bottom bar)

```
[user waveform ···] [🎤] [··· agent waveform]   [TTS OFF]
```

- Mic button centered, 56x56dp
- Waveforms expand from center outward (300ms easeOutCubic)
- Optional TTS toggle button at far right

### Text Input Mode (bottom bar)

```
[  Type a message...              ] [🎤]
```

- Text field fills width, mic button at right
- Keyboard pushes layout up
- 400ms easeInOutCubic reveal animation

## Interaction Patterns

- **Tap**: primary interaction (execute, toggle, navigate)
- **Long-press**: contextual actions (edit macro slot, view details)
- **Scroll**: transcript, bottom sheets
- **No swipe gestures** in primary navigation
- **Haptic feedback** on critical taps (mic mute, command execution)
- **300ms debounce** on rapid taps for destructive/dispatch actions

## Animation Principles

Animations are **functional, not decorative**. Every animation communicates state.

| What | Duration | Curve | Purpose |
|------|----------|-------|---------|
| Mic breathing glow | 500ms | easeInOut | "I'm alive and ready" |
| Mic spin (processing) | 1200ms | linear | "Working on it" |
| Waveform reveal | 300ms | easeOutCubic | "Voice is active" |
| Text field reveal | 400ms | easeInOutCubic | "Switching to text mode" |
| System event text swap | 300ms | default | "Status changed" |
| Chat auto-scroll | 200ms | easeOut | "New content arrived" |

No page transition animations. State changes are immediate.

## Design Principles

1. **Function over form.** No decoration. If it doesn't convey information or afford interaction, remove it.
2. **Terminal aesthetic.** Monospace, box-drawing characters, ALL_CAPS labels. The interface should feel like a powerful diagnostic tool.
3. **High contrast.** Dark backgrounds with bright neon accents. No pastels, no subtle palettes.
4. **Sharp edges.** Zero border radius everywhere. Square buttons, square cards, square inputs.
5. **Dense information.** Small type, tight spacing, minimal whitespace. Maximize content per screen.
6. **State through color.** Amber = active/primary, cyan = system/info, green/yellow/red = health. No icons for status — use color and text.
