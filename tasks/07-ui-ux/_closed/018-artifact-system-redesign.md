# TASK-018: Artifact System Redesign

## Status
- **Status:** Complete
- **Priority:** Medium
- **Depends on:** 016 (TUI Design System), 017 (Chat-First Main View)
- **Owner:** Claude
- **Created:** 2026-03-07
- **Completed:** 2026-03-07

## Context
The current `ArtifactViewer` displays artifacts in a dedicated drawer. The new design integrates artifacts more tightly into the chat flow with three interaction layers:

1. **Inline buttons** in chat messages that reference artifacts
2. **Bottom sheet drawer** for viewing a single artifact
3. **Full-screen list modal** for browsing all session artifacts

## Reference
- **Mockups:** [`chat-main-view.png`](./mockups/chat-main-view.png) (inline buttons), [`artifact-drawer.png`](./mockups/artifact-drawer.png) (bottom sheet), [`artifacts-list.png`](./mockups/artifacts-list.png) (list modal)
- **Design philosophy:** See [EPIC.md — Design Philosophy](./EPIC.md#design-philosophy)

## Components

### 1. Inline Artifact Buttons (in chat messages)
- Rendered within agent `TuiCard` messages where artifacts are referenced
- Style: `TuiButton` (from task 016) — amber-bordered rectangle, monospace text: `[ARTIFACT: NAME]`
- **Touch target: minimum 48dp height** even though the visual button may appear compact. Use internal padding to reach 48dp.
- Horizontal padding: `AppSpacing.md` (12dp) inside the button
- Spacing between multiple artifact buttons: `AppSpacing.sm` (8dp)
- Tapping opens the artifact drawer (bottom sheet) for that artifact
- `HapticFeedback.lightImpact()` on tap
- Artifacts are detected from ganglia `artifact` events and associated with the most recent agent message

### 2. Artifact Drawer (Bottom Sheet)
- Use `showModalBottomSheet` with `isScrollControlled: true` for height control
- Covers **~60-70% of screen height** (`initialChildSize: 0.65`, `maxChildSize: 0.85` if using `DraggableScrollableSheet`)
- Chat remains partially visible above (natural `showModalBottomSheet` behavior — dims background)
- Sharp corners: `shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero)`
- **Amber top border:** 2dp solid amber line at the top of the sheet
- Background: `AppColors.surface`

**Header layout:**
```
┌─ ARTIFACT_NAME ─┐                    [CODE]
```
- Left: `TuiHeader` with artifact name
- Right: type badge — `TuiButton`-styled chip showing `[CODE]`, `[LOG]`, `[DIFF]`, `[TEXT]`, `[SEARCH]`, `[ERROR]`
- Header height: 48dp minimum (tappable badge)
- Padding: `AppSpacing.base` (16dp) horizontal

**Content area:**
- **Code:** Line numbers (amber `textSecondary`, right-aligned) + syntax-highlighted content (monospace 13sp). Use existing code rendering from `ArtifactViewer`, restyled. Wrap in `SingleChildScrollView` with both horizontal and vertical scroll.
- **Logs:** Monospace plain text, no line numbers
- **Diffs:** `+` lines in green, `-` lines in red, context lines in `textSecondary`
- **Markdown:** Rendered with TUI styling (monospace, amber links, no images)
- **Search results:** File path + line number + matching content per result
- **Errors:** Error message in `healthRed`, stack trace in `textSecondary`
- Content padding: `AppSpacing.base` (16dp)

**Dismiss:** Drag down or tap outside (standard `showModalBottomSheet` behavior). Support system back button via `PopScope` if needed.

**Async states:**
- **Loading:** Show `TuiHeader` + centered monospace "Loading..." text (if artifact content arrives asynchronously)
- **Empty:** "No content" in `textSecondary`
- **Error:** Error message in `healthRed` with "Dismiss" `TuiButton`

### 3. Artifacts List Modal
- Use `showGeneralDialog` with `TuiModal` (from task 016) for full-screen TUI-styled overlay
- Amber border around entire modal, dark background
- **Header:** `TuiHeader` showing `┌─ ARTIFACTS (N)` on left, `IconButton` close (`Icons.close`) on right
- Close button: **48x48dp minimum** touch target (use `IconButton` which enforces this)
- `HapticFeedback.lightImpact()` on close

**Artifact list:**
- Use `ListView.builder` for the artifact list (could grow with long sessions)
- Each artifact card: `TuiCard` with:
  - **Title:** Artifact name in monospace bold, 14sp
  - **Preview:** 2-3 lines of content, truncated with ellipsis, in `textSecondary`, 12sp
  - **Card height:** minimum 72dp (two-line list item guideline)
- Spacing between cards: `AppSpacing.sm` (8dp)
- **Active/latest artifact:** Highlighted with amber border (others have `textSecondary` border or no border)
- Tapping a card: `HapticFeedback.lightImpact()`, dismiss modal, open artifact drawer for that artifact
- **Empty state:** Centered monospace text "No artifacts in this session" in `textSecondary`
- Padding: `AppSpacing.base` (16dp) around the list

**Transition:** Use `PageRouteBuilder` with a fade or slide-up transition (250-350ms, `Curves.easeOut`).

### 4. Artifacts Counter Button (Status Bar)
- Positioned in the diagnostics status bar right side (task 019)
- Shows `[ ARTIFACTS: N ]` where N is the count of artifacts in the current session
- Style: `TuiButton` — amber border, monospace text, 12sp
- **Touch target:** Full button area >= 48dp height (the status bar row should be at least 48dp)
- Tapping opens the Artifacts List Modal
- `HapticFeedback.lightImpact()` on tap
- Updates in real-time as new artifacts arrive via data channel
- Hidden or shows `[ ARTIFACTS: 0 ]` when no artifacts exist

## Data Flow
- Artifacts arrive via `ganglia-events` data channel (existing `artifact` event type in `ArtifactEvent`)
- Store artifacts in the existing `ConversationState.artifacts` list (already there)
- Associate artifacts with chat messages by timestamp proximity (artifact arrives during or shortly after an agent message)
- The artifacts counter in the status bar reads from `state.artifacts.length`

## Migration Notes
- The existing `ArtifactViewer` widget is refactored into the new bottom sheet drawer pattern
- Existing artifact rendering logic (code blocks, diffs, markdown) is preserved but restyled with TUI theme
- The `ArtifactChip` in the current chip row is replaced by the status bar counter button
- The existing `showArtifactDrawer()` function is replaced by the new `showModalBottomSheet` implementation

## Acceptance Criteria
- [x] Inline `[ARTIFACT: NAME]` buttons render in agent chat messages with >= 48dp touch target
- [x] Tapping an inline button opens the bottom sheet drawer with that artifact
- [x] Bottom sheet has sharp corners, amber top border, TUI header with type badge
- [x] Bottom sheet shows artifact with appropriate formatting (code, log, diff, text, search, error)
- [x] Bottom sheet handles loading, empty, and error states
- [x] `[ ARTIFACTS: N ]` button in status bar shows current count with >= 48dp touch target
- [x] Tapping artifacts button opens the full-screen list modal
- [x] List modal has amber border, TUI header, 48dp close button
- [x] Artifacts list uses `ListView.builder`, shows name + preview per card (min 72dp height)
- [x] Empty state: "No artifacts in this session"
- [x] Tapping a list item opens the bottom sheet for that artifact
- [x] All components use TUI brutalist styling (monospace, corner brackets, amber borders, sharp corners)
- [x] Haptic feedback on all tappable elements (light impact)
- [x] All spacing on 4dp grid, all colors from `AppColors`
