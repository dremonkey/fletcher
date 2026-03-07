# TASK-018: Artifact System Redesign

## Status
- **Status:** Not started
- **Priority:** Medium
- **Depends on:** 016 (TUI Design System), 017 (Chat-First Main View)
- **Owner:** TBD
- **Created:** 2026-03-07

## Context
The current `ArtifactViewer` displays artifacts in a dedicated view. The new design integrates artifacts more tightly into the chat flow with three interaction layers:

1. **Inline buttons** in chat messages that reference artifacts
2. **Bottom sheet drawer** for viewing a single artifact
3. **Full-screen list modal** for browsing all session artifacts

## Reference Mockups
- `Screenshot From 2026-03-06 23-47-03.png` — Inline artifact buttons in chat
- `Screenshot From 2026-03-06 23-52-38.png` — Artifact drawer (bottom sheet)
- `Screenshot From 2026-03-06 23-51-44.png` — Artifacts list modal

## Components

### 1. Inline Artifact Buttons
- Rendered within agent chat messages where artifacts are referenced
- Style: amber-bordered rectangle with monospace text: `[ARTIFACT: NAME]`
- Tapping opens the artifact drawer (bottom sheet) for that artifact
- Artifacts are detected from ganglia `artifact` events and matched to messages

### 2. Artifact Drawer (Bottom Sheet)
- Slides up from the bottom, covering ~60-70% of the screen
- Chat remains partially visible above (dimmed/pushed up)
- **Header:** `┌─ ARTIFACT_NAME ─┐` on left, type badge `[CODE]` / `[LOG]` / `[DIFF]` / `[TEXT]` on right
- **Content area:**
  - Code: line numbers + syntax highlighting (monospace, colored tokens)
  - Logs: monospace plain text
  - Diffs: red/green line coloring
  - Markdown: rendered with TUI styling
- **Amber top border** accent line
- Drag down to dismiss, or tap outside

### 3. Artifacts List Modal
- Triggered by tapping `[ ARTIFACTS: N ]` button in the status bar
- Near-fullscreen overlay with amber border all around
- **Header:** `┌─ ARTIFACTS (N)` with `X` close button (top right)
- **Content:** Vertical list of artifact cards, each showing:
  - Artifact name (bold, monospace)
  - Preview snippet (2-3 lines of content, truncated)
  - Active/selected artifact highlighted with amber border
- Tapping a card opens the artifact drawer for that artifact
- Empty state: "No artifacts in this session"

### 4. Artifacts Counter Button (Status Bar)
- Positioned in the diagnostics status bar (right side)
- Shows `[ ARTIFACTS: N ]` where N is the count of artifacts in the current session
- Amber border, monospace text
- Tapping opens the Artifacts List Modal
- Updates in real-time as new artifacts arrive via data channel

## Data Flow
- Artifacts arrive via `ganglia-events` data channel (existing `artifact` event type)
- Store artifacts in a session-scoped list (artifact name, type, content, timestamp)
- Match artifacts to chat messages for inline button rendering
- The artifacts counter in the status bar reflects the current count

## Migration Notes
- The existing `ArtifactViewer` widget is refactored into the new bottom sheet drawer pattern
- Existing artifact rendering logic (code blocks, diffs, markdown) is preserved but restyled
- The `StatusBar` widget's artifact display is replaced by the new counter button

## Acceptance Criteria
- [ ] Inline `[ARTIFACT: NAME]` buttons render in agent chat messages
- [ ] Tapping an inline button opens the bottom sheet drawer with that artifact
- [ ] Bottom sheet shows artifact with appropriate formatting (code, log, diff, text)
- [ ] `[ ARTIFACTS: N ]` button in status bar shows current count
- [ ] Tapping artifacts button opens the full-screen list modal
- [ ] Artifacts list shows all session artifacts with name + preview
- [ ] Tapping a list item opens the bottom sheet for that artifact
- [ ] All components use TUI brutalist styling (monospace, corner brackets, amber borders)
