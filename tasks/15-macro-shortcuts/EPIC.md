# Epic: Macro Shortcut System (15-macro-shortcuts)

Customizable 3x3 quick-action button grid for one-tap command execution from the mobile client. The third input modality (voice -> text -> macros), optimized for repetitive developer commands that don't warrant dictation or typing.

**Architecture:** [docs/architecture/macro-shortcuts.md](../../docs/architecture/macro-shortcuts.md)
**PRD:** [vision/macro-shortcuts/PRD.macro-shortcuts.md](../../vision/macro-shortcuts/PRD.macro-shortcuts.md)

## Design Direction
- **3x3 Macro Grid** -- compact brutalist buttons with 3-4 char labels (`[HLP]`, `[BUG]`, `[TST]`)
- **Thumb-zone anchored** -- bottom-right by default, mirrorable for left-handed use
- **Command dispatch** -- tapping a macro calls `LiveKitService.sendTextMessage()` (same path as typed input)
- **Developer-first** -- initial 9-macro set curated for OpenClaw dev workflows
- **ACP discovery** -- agent commands auto-populate the command pool via `available_commands_update`

## Tasks

### Phase 1: Model + Registry (MVP Foundation)
- [ ] 022: Macro Model & Registry Service -- `Macro` model, `CommandPool`, `MacroRegistry` (ChangeNotifier), SharedPreferences persistence, default macro set, unit tests
  - Macro model: slotIndex, shortLabel, command, args, source
  - CommandPool: merges local CommandRegistry + agent commands, dedup (agent wins)
  - MacroRegistry: 9 slots, bind/clear/toggle, persistence round-trip
  - Default bindings: 9 curated dev-workflow macros (see architecture doc)
  - Tests: model serialization, pool merge, registry CRUD, persistence, corruption fallback
  - **Blocks:** TASK-086, TASK-087, TASK-085

### Phase 2: Grid UI + Dispatch (MVP Shippable)
- [ ] 086: Macro Grid Widget & Action Dispatch -- `TuiMacroCluster` 3x3 grid, ConversationScreen Stack integration, tap dispatch via sendTextMessage, collapse/expand, handedness
  - TuiMacroCluster: 44dp square buttons, TUI Brutalist aesthetic, tap feedback (100ms invert)
  - ConversationScreen: wrap Column in Stack, add Positioned overlay (bottom-right, 72dp above VoiceControlBar)
  - Dispatch: tap calls `LiveKitService.sendTextMessage(macro.command + args)`, busy check (drop tap if RelayChatService.isBusy), 300ms debounce
  - Collapse: toggle button always visible, expanded/collapsed persisted in SharedPreferences
  - Handedness: right (default) / left positioning, persisted preference
  - Accessibility: Semantics labels with full command name
  - Tests: widget tests (render, tap, layout), collapse toggle, handedness flip
  - **Requires:** TASK-022

### Phase 3: ACP Command Discovery (can run in parallel with Phase 2)
- [ ] 087: ACP available_commands_update Parser -- extend AcpUpdateParser with AcpAvailableCommandsUpdate type, wire through RelayChatService to MacroRegistry
  - New AcpUpdate subclass: AcpAvailableCommandsUpdate with List<AcpCommand>
  - Parse availableCommands JSON array from session/update payload
  - Graceful fallback to AcpNonContentUpdate on malformed payload
  - RelayChatService: add onAvailableCommandsUpdate callback
  - LiveKitService: forward ACP commands to MacroRegistry.updateAgentCommands()
  - Tests: parser unit tests (valid, malformed, empty), integration callback test
  - **Requires:** TASK-022 (does NOT require TASK-086)

### Phase 4: Picker UI
- [ ] 085: Macro Command Picker UI -- bottom sheet for browsing command pool and binding commands to slots
  - Trigger: long-press on macro slot or [EDT] button
  - Command list: scrollable ListView of CommandPool.all with name, description, hint, source badge
  - Label prompt: auto-derived abbreviation (first 3 consonants), editable, max 4 chars
  - Clear slot action
  - TUI Brutalist aesthetic (TuiModal, monospace, high contrast)
  - Tests: widget tests (list render, selection, label prompt, clear)
  - **Requires:** TASK-022, TASK-086. Optional: TASK-087 (picker works with local commands only)

## Task Dependency Graph

```
TASK-022 (Model + Registry)
  |
  +-------> TASK-086 (Grid UI + Dispatch) ----+
  |                                            |
  +-------> TASK-087 (ACP Discovery)           +---> TASK-085 (Picker UI)
  |              |                             |
  |              +-------- (optional) ---------+
```

Phases 2 and 3 can proceed in parallel after Phase 1 completes. Phase 4 requires Phase 2 (for the trigger callbacks) and benefits from Phase 3 (for agent commands in the pool) but can ship with local commands only.

## Phasing Strategy

**Ship Phases 1-2 as MVP.** The grid works with hardcoded defaults and dispatches through the existing text input path. No ACP parsing needed. No picker needed. Users get the core value (one-tap command execution) immediately.

**Phase 3-4 follow as fast-follow.** Dynamic command discovery and the picker unlock customization but are not required for the grid to be useful. If nobody uses the hardcoded defaults, the picker is wasted work.

**Parallelism opportunity:** Phase 3 (ACP parser, ~1d) depends only on TASK-022 and modifies different files than Phase 2 (grid widget). They can be developed and reviewed in parallel by different implementors if needed.

**Estimated effort:** Phase 1 (1-2d) + Phase 2 (2-3d) + Phase 3 (1d, parallel with Phase 2) + Phase 4 (2-3d) = 6-9 days total (5-7 days critical path).

## Test File Locations

All tests follow the standard Flutter convention: `test/` directory with `_test.dart` suffix, mirroring `lib/` structure.

| Task | Test File |
|------|-----------|
| TASK-022 | `test/models/macro_test.dart`, `test/services/macro_registry_test.dart` |
| TASK-086 | `test/widgets/tui_macro_cluster_test.dart` |
| TASK-087 | `test/services/relay/acp_update_parser_test.dart` (extend existing), `test/services/relay/relay_chat_service_test.dart` (extend existing) |
| TASK-085 | `test/widgets/macro_picker_sheet_test.dart` |

## Dependencies

| Dependency | Status | Impact |
|------------|--------|--------|
| `CommandRegistry` (TASK-076) | Complete | Provides local command dispatch and `/help` |
| `RelayChatService` (Epic 22) | Complete | Provides `sendPrompt()` for relay-mode execution |
| `LiveKitService.sendTextMessage()` | Complete | Unified dispatch (slash commands, relay, voice) |
| `VoiceControlBar` layout (Epic 11) | Complete | Grid must coexist (72dp offset) |
| TUI Brutalist design system (TASK-016) | Complete | AppColors, AppTypography, TuiButton, TuiCard, TuiModal |
| `SharedPreferences` | In use | Persistence for bindings, handedness, expand state |
| `available_commands_update` from OpenClaw | Shipping | Populates agent command pool (Phase 3) |

No blocking dependencies. All prerequisites are complete.

## Technical Risks (from CTO Review)

1. **ConversationScreen Stack migration** -- wrapping the existing Column in a Stack is the only layout change that touches the critical path. Risk: subtle layout regressions (SafeArea, Expanded behavior inside Stack). Mitigate: widget test verifying existing layout unchanged after Stack wrapper. (Owned by TASK-086.)

2. **SharedPreferences async in initState** -- `MacroRegistry` needs to load bindings asynchronously on construction (SharedPreferences.getInstance() is async). The standard pattern is to initialize with defaults synchronously, then overwrite from persistence when the Future completes. This is the same pattern used by `SessionStorage`. (Owned by TASK-022.)

3. **Command pool freshness** -- Agent commands arrive asynchronously and may never arrive (old agent, no relay). Default macros must work without ACP discovery. The architecture handles this: default bindings are plain text that the agent processes regardless of command advertisement. (Owned by TASK-087, mitigated by TASK-022 defaults.)

4. **Grid z-order on small screens** -- The floating overlay covers part of ChatTranscript. On small phones (~640dp height), the 160dp grid covers ~25% of the chat area. The collapse toggle is the mitigation, but first-launch expanded state may feel cramped. Consider: auto-collapse after first session if the user never tapped a macro. (Owned by TASK-086.)

5. **LiveKitService <-> MacroRegistry wiring** -- MacroRegistry is owned by ConversationScreen, but LiveKitService needs to forward ACP commands to it. The wiring happens in ConversationScreen: either via a setter on LiveKitService or a callback registered after both services are created. (Owned jointly by TASK-086 and TASK-087.)

## References
- [Architecture: Macro Shortcuts](../../docs/architecture/macro-shortcuts.md) -- component diagram, data flows, persistence schema, edge cases
- [PRD: Macro Shortcuts](../../vision/macro-shortcuts/PRD.macro-shortcuts.md) -- functional requirements, user stories, phasing
- [Vision: Macro Shortcuts](../../vision/macro-shortcuts/VISION.md) -- product positioning, success metrics
- Inherits TUI Brutalist design system from [Epic 11 (07-ui-ux)](../07-ui-ux/EPIC.md)
- Depends on: TASK-016 (TUI Design System), TASK-017 (Chat-First Main View), TASK-076 (CommandRegistry)
