# TASK-016: TUI Brutalist Design System

## Status
- **Status:** Not started
- **Priority:** High (foundational — other UI tasks depend on this)
- **Owner:** TBD
- **Created:** 2026-03-07

## Context
Fletcher is adopting a new visual direction: a TUI-inspired, 8-bit, brutalist design language. This task establishes the foundational design system that all other UI tasks build on.

## Reference
- **Mockups:** All three in [`mockups/`](./mockups/) — these are the canonical visual reference
- **Design philosophy:** See [EPIC.md — Design Philosophy](./EPIC.md#design-philosophy)

## Design Tokens

### Colors
- **Background:** `#121212` (near-black)
- **Primary accent (amber):** `#FFB300` — borders, user labels, artifact buttons, mic button
- **Secondary accent (cyan):** `#00E5FF` — agent waveform color, diagnostics text, status data
- **Text (primary):** `#FFFFFF` — message body text
- **Text (secondary):** `#888888` — timestamps, separators
- **Glow/shadow:** `rgba(255, 179, 0, 0.3)` — amber glow on active elements
- **Health green:** `#00FF00` — diagnostics OK state
- **Health yellow:** `#FFD600` — diagnostics warning state
- **Health red:** `#FF1744` — diagnostics error state

### Typography
- **Font family:** Monospace throughout (system monospace or a pixel/retro font like `JetBrains Mono`, `IBM Plex Mono`, or `Press Start 2P` for headers)
- **Message body:** 14px monospace
- **Labels (USER/AGENT):** 12px monospace, bold, uppercase
- **Status bar:** 11px monospace
- **Artifact badges:** 11px monospace, uppercase

### Border Decorators
- TUI-style corner brackets: `┌─`, `─┐`, `└─`, `─┘`
- Single-pixel borders in amber for agent messages and artifact cards
- No rounded corners anywhere — sharp rectangles only
- Message separators: `---` (thin horizontal rule)

### Components
- **Message cards:** Dark card with left amber border (agent) or no border (user), `┌─ AGENT` / `┌─ USER` header
- **Buttons:** Amber-bordered rectangles with monospace text, no fill (outline style)
- **Modals:** Full amber border, dark background, `┌─ TITLE ─┐` header pattern
- **Bottom sheets:** Amber top border accent line

## Implementation
- Create a `FletcherTheme` or `TuiTheme` class with all design tokens
- Define reusable `BoxDecoration`, `TextStyle`, and widget constants
- Create a `TuiCornerBracket` widget for the `┌─ LABEL` pattern
- Ensure all colors are defined as named constants (no magic hex values in widgets)

## Acceptance Criteria
- [ ] Design token constants defined and importable
- [ ] `TuiCornerBracket` / header decorator widget implemented
- [ ] Monospace typography applied globally
- [ ] Theme integrates with Flutter's `ThemeData` system
- [ ] No rounded corners or gradient fills in any component
- [ ] Existing amber color scheme migrated to new token values
