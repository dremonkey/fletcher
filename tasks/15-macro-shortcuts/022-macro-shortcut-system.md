# TASK-022: Macro Model & Registry Service

Build the data model, command pool, and registry service that manage macro slot bindings and persistence. This is the foundation for the entire macro shortcuts feature.

**Architecture:** [docs/architecture/macro-shortcuts.md](../../docs/architecture/macro-shortcuts.md)
**PRD:** [vision/macro-shortcuts/PRD.macro-shortcuts.md](../../vision/macro-shortcuts/PRD.macro-shortcuts.md) -- FR 3.1, 3.2, 3.3

## Dependencies

- **Requires:** None (first task in the epic)
- **Blocks:** TASK-086 (Grid Widget), TASK-087 (ACP Discovery), TASK-085 (Picker UI)

## Scope

**In scope:** Model classes, `CommandPool`, `MacroRegistry` ChangeNotifier, SharedPreferences persistence, default bindings, label auto-derivation, and unit tests.

**Out of scope:** No UI widgets, no ACP parsing, no `sendTextMessage` dispatch wiring, no ConversationScreen changes. Those are TASK-086, TASK-087, and TASK-085.

## Implementation Checklist

### Macro Model

File: `apps/mobile/lib/models/macro.dart` (new)

- [ ] `CommandSource` enum with values `local`, `agent`
- [ ] `Handedness` enum with values `right`, `left`
- [ ] `Macro` class with fields: `slotIndex` (int 0-8), `shortLabel` (String, 3-4 chars), `command` (String), `args` (String?), `source` (CommandSource)
- [ ] `Macro.toJson()` returning `Map<String, dynamic>` with all fields
- [ ] `Macro.fromJson(Map<String, dynamic>)` factory constructor
- [ ] `Macro` equality (`==`) and `hashCode` override (value semantics on all fields)

### PoolCommand Model

File: `apps/mobile/lib/models/macro.dart` (same file)

- [ ] `PoolCommand` class with fields: `name` (String), `description` (String), `hint` (String?), `source` (CommandSource)
- [ ] `PoolCommand` equality and `hashCode` override

### CommandPool

File: `apps/mobile/lib/services/macro_registry.dart` (new)

- [ ] `CommandPool` class with private `_localCommands` and `_agentCommands` lists (both `List<PoolCommand>`)
- [ ] `CommandPool.all` getter: returns merged list, deduped by `name` (agent entry wins when both sources have the same command name)
- [ ] `updateLocalCommands(List<PoolCommand>)` method to replace local commands
- [ ] `updateAgentCommands(List<PoolCommand>)` method to replace agent commands (full replacement, not incremental)

**Implementation note:** Dedup strategy -- iterate local commands, skip any whose `name` appears in the agent commands list. Then append all agent commands. This ensures agent metadata wins for shared names.

### MacroRegistry Service

File: `apps/mobile/lib/services/macro_registry.dart` (same file as CommandPool)

- [ ] `MacroRegistry extends ChangeNotifier`
- [ ] Private `_slots` field: `List<Macro?>` of length 9 (null = empty slot)
- [ ] Private `_commandPool` field: `CommandPool` instance
- [ ] Private `_handedness` field: `Handedness` (default `right`)
- [ ] Private `_isExpanded` field: `bool` (default `true`)
- [ ] Public getters: `slots` (unmodifiable list), `commandPool`, `handedness`, `isExpanded`
- [ ] `bind(int slot, Macro macro)` -- validates slot 0-8, assigns macro with matching slotIndex, calls `_persist()`, calls `notifyListeners()`
- [ ] `clear(int slot)` -- sets slot to null, calls `_persist()`, calls `notifyListeners()`
- [ ] `updateAgentCommands(List<PoolCommand> commands)` -- forwards to `_commandPool.updateAgentCommands()`, calls `notifyListeners()`
- [ ] `toggleExpanded()` -- flips `_isExpanded`, persists, calls `notifyListeners()`
- [ ] `toggleHandedness()` -- flips `_handedness`, persists, calls `notifyListeners()`

### Persistence

- [ ] Static const key `_keyBindings = 'fletcher_macro_bindings'`
- [ ] Static const key `_keyHandedness = 'fletcher_macro_handedness'`
- [ ] Static const key `_keyExpanded = 'fletcher_macro_expanded'`
- [ ] `loadFromPrefs()` async method: reads all 3 keys from SharedPreferences, applies to in-memory state, calls `notifyListeners()`
- [ ] On load: if bindings key is missing or JSON is unparsable (`FormatException`, `TypeError`), apply default bindings silently
- [ ] On load: if JSON array has fewer than 9 elements, pad with `null`; if more than 9, truncate to 9
- [ ] `_persist()` private async method: writes bindings JSON, handedness, and expanded state to SharedPreferences (fire-and-forget)
- [ ] Constructor initializes with default bindings synchronously; caller must call `loadFromPrefs()` after construction to overwrite from persistence

**Implementation note:** Follow the pattern in `SessionStorage` (`apps/mobile/lib/services/session_storage.dart`) for SharedPreferences usage. However, unlike SessionStorage (which is static), MacroRegistry is an instance-based ChangeNotifier. The async load pattern is: construct with defaults -> call `loadFromPrefs()` in the owning widget's `initState` -> registry emits `notifyListeners()` when prefs are loaded.

### Default Bindings

- [ ] Private `_defaultBindings()` method returning `List<Macro?>` of length 9
- [ ] Default set (from architecture doc):

| Slot | Label | Command | Source |
|------|-------|---------|--------|
| 0 | `HLP` | `/help` | local |
| 1 | `MEM` | `/memory` | agent |
| 2 | `BUG` | `check the bug log for open issues` | agent |
| 3 | `TST` | `run the test suite` | agent |
| 4 | `SUM` | `summarize what we've done this session` | agent |
| 5 | `CTX` | `what files are you looking at?` | agent |
| 6 | `GIT` | `show me the git status` | agent |
| 7 | `UND` | `undo the last change` | agent |
| 8 | `PLN` | `what's the plan?` | agent |

- [ ] Defaults applied only when no stored bindings exist (first launch)

### Label Auto-Derivation

- [ ] Top-level function `deriveLabel(String commandText)` -> `String` (3-4 chars, uppercase)
- [ ] Algorithm: extract last significant word from command text (skip prepositions/articles), take first 3 consonants, uppercase
- [ ] If fewer than 3 consonants available, include vowels to reach 3 characters
- [ ] If the input starts with `/`, strip the slash before processing
- [ ] Examples: `"memory"` -> `"MRY"`, `"help"` -> `"HLP"`, `"run the test suite"` -> `"TST"`, `"check the bug log for open issues"` -> `"SSS"` (issues)

### Local Commands Initialization

- [ ] On construction, read `CommandRegistry.registeredCommands` (currently returns `['help']`)
- [ ] Convert each to `PoolCommand(name: '/$name', description: <hardcoded>, source: CommandSource.local)`
- [ ] Pass to `_commandPool.updateLocalCommands()`

**Implementation note:** `CommandRegistry` is currently created in `LiveKitService` as a private field. The `MacroRegistry` constructor should accept a `List<String>` of registered command names (rather than a `CommandRegistry` reference) to avoid coupling. The caller (`ConversationScreen`) can read `CommandRegistry.registeredCommands` and pass the list.

## Tests

File: `apps/mobile/test/services/macro_registry_test.dart` (new)
File: `apps/mobile/test/models/macro_test.dart` (new)

**Note:** This project uses the standard Flutter test directory (`test/`) with `_test.dart` suffix. Tests mirror the `lib/` directory structure.

### Model Tests (`macro_test.dart`)

- [ ] Macro serialization round-trip: `Macro.fromJson(macro.toJson())` equals original
- [ ] Macro serialization with null args
- [ ] Macro equality: two macros with same fields are equal
- [ ] Macro inequality: different slotIndex produces different hashCode
- [ ] PoolCommand equality

### CommandPool Tests (`macro_registry_test.dart`)

- [ ] Merge with both local and agent commands returns all
- [ ] Dedup: agent command with same name as local command replaces local entry
- [ ] Agent-only pool (no local commands) returns agent commands
- [ ] Local-only pool (no agent commands) returns local commands
- [ ] Empty both sources returns empty list

### MacroRegistry Tests (`macro_registry_test.dart`)

- [ ] `bind()` assigns macro to correct slot and notifies listeners
- [ ] `clear()` removes macro from slot and notifies listeners
- [ ] `bind()` with out-of-range slot throws or is ignored (define behavior)
- [ ] Default bindings applied on first launch (no stored prefs)
- [ ] Persistence round-trip: bind macros, save, create new registry, load, verify bindings match
- [ ] Corruption fallback: set malformed JSON in prefs key, load, verify defaults applied
- [ ] Corruption fallback: set JSON array with wrong length, load, verify padding/truncation
- [ ] `toggleHandedness()` flips between right and left, persists
- [ ] `toggleExpanded()` flips between true and false, persists
- [ ] `updateAgentCommands()` updates command pool and notifies listeners

### Label Derivation Tests (`macro_registry_test.dart`)

- [ ] Standard: `"memory"` -> `"MRY"`
- [ ] Standard: `"help"` -> `"HLP"`
- [ ] Multi-word: `"run the test suite"` -> `"TST"` (last significant word)
- [ ] Slash command: `"/memory"` -> `"MRY"` (strip slash)
- [ ] All vowels: `"aeiou"` -> `"AEI"` (falls back to vowels)
- [ ] Single character: `"a"` -> `"A"` (handles gracefully)
- [ ] Empty string: returns reasonable fallback (e.g., `"---"`)

## Definition of Done

- [ ] `Macro` model with serialization and equality lives in `apps/mobile/lib/models/macro.dart`
- [ ] `CommandPool` and `MacroRegistry` live in `apps/mobile/lib/services/macro_registry.dart`
- [ ] `MacroRegistry` can be instantiated, loaded from prefs, and notifies listeners on bind/clear/toggle
- [ ] Persistence survives simulated app restart (save then load from mock SharedPreferences)
- [ ] Corruption fallback produces defaults, not crashes
- [ ] All unit tests pass via `flutter test test/services/macro_registry_test.dart test/models/macro_test.dart`
- [ ] No UI changes, no imports in ConversationScreen yet

## References

- [Epic 15: Macro Shortcuts](./EPIC.md)
- [Architecture: Macro Shortcuts](../../docs/architecture/macro-shortcuts.md) -- Macro Model, CommandPool, MacroRegistry, Persistence sections
- [PRD: Macro Shortcuts](../../vision/macro-shortcuts/PRD.macro-shortcuts.md) -- FR 3.1 (Macro Model), FR 3.2 (Macro Registry), FR 3.3 (Command Pool)
- Pattern reference: `apps/mobile/lib/services/session_storage.dart` (SharedPreferences usage)
- Pattern reference: `apps/mobile/test/services/command_registry_test.dart` (test file structure)
