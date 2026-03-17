# TASK-086: Macro Grid Widget & Action Dispatch

Build the `TuiMacroCluster` 3x3 grid widget, integrate it into `ConversationScreen` as a floating overlay, and wire tap dispatch through `LiveKitService.sendTextMessage()`.

**Architecture:** [docs/architecture/macro-shortcuts.md](../../docs/architecture/macro-shortcuts.md)
**PRD:** [vision/macro-shortcuts/PRD.macro-shortcuts.md](../../vision/macro-shortcuts/PRD.macro-shortcuts.md) -- FR 3.4, 3.5, 3.7; US-1, US-3, US-6, US-7

## Dependencies

- **Requires:** TASK-022 (MacroRegistry, Macro model, CommandPool -- must be complete)
- **Blocks:** None (TASK-085 and TASK-087 can proceed in parallel once TASK-022 is done)
- **Soft dependency:** TASK-085 (Picker UI) -- long-press and edit button trigger picker. Wire callbacks as no-ops until TASK-085 ships.

## Scope

**In scope:** `TuiMacroCluster` widget, ConversationScreen Stack integration, tap-to-dispatch via `sendTextMessage`, collapse/expand toggle, handedness positioning, edit button placeholder, accessibility labels, debounce, busy-state guard.

**Out of scope:** Picker UI (TASK-085), ACP command discovery (TASK-087), haptic feedback (post-MVP polish). The edit button and long-press callbacks are wired but produce no UI until TASK-085 ships.

## Implementation Checklist

### TuiMacroCluster Widget

File: `apps/mobile/lib/widgets/tui_macro_cluster.dart` (new)

- [ ] `TuiMacroCluster` StatefulWidget accepting: `MacroRegistry registry`, `void Function(int slotIndex) onTap`, `void Function(int slotIndex) onLongPress`
- [ ] Build a 3x3 grid using `Column` of 3 `Row`s (simpler than `GridView` for fixed 9 cells)
- [ ] Each cell: 44x44dp `GestureDetector` with `Container` (amber border, background fill, square corners)
- [ ] 2dp `SizedBox` gap between cells (total grid: 136x136dp)
- [ ] Bound slot: `AppColors.amber` border, `AppColors.background` fill, short label in `AppTypography.label` (monospace bold, uppercase)
- [ ] Empty slot: `AppColors.textSecondary` border, "+" label in `AppColors.textSecondary`
- [ ] Tap on bound slot: calls `onTap(slotIndex)` (after debounce)
- [ ] Tap on empty slot: calls `onLongPress(slotIndex)` (opens picker when available)
- [ ] Long-press on any slot: calls `onLongPress(slotIndex)`

### Tap Feedback

- [ ] On tap, briefly invert the button: `AppColors.amber` fill, `AppColors.background` text for 100ms, then revert
- [ ] Use a `_tapActiveSlot` state variable + `Timer` to manage the invert (no animation controller needed for 100ms flash)

### Debounce

- [ ] 300ms debounce per slot to prevent accidental double-taps
- [ ] Track `_lastTapTime` per slot (or a single `DateTime?` if global debounce is acceptable)
- [ ] Ignore taps within 300ms of the previous tap on the same slot

### Collapse/Expand Toggle

- [ ] Small toggle bar rendered below the grid (always visible, even when collapsed)
- [ ] Toggle button using `TuiButton` or styled `GestureDetector` with label `[<<<]` (expanded) or `[>>>]` (collapsed)
- [ ] Tapping toggle calls `MacroRegistry.toggleExpanded()` (persists state)
- [ ] When collapsed, only the toggle button renders (~24dp height)
- [ ] When expanded, full 3x3 grid + toggle renders

### Edit Button

- [ ] Small `[EDT]` button next to the collapse toggle (visible only when expanded)
- [ ] Tapping calls `onLongPress(-1)` or a separate `onEdit` callback (signals "open picker without a specific slot")
- [ ] Until TASK-085 ships, this callback is a no-op in ConversationScreen

### ConversationScreen Integration

File: `apps/mobile/lib/screens/conversation_screen.dart` (modify)

- [ ] Add `late final MacroRegistry _macroRegistry;` field to `_ConversationScreenState`
- [ ] In `initState()`: construct `MacroRegistry` with registered command names from `_liveKitService._commandRegistry.registeredCommands`
- [ ] In `initState()`: call `_macroRegistry.loadFromPrefs()` (async, fire-and-forget -- registry notifies when loaded)
- [ ] In `initState()`: call `_macroRegistry.addListener(_onStateChanged)` (same pattern as LiveKitService listener)
- [ ] In `dispose()`: call `_macroRegistry.removeListener(_onStateChanged)` and `_macroRegistry.dispose()`
- [ ] Wrap existing `Column` inside the `SafeArea` child in a `Stack`
- [ ] Add `Positioned` child for `TuiMacroCluster`:
  - `bottom: 72` (clears VoiceControlBar: 56dp bar + 16dp bottom SizedBox)
  - `right: 8` when `handedness == Handedness.right`
  - `left: 8` when `handedness == Handedness.left`
- [ ] Only render `TuiMacroCluster` when `_macroRegistry.isExpanded` is true (but always render the collapse toggle)

**Implementation note:** The `_commandRegistry` is currently a private field on `LiveKitService`. To pass registered commands to `MacroRegistry`, either: (a) expose a getter on `LiveKitService` for `registeredCommands`, or (b) hardcode the known commands (`['/help']`) at construction time and document the coupling. Option (a) is cleaner.

**Risk: Stack migration.** Wrapping Column in Stack is the only change to the critical ConversationScreen layout. The Column must remain the first child of Stack (fills the full space). The `Expanded` widget inside the Column still works because `Stack` does not impose tight constraints on its first (non-Positioned) child. Verify with layout tests.

### Action Dispatch

- [ ] `_handleMacroTap(int slotIndex)` method in `_ConversationScreenState`
- [ ] Resolve full command: `macro.command` + (macro.args != null ? ' ${macro.args}' : '')
- [ ] Check `_liveKitService.relayChatService?.isBusy ?? false` -- if busy AND in text mode, drop the tap
- [ ] On busy drop: flash the tapped button border red for 200ms (visual indication)
- [ ] On success: call `_liveKitService.sendTextMessage(fullCommand)`
- [ ] No special dispatch logic -- `sendTextMessage` handles slash commands, relay, and voice routing

**Implementation note:** The busy check only applies in text mode (`inputMode == TextInputMode.textInput`). In voice mode, `sendTextMessage` handles queuing via `_pendingTextMessages` and agent dispatch via `AgentPresenceService`. The macro grid does not need to know which mode is active beyond the busy guard.

### Handedness

- [ ] Read `_macroRegistry.handedness` in the `Positioned` widget
- [ ] `Handedness.right`: `right: 8, left: null`
- [ ] `Handedness.left`: `left: 8, right: null`

### Accessibility

- [ ] Each macro button wrapped in `Semantics(label: 'Macro button: ${macro.command}')` for bound slots
- [ ] Empty slots: `Semantics(label: 'Empty macro slot ${slotIndex + 1}. Tap to configure.')`
- [ ] `ExcludeSemantics` on the short label `Text` widget (redundant with Semantics label)
- [ ] Collapse toggle: `Semantics(label: 'Toggle macro grid visibility')`

## Tests

File: `apps/mobile/test/widgets/tui_macro_cluster_test.dart` (new)

**Note:** Tests follow the Flutter standard: `test/` directory, `_test.dart` suffix, mirror `lib/` structure.

### Widget Tests

- [ ] Grid renders 9 buttons (3 rows of 3) when given a MacroRegistry with 9 bound slots
- [ ] Bound slot shows the short label text (e.g., "HLP")
- [ ] Empty slot shows "+" text
- [ ] Tap on bound slot fires `onTap` callback with correct slotIndex
- [ ] Tap on empty slot fires `onLongPress` callback (not onTap)
- [ ] Long-press on bound slot fires `onLongPress` callback
- [ ] Collapse toggle hides the 3x3 grid and shows only the toggle button
- [ ] Expand after collapse shows the full grid again
- [ ] Handedness `right` positions grid on the right side (verify Positioned alignment)
- [ ] Handedness `left` positions grid on the left side
- [ ] Debounce: rapid double-tap within 300ms fires callback only once

### ConversationScreen Layout Verification

File: `apps/mobile/test/screens/conversation_screen_layout_test.dart` (new, if feasible without full LiveKit mocking -- otherwise document as manual verification)

- [ ] After Stack wrapper, DiagnosticsBar still renders at the top of the layout
- [ ] ChatTranscript still fills available space (Expanded works inside Stack)
- [ ] VoiceControlBar still renders at the bottom
- [ ] Error/reconnecting banner still displays when status is error/reconnecting
- [ ] SafeArea padding is still applied

**Note:** Full ConversationScreen widget tests require mocking `LiveKitService` (heavy dependency). If mocking is impractical, document these as manual verification items and focus automated tests on `TuiMacroCluster` in isolation.

## Definition of Done

- [ ] `TuiMacroCluster` widget renders a 3x3 grid matching the TUI Brutalist aesthetic
- [ ] Grid is visible at bottom-right of ConversationScreen (or bottom-left if handedness is left)
- [ ] Tapping a macro sends the command via `sendTextMessage()` and it appears in the chat transcript
- [ ] Collapse toggle hides/shows the grid; state persists across sessions
- [ ] Grid does not overlap the mic button or VoiceControlBar
- [ ] Busy-state tap is dropped with visual feedback
- [ ] Accessibility labels are present on all interactive elements
- [ ] All widget tests pass via `flutter test test/widgets/tui_macro_cluster_test.dart`
- [ ] ConversationScreen layout is verified not to regress (automated or manual)

## References

- [Epic 15: Macro Shortcuts](./EPIC.md)
- [Architecture: Macro Shortcuts](../../docs/architecture/macro-shortcuts.md) -- Grid UI, Layout Integration, Button Sizing, Visual Design, Collapse, Accessibility sections
- [PRD: Macro Shortcuts](../../vision/macro-shortcuts/PRD.macro-shortcuts.md) -- FR 3.4 (Grid UI), FR 3.5 (Handedness), FR 3.7 (Action Dispatcher)
- Layout reference: `apps/mobile/lib/screens/conversation_screen.dart` (current Column layout, VoiceControlBar positioning)
- Theme reference: `apps/mobile/lib/theme/tui_widgets.dart` (TuiButton, TuiCard design patterns)
- Theme reference: `apps/mobile/lib/theme/app_colors.dart` (AppColors.amber, background, textSecondary)
- Dispatch reference: `apps/mobile/lib/services/livekit_service.dart` lines 1590-1656 (sendTextMessage routing)
