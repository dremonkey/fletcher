# Figma Make AI Prompt — Macro Shortcuts UI

## Context

This prompt is for generating UI designs in Figma Make for the Fletcher macro shortcuts feature. Attach the screenshots from `screenshots/` as visual references when submitting.

**Attach these files:**
- `screenshots/chat-mode-with-events.png` — current chat mode layout
- `screenshots/voice-mode-idle.png` — current voice mode layout
- `screenshots/diagnostics-panel.png` — diagnostics bottom sheet
- `screenshots/mockup-chat-main-view.png` — reference design mockup

---

## Prompt

Design a **macro shortcut grid** and **command picker bottom sheet** for a mobile voice agent app. The app uses a **TUI Brutalist** design language — monospace typography, sharp square corners, no border radius, neon accents on dark backgrounds. See the attached screenshots for the existing app.

### Design System Tokens

**Colors:**
- Background: `#121212` (near-black)
- Surface/cards: `#1A1A1A` (dark gray)
- Primary accent: `#FFB300` (amber) — borders, labels, active states
- Secondary accent: `#00E5FF` (cyan) — system info, diagnostics
- Text primary: `#FFFFFF`
- Text secondary: `#888888`
- Success: `#00FF00`, Warning: `#FFD600`, Error: `#FF1744`

**Typography:** Monospace only (JetBrains Mono or similar). Sizes: 11–14sp. Labels and buttons are ALL_CAPS and bold.

**Spacing:** 4dp grid. Cards use 12dp padding. Screen edges use 16dp margins. Gaps between elements: 4–8dp.

**Corners:** Zero border radius everywhere. All rectangles are sharp.

**Borders:** 1–2px outlines, no fills. Cards use a 2px colored left border stripe.

---

### Screen 1: Macro Grid Overlay (Expanded)

Design a **3×3 floating button grid** overlaid on the chat transcript, anchored to the **bottom-right** corner of the screen, positioned **above the voice control bar** (72dp from bottom, 8dp from right edge).

**Grid specs:**
- 9 square buttons, each **44×44dp**
- **2dp gaps** between buttons
- Total footprint: ~136×136dp

**Button states:**
- **Bound (filled):** Amber (#FFB300) 1px border, very subtle amber background tint (~8% opacity). 3–4 character label in monospace bold uppercase (e.g., `HLP`, `MEM`, `BUG`, `TST`, `SUM`, `CTX`, `GIT`, `UND`, `PLN`). Text color: amber.
- **Empty:** Border color `#888888` at 40% opacity. Label: `+` in secondary text color.

**Default 3×3 layout:**
```
[HLP] [MEM] [BUG]
[TST] [SUM] [CTX]
[GIT] [UND] [PLN]
```

**Below the grid:** A small collapse toggle bar. Label: `[◀◀◀]` in overline text. Tapping it collapses the grid.

**Below the toggle:** A small `[EDT]` button (edit) in overline text, opens the picker.

Show this overlaid on the chat transcript from the attached screenshots. The grid should feel like a floating HUD element — present but not obstructing the main content.

---

### Screen 2: Macro Grid Overlay (Collapsed)

Same screen but with the grid collapsed. Only the **expand toggle** is visible: a small `[▶▶▶]` label in the bottom-right corner (same position as the grid anchor). Minimal footprint — just enough to tap to expand.

---

### Screen 3: Command Picker Bottom Sheet

A bottom sheet that slides up when the user long-presses a macro slot or taps `[EDT]`. Follows the app's existing bottom sheet pattern (see diagnostics panel screenshot).

**Header:** Use box-drawing characters: `┌─ BIND MACRO: SLOT 3 ─┐` in amber, bold monospace.

**Command list:** Scrollable list of available commands. Each row is a card with:
- **Command name** in amber text (e.g., `/memory`, `/help`, `/plan`)
- **Description** in secondary gray text below the name (e.g., "Manage long-term memory")
- **Hint** in secondary text, if present (e.g., `[search|add|list] [text]`)
- **Source badge** at top-right of row: `[LOCAL]` or `[AGENT]` in 11sp overline, muted color

Row background: `#1A1A1A`. No left border stripe on these rows — keep them clean. Subtle 1px bottom border between rows at ~10% white.

**Bottom action:** `[CLEAR SLOT]` button in red outline, only visible when editing an already-bound slot.

---

### Screen 4: Label Prompt Dialog

A small centered dialog that appears after selecting a command from the picker.

**Header:** `┌─ LABEL ─┐` in amber.

**Content:** A single text input field pre-filled with a derived 3–4 character abbreviation (e.g., `MEM`). Monospace, uppercase, max 4 characters. Input field has amber bottom border (underline style), no box border.

**Actions:** Two buttons side by side:
- `[CANCEL]` — outline, secondary color
- `[BIND]` — outline, amber

Dialog background: `#1A1A1A` with amber 1px border. No rounded corners. No shadow — use a semi-transparent dark scrim behind it.

---

### Screen 5: Tap Feedback State

Show the grid with **one button in active/pressed state**: the tapped button inverts — amber (#FFB300) fill background with dark (#121212) text. All other buttons remain in their default bound state. This flash lasts 100ms.

Also show one variant where a tap is **rejected** (agent is busy): the tapped button flashes with a red (#FF1744) border instead.

---

### General Notes

- **No rounded corners anywhere.** Every rectangle, button, input, card, and dialog has sharp 90° corners.
- **No drop shadows.** Use scrim overlays (semi-transparent dark) for depth instead.
- **Monospace font only.** No sans-serif or serif.
- **Portrait phone layout** (e.g., 393×852dp — Pixel 9 dimensions).
- The grid is a floating overlay — it sits **on top of** the chat transcript, not in the layout flow. Chat content scrolls behind it.
- Keep the aesthetic consistent with the attached screenshots: dark, utilitarian, terminal-inspired, amber-on-black.
