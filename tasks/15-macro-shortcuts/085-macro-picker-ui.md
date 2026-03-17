# TASK-085: Macro Command Picker UI

Build the bottom sheet UI for browsing the command pool and binding commands to macro grid slots.

**Architecture:** [docs/architecture/macro-shortcuts.md](../../docs/architecture/macro-shortcuts.md)
**PRD:** [vision/macro-shortcuts/PRD.macro-shortcuts.md](../../vision/macro-shortcuts/PRD.macro-shortcuts.md) -- FR 3.6 (Command Picker); US-2, US-4

## Dependencies

- **Requires:** TASK-022 (MacroRegistry, CommandPool, Macro model, `deriveLabel()`)
- **Requires:** TASK-086 (TuiMacroCluster -- provides the long-press and `[EDT]` trigger callbacks)
- **Optional:** TASK-087 (ACP command discovery -- picker works with local commands only if agent commands have not arrived)

## Scope

**In scope:** Bottom sheet picker UI (`MacroPickerSheet`), command list rendering, label prompt dialog, slot binding via `MacroRegistry.bind()`, clear slot via `MacroRegistry.clear()`, live update when `CommandPool` changes.

**Out of scope:** Custom command creation (user typing a free-text command), command search/filter, drag-to-reorder slots, command argument prompting on bind. These are post-MVP considerations.

## Implementation Checklist

### Picker Entry Point

File: `apps/mobile/lib/widgets/macro_picker_sheet.dart` (new)

- [ ] Top-level function `showMacroPickerSheet(BuildContext context, {required MacroRegistry registry, required int slotIndex})` following the pattern of `showTranscriptDrawer` and `showArtifactsListModal`
- [ ] Calls `showModalBottomSheet` with `isScrollControlled: true`, `backgroundColor: Colors.transparent`
- [ ] Returns a `DraggableScrollableSheet` or constrained-height container (max 70% of screen height)

### MacroPickerSheet Widget

File: `apps/mobile/lib/widgets/macro_picker_sheet.dart` (same file)

- [ ] `MacroPickerSheet` StatefulWidget accepting: `MacroRegistry registry`, `int slotIndex`
- [ ] Listens to `registry` for live updates (command pool may change while picker is open -- standard ChangeNotifier pattern)
- [ ] Container: `TuiModal` with title `"BIND MACRO: SLOT ${slotIndex + 1}"`

### Command List

- [ ] Scrollable `ListView.builder` of `registry.commandPool.all`
- [ ] Each row rendered as a `TuiCard` with:
  - Command name in `AppColors.amber` using `AppTypography.body` (monospace)
  - Description below in `AppColors.textSecondary` using `AppTypography.body`
  - Hint (if present) appended to description in dimmer text, e.g., `"  [search|add] [text]"`
  - Source badge aligned right: `[LOCAL]` or `[AGENT]` in `AppTypography.label` (overline style)
- [ ] Tapping a row triggers the label prompt with the selected command
- [ ] If `commandPool.all` is empty, show a centered message: `"No commands available. Connect to an agent to discover commands."`

### Clear Slot Action

- [ ] "CLEAR SLOT" `TuiButton` at the bottom of the list (below all commands)
- [ ] Only visible when the target slot currently has a macro bound (not null)
- [ ] Tapping calls `registry.clear(slotIndex)` and dismisses the picker (`Navigator.pop`)

### Label Prompt Dialog

- [ ] After user taps a command row, show a dialog (using `showDialog` or a custom overlay)
- [ ] Title: `"LABEL"` in `TuiHeader` style
- [ ] `TextField` pre-filled with `deriveLabel(selectedCommand.name)`
- [ ] `TextField` styling: monospace, uppercase (via `TextCapitalization.characters` and input formatter)
- [ ] Max length: 4 characters (enforced via `maxLength` or `LengthLimitingTextInputFormatter`)
- [ ] Two buttons: `[CANCEL]` (dismisses dialog, returns to picker) and `[BIND]` (binds and dismisses)
- [ ] On `[BIND]`: create `Macro(slotIndex: slotIndex, shortLabel: label, command: selectedCommand.name, args: null, source: selectedCommand.source)`, call `registry.bind(slotIndex, macro)`, dismiss both dialog and picker

### TUI Brutalist Aesthetic

- [ ] Square borders throughout (no border radius)
- [ ] Monospace fonts for command names and labels
- [ ] High contrast: amber on near-black background
- [ ] Use existing `TuiModal`, `TuiCard`, `TuiButton`, `TuiHeader` from `apps/mobile/lib/theme/tui_widgets.dart`

### Wiring to TuiMacroCluster (TASK-086 Integration)

File: `apps/mobile/lib/screens/conversation_screen.dart` (modify -- update existing TASK-086 code)

- [ ] Replace the no-op `onLongPress` callback in ConversationScreen with: `(slotIndex) => showMacroPickerSheet(context, registry: _macroRegistry, slotIndex: slotIndex)`
- [ ] Replace the no-op `onEdit` / `[EDT]` callback with a picker invocation (slot 0 as default, or first empty slot)

## Tests

File: `apps/mobile/test/widgets/macro_picker_sheet_test.dart` (new)

### Widget Tests

- [ ] Picker renders a list of commands from a mock MacroRegistry's CommandPool
- [ ] Each command row shows name, description, and source badge
- [ ] Command with hint shows hint text
- [ ] Tapping a command row opens the label prompt dialog
- [ ] Label prompt pre-fills with auto-derived label (`deriveLabel` output)
- [ ] Tapping `[BIND]` in label prompt calls `registry.bind()` with correct slot and macro
- [ ] Tapping `[CANCEL]` in label prompt returns to picker (does not bind)
- [ ] `[CLEAR SLOT]` button visible when slot has an existing binding
- [ ] `[CLEAR SLOT]` button hidden when slot is empty
- [ ] Tapping `[CLEAR SLOT]` calls `registry.clear(slotIndex)`
- [ ] Empty command pool shows "No commands available" message
- [ ] Picker rebuilds when CommandPool updates via ChangeNotifier (mock a notifyListeners after adding agent commands)

## Definition of Done

- [ ] Long-pressing a macro slot opens the picker bottom sheet
- [ ] Picker displays all commands from the command pool with name, description, hint, and source badge
- [ ] Selecting a command and entering a label binds the macro to the target slot
- [ ] The macro grid updates immediately after binding (ChangeNotifier reactivity)
- [ ] Clear slot removes the macro and the grid shows "+" for that slot
- [ ] Label prompt auto-derives a sensible abbreviation and allows user override
- [ ] Picker works with local commands only (agent commands not required)
- [ ] All widget tests pass via `flutter test test/widgets/macro_picker_sheet_test.dart`

## References

- [Epic 15: Macro Shortcuts](./EPIC.md)
- [Architecture: Macro Shortcuts](../../docs/architecture/macro-shortcuts.md) -- Command Picker (MacroPickerSheet) section, Label Prompt section
- [PRD: Macro Shortcuts](../../vision/macro-shortcuts/PRD.macro-shortcuts.md) -- FR 3.6 (Command Picker); US-2 (Customize grid), US-4 (Browse commands)
- Bottom sheet pattern: `apps/mobile/lib/widgets/transcript_drawer.dart` (`showTranscriptDrawer` function pattern)
- Bottom sheet pattern: `apps/mobile/lib/widgets/artifact_viewer.dart` (`showArtifactsListModal` function pattern)
- Theme reference: `apps/mobile/lib/theme/tui_widgets.dart` (TuiModal, TuiCard, TuiButton, TuiHeader)
