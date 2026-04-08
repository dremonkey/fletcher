# Macro Shortcuts

Programmable 3x3 button grid that provides one-tap command execution from the mobile client. The third input modality after voice and text, optimized for repetitive developer commands that don't warrant dictation or typing.

## Component Architecture

```
+-----------------------------------------------------------------------+
|  ConversationScreen (Stack)                                           |
|                                                                       |
|  +----------------------------+  +------------------------------+     |
|  | Column (existing layout)   |  | TuiMacroCluster (Positioned) |     |
|  |                            |  |   bottom-right overlay        |     |
|  | +------------------------+ |  |                              |     |
|  | | DiagnosticsBar         | |  |  [HLP] [MEM] [BUG]          |     |
|  | +------------------------+ |  |  [TST] [SUM] [CTX]          |     |
|  | | ChatTranscript         | |  |  [GIT] [UND] [PLN]          |     |
|  | | (Expanded)             | |  |                              |     |
|  | |                        | |  |  [COLLAPSE] or [EDT]         |     |
|  | +------------------------+ |  +------------------------------+     |
|  | | VoiceControlBar        | |                                       |
|  | +------------------------+ |                                       |
|  +----------------------------+                                       |
+-----------------------------------------------------------------------+

+-------------------------------+
| MacroRegistry (ChangeNotifier)|
|                               |
|  slots: List<Macro?> (9)      |
|  commandPool: CommandPool     |
|  handedness: Handedness       |
|  isExpanded: bool             |
|                               |
|  bind(slot, macro)            |
|  clear(slot)                  |
|  updateAgentCommands(cmds)    |
|  toggleExpanded()             |
|  toggleHandedness()           |
+-------------------------------+
        |                   ^
        | reads              | notifyListeners
        v                   |
+-------------------+   +-------------------+
| TuiMacroCluster   |   | MacroPickerSheet  |
| (3x3 grid widget) |   | (bottom sheet)    |
+-------------------+   +-------------------+
        |                        |
        | onTap(slot)            | onSelect(slot, command)
        v                        v
+-------------------------------+
| LiveKitService                |
|   .sendTextMessage(text)      |
|     -> CommandRegistry (/)    |
|     -> relay (text mode)      |
|     -> voice agent (voice)    |
+-------------------------------+
```

## Service Architecture

### MacroRegistry

A `ChangeNotifier` service that owns macro slot state, the command pool, and persistence. Created once and injected into `ConversationScreen` (similar to how `LiveKitService` is created as a field on `_ConversationScreenState`).

```dart
class MacroRegistry extends ChangeNotifier {
  List<Macro?> _slots;           // 9 slots, null = empty
  final CommandPool _commandPool;
  Handedness _handedness;
  bool _isExpanded;
}
```

**Ownership:** `MacroRegistry` is owned by `_ConversationScreenState`, the same widget that owns `LiveKitService`. It reads `CommandRegistry.registeredCommands` at initialization for local commands (the list of command names is passed into the constructor to avoid coupling to the private `CommandRegistry` instance inside `LiveKitService`).

**ACP command wiring:** `LiveKitService` needs to forward ACP `available_commands_update` events to `MacroRegistry.updateAgentCommands()`. Since `ConversationScreen` owns both services, the wiring happens there: after creating both, `ConversationScreen` either sets a `MacroRegistry` reference on `LiveKitService` (setter) or registers a forwarding callback. The macro system does not import or depend on `RelayChatService` directly -- `LiveKitService` is the intermediary.

**Why not inside LiveKitService?** `LiveKitService` is already 1600+ lines and manages connection lifecycle, audio, transcription, and relay. Macro state is a UI concern (grid position, slot bindings, expand/collapse) that does not belong in the connection service. The integration point is thin: `MacroRegistry` calls `LiveKitService.sendTextMessage()` on tap, and `LiveKitService` forwards ACP command updates to `MacroRegistry.updateAgentCommands()`.

### CommandPool

A value object (not a service) that merges two command sources into a single list. Owned by `MacroRegistry`.

```dart
class CommandPool {
  List<PoolCommand> _localCommands;    // from CommandRegistry
  List<PoolCommand> _agentCommands;    // from ACP available_commands_update

  List<PoolCommand> get all;           // merged, deduped (agent wins)
}

class PoolCommand {
  final String name;                   // e.g. "/memory" or "check the bug log"
  final String description;            // human-readable
  final String? hint;                  // argument hint, e.g. "[text]"
  final CommandSource source;          // local | agent
}
```

**Deduplication:** When a command name appears in both local and agent sources, the agent entry wins (it has richer metadata from ACP). The pool is rebuilt whenever either source updates.

**Local commands at launch:** `CommandRegistry.registeredCommands` returns `['help']` today. As more local commands are registered (e.g., `/handedness`), they appear automatically. Local commands get a `PoolCommand` wrapper with a hardcoded description.

**Agent commands from ACP:** Arrive asynchronously via `available_commands_update` session updates. May arrive multiple times per session (command set can change). The pool replaces all agent commands on each update (full replacement, not incremental).

### Macro Model

```dart
class Macro {
  final int slotIndex;         // 0-8
  final String shortLabel;     // 3-4 chars, e.g. "HLP", "MEM"
  final String command;        // the text to send, e.g. "/help" or "run tests"
  final String? args;          // optional hardcoded arguments
  final CommandSource source;  // local | agent (informational only)
}

enum CommandSource { local, agent }
enum Handedness { right, left }
```

The `source` field is informational — it does not affect dispatch. Both local and agent commands are dispatched through `sendTextMessage()` identically. The field exists so the picker UI can show a source badge.

## Data Flow: Tap to Dispatch

```
User taps [TST] (slot 3)
  |
  v
TuiMacroCluster.onTap(3)
  |
  v
MacroRegistry.slots[3]
  -> Macro(command: "run the test suite", args: null)
  |
  v
LiveKitService.sendTextMessage("run the test suite")
  |
  +-- starts with "/" ? --> CommandRegistry.dispatch()
  |                           -> local handler
  |                           -> CommandResult in transcript
  |
  +-- always -------------> RelayChatService.sendPrompt()
                              -> relay -> ACP -> agent
                              -> response streams back via acp topic
```

**Key insight:** The macro system does not need its own dispatch logic. `LiveKitService.sendTextMessage()` already handles all routing (slash commands, relay). Macros are simply a tap-driven text input, identical to typing in the text field and pressing enter. All text — in both voice and text mode — routes through the relay via `session/prompt`.

**Busy state:** Before dispatch, check `RelayChatService.isBusy`. If busy, the tap is dropped with a brief visual flash (no queuing).

## Data Flow: ACP Command Discovery

```
Agent session starts
  |
  v
OpenClaw sends available_commands_update
  |
  v
Relay forwards via data channel (session/update)
  |
  v
RelayChatService.handleMessage()
  -> AcpUpdateParser.parse()
  -> returns AcpAvailableCommandsUpdate (new type)
  |
  v
RelayChatService._handleSessionUpdate()
  -> callback: onAvailableCommandsUpdate(List<AcpCommand>)
  |
  v
LiveKitService (owns the callback)
  -> MacroRegistry.updateAgentCommands(commands)
  |
  v
MacroRegistry
  -> CommandPool rebuilds with new agent commands
  -> notifyListeners() (picker UI refreshes if open)
```

### AcpUpdateParser Extension

The parser currently returns `AcpNonContentUpdate('available_commands_update')` for these events. The extension adds a new sealed subclass:

```dart
final class AcpAvailableCommandsUpdate extends AcpUpdate {
  final List<AcpCommand> commands;
  const AcpAvailableCommandsUpdate(this.commands);
}

class AcpCommand {
  final String name;
  final String description;
  final String? hint;
}
```

The parser extracts the `availableCommands` array from the update payload. The wire format (observed in field tests) is:

```json
{
  "sessionUpdate": "available_commands_update",
  "availableCommands": [
    { "name": "/memory", "description": "Manage long-term memory", "hint": "[search|add|list] [text]" },
    { "name": "/plan", "description": "View or update the current plan" }
  ]
}
```

If the payload is malformed or the array is missing, the parser falls back to `AcpNonContentUpdate` (graceful degradation).

### RelayChatService Extension

`_handleSessionUpdate()` currently ignores `AcpNonContentUpdate`. Add handling:

```dart
} else if (update is AcpAvailableCommandsUpdate) {
  onAvailableCommandsUpdate?.call(update.commands);
}
```

The callback is an optional function field set by `LiveKitService` when creating the `RelayChatService`. This avoids adding macro-specific imports to the relay service.

## Persistence

### Schema

Macro bindings are stored in `SharedPreferences` as a JSON string under a single key.

```
Key: "fletcher_macro_bindings"
Value: JSON string

[
  {"slotIndex": 0, "shortLabel": "HLP", "command": "/help", "args": null, "source": "local"},
  {"slotIndex": 1, "shortLabel": "MEM", "command": "/memory", "args": null, "source": "agent"},
  null,
  ...
]
```

A 9-element JSON array where `null` represents an empty slot.

Additional preferences:

```
Key: "fletcher_macro_handedness"
Value: String ("right" | "left")

Key: "fletcher_macro_expanded"
Value: bool
```

### Load/Save Strategy

- **Load:** On `MacroRegistry` construction (in `initState`). If the key is missing or the JSON is unparsable, apply default bindings silently. This matches the existing pattern in `SessionStorage` where missing/corrupt values get safe defaults.
- **Save:** After every `bind()` or `clear()` call. Writes are async (`SharedPreferences.getInstance()` + `setString`) but fire-and-forget — binding changes take effect in memory immediately, persistence is best-effort.
- **Migration:** If the JSON array has fewer than 9 elements (schema change), pad with `null`. If it has more, truncate to 9.

### Default Bindings

Applied on first launch (no stored bindings):

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

Defaults are hardcoded in the `MacroRegistry` constructor. They are applied once and never re-applied — user customizations always take precedence.

## Grid UI (TuiMacroCluster)

### Layout Integration

The `ConversationScreen` currently uses a `Column` layout. To support a floating overlay, the build method wraps the `Column` in a `Stack`:

```dart
Stack(
  children: [
    Column(children: [/* existing layout */]),
    if (macroRegistry.isExpanded)
      Positioned(
        bottom: 72,  // above VoiceControlBar (56dp + 16dp padding)
        right: macroRegistry.handedness == Handedness.right ? 8 : null,
        left: macroRegistry.handedness == Handedness.left ? 8 : null,
        child: TuiMacroCluster(
          registry: macroRegistry,
          onTap: _handleMacroTap,
          onLongPress: _handleMacroEdit,
        ),
      ),
  ],
)
```

**Positioning:** The grid floats above the `VoiceControlBar` (which occupies ~72dp at the bottom: 56dp bar + 16dp padding). The 8dp inset from the edge keeps it within thumb reach. The `Positioned` bottom value must clear the `VoiceControlBar` so there is no tap overlap with the mic button.

### Button Sizing

Each button is 44x44dp (minimum touch target per WCAG 2.5.5 and Apple HIG), with 2dp gap between buttons. Total grid: (44 * 3) + (2 * 2) = 136dp wide, 136dp tall. The collapse toggle adds ~24dp below, total overlay height: ~160dp.

### Visual Design

- Square borders, no border radius (TUI Brutalist)
- `AppColors.amber` border, `AppColors.background` fill
- `AppTypography.label` for short labels (12sp monospace bold, uppercase)
- Tap feedback: brief invert (amber fill, dark text) for 100ms, then revert
- Empty slots: dimmed border (`AppColors.textSecondary`), "+" label
- Collapse toggle: small bar below grid, `[>>>]` when collapsed, `[<<<]` when expanded

### Collapse Behavior

- Toggle button always visible (even when grid is collapsed)
- Collapsed state: only the toggle button renders (~24dp)
- Expanded state: full 3x3 grid + toggle
- State persisted in `SharedPreferences` via `MacroRegistry`
- Default: expanded on first launch

### Accessibility

- Each button has a `Semantics` label with the full command name (not just the abbreviation)
- `ExcludeSemantics` on the short label text (redundant with the Semantics widget)
- Screen reader announces: "Macro button: run the test suite" not "TST"

## Command Picker (MacroPickerSheet)

A bottom sheet (following the pattern of `TranscriptDrawer` and `ArtifactViewer`) triggered by:
- Long-press on any macro slot
- Tap on the `[EDT]` button below the grid

### UI Structure

```
+-----------------------------------------------+
| --- BIND MACRO: SLOT 3 ---                    |
|                                                |
| /help                              [LOCAL]     |
|   List available commands                      |
|                                                |
| /memory                            [AGENT]     |
|   Manage long-term memory  [search|add] [text] |
|                                                |
| /plan                              [AGENT]     |
|   View or update the current plan              |
|                                                |
| check the bug log for open issues  [AGENT]     |
|   Bug triage workflow                          |
|                                                |
| ...                                            |
|                                                |
| [CLEAR SLOT]                                   |
+-----------------------------------------------+
```

- `TuiModal` container with `TuiHeader` title
- Scrollable `ListView` of `CommandPool.all`
- Each row: command name (amber), description (secondary text), hint (if present), source badge
- Tapping a row opens a label prompt (text field pre-filled with auto-derived abbreviation)
- Auto-derivation: first 3 consonants of the last word, uppercased (e.g., "memory" -> "MRY", "help" -> "HLP")
- "CLEAR SLOT" button at the bottom

### Label Prompt

After selecting a command, a simple dialog:

```
+---------------------------+
| --- LABEL ---             |
|                           |
| [MEM_____________]        |
|                           |
| [CANCEL]    [BIND]        |
+---------------------------+
```

- Pre-filled with auto-derived abbreviation
- Max 4 characters
- Monospace, uppercase enforced
- Cancel returns to picker, Bind writes to `MacroRegistry`

## Integration with Existing Services

### LiveKitService

Minimal changes:
1. Accept a `MacroRegistry` reference (or expose a callback for ACP command updates)
2. In `_handleSessionUpdate()`, forward `AcpAvailableCommandsUpdate` to `MacroRegistry`
3. No changes to `sendTextMessage()` — macros call it as-is

### CommandRegistry

No changes needed to `CommandRegistry` itself. `registeredCommands` getter already exists (returns `List<String>` of registered command names). `dispatch()` already handles the full lifecycle. As new local commands are registered (e.g., `/handedness`), they automatically appear in the command pool.

**Access pattern:** `CommandRegistry` is a private field (`_commandRegistry`) on `LiveKitService`. To provide registered command names to `MacroRegistry` without exposing the private field, `LiveKitService` should expose a `List<String> get registeredCommands` getter that delegates to `_commandRegistry.registeredCommands`. `ConversationScreen` reads this at `MacroRegistry` construction time.

### RelayChatService

One addition: an optional `onAvailableCommandsUpdate` callback. Set by `LiveKitService` at construction time. Invoked when `AcpUpdateParser` returns `AcpAvailableCommandsUpdate`.

### ConversationScreen

Layout change: wrap existing `Column` in a `Stack`. Add `MacroRegistry` as a field. Wire up listeners (same pattern as `LiveKitService` listener).

## Edge Cases and Failure Modes

### Persistence Corruption

**Scenario:** `SharedPreferences` returns a JSON string that fails to parse (app update changed schema, storage corruption).

**Handling:** `MacroRegistry` catches `FormatException` / `TypeError` during deserialization and falls back to default bindings. A `debugPrint` logs the error. No user-visible error — the grid silently resets to defaults.

### ACP Commands Never Arrive

**Scenario:** Agent session starts but `available_commands_update` is never sent (old agent version, network issue, relay not connected).

**Handling:** The command pool starts with local commands only. Default macro bindings still work because they send plain text — the agent doesn't need to have advertised the command for it to process the text. The picker shows fewer commands but remains functional. No error state.

### Agent Disconnect During Macro Tap

**Scenario:** User taps a macro while the agent is absent (hold mode, between dispatches).

**Handling:** Same as typing text. All text routes through the relay via `session/prompt` in both modes. In voice mode, `AgentPresenceService.onTextMessageSent()` triggers dispatch if the voice agent is absent. The relay always has its own ACP connection. The macro grid does not need to know about agent presence.

### Grid Overlaps Mic Button

**Risk:** On very small screens (360dp width, ~640dp height), the grid + VoiceControlBar might compete for space.

**Mitigation:** The grid is a `Positioned` overlay, not a layout child. It overlays the bottom portion of `ChatTranscript`. The `bottom` offset (72dp) ensures it clears the mic button. The grid width (136dp) is less than half the minimum screen width (360dp), so it leaves room for chat content. The collapse toggle lets the user dismiss the grid entirely.

### Rapid Taps (Debounce)

**Scenario:** User rapidly taps the same macro multiple times.

**Handling:** `RelayChatService.isBusy` check prevents duplicate in-flight prompts. A 300ms debounce on the button tap handler prevents accidental double-taps. This debounce is purely UI-side — it does not affect the dispatch path.

### Command Pool Update During Picker

**Scenario:** User has the picker open and ACP sends a command update.

**Handling:** The picker listens to `MacroRegistry` (which is a `ChangeNotifier`). When the pool updates, the picker's `ListView` rebuilds with the new command list. No special handling needed — standard Flutter reactive pattern.

### Handedness Toggle

A `/handedness` command can be registered in `CommandRegistry` to toggle the grid position. This adds a second local command and demonstrates the macro system eating its own dog food — the handedness command appears in the picker and can be bound to a macro slot.

## Security Considerations

**Macro commands have the same trust model as typed text.** A macro tap sends text through `sendTextMessage()`, which is the same path as keyboard input. There is no privilege escalation — macros cannot do anything a user couldn't type manually.

**Agent-injected commands** from `available_commands_update` are discovered, not executed. The agent can populate the command pool, but it cannot bind commands to slots or trigger execution. The user must explicitly bind a command via the picker. The agent cannot rearrange the user's grid.

**Command text sanitization:** Not required. The text flows through `sendTextMessage()` which already handles all routing safely. Slash commands go to `CommandRegistry.dispatch()` (known handlers only). Plain text goes to the agent (which processes it as natural language). There is no shell execution, no eval, no injection vector.

## Testing Strategy

### Unit Tests

| Component | Tests | Approach |
|-----------|-------|----------|
| `Macro` model | Serialization/deserialization round-trip, equality | Pure Dart |
| `CommandPool` | Merge, dedup (agent wins), empty sources | Pure Dart |
| `MacroRegistry` | bind/clear/toggle, default application, persistence round-trip | Mock `SharedPreferences` |
| `AcpAvailableCommandsUpdate` | Parse valid payload, malformed payload, missing fields | Pure Dart |
| `AcpUpdateParser` extension | Parse `available_commands_update` kind | Existing test pattern |
| Label auto-derivation | "memory"->"MRY", "help"->"HLP", edge cases | Pure Dart |

### Widget Tests

| Widget | Tests |
|--------|-------|
| `TuiMacroCluster` | 9 buttons render, tap calls callback, empty slot shows "+", handedness positioning |
| `MacroPickerSheet` | Command list renders, tap selects, label prompt shows, clear slot works |
| Collapse toggle | Grid hidden when collapsed, toggle button always visible |
| `ConversationScreen` integration | Grid appears in Stack, does not overlap mic button area |

### Integration Tests

| Scenario | Verification |
|----------|-------------|
| Tap macro -> transcript | Tap HLP -> "/help" appears as user message, help response appears |
| ACP update -> pool | Send mock `available_commands_update` -> picker shows new commands |
| Persistence round-trip | Bind macro, restart registry, verify binding restored |
| Busy state | Start prompt, tap macro, verify tap dropped (no second prompt) |

## File Structure

New source files (all in `apps/mobile/lib/`):

```
models/
  macro.dart                    # Macro, CommandSource, Handedness, PoolCommand
services/
  macro_registry.dart           # MacroRegistry (ChangeNotifier), CommandPool
widgets/
  tui_macro_cluster.dart        # 3x3 grid widget
  macro_picker_sheet.dart       # Bottom sheet picker
```

Modified source files (all in `apps/mobile/lib/`):

```
services/relay/acp_update_parser.dart      # Add AcpAvailableCommandsUpdate, AcpCommand
services/relay/relay_chat_service.dart     # Add onAvailableCommandsUpdate callback
services/livekit_service.dart              # Wire ACP callback -> MacroRegistry
screens/conversation_screen.dart           # Stack wrapper, MacroRegistry creation
```

Test files (all in `apps/mobile/test/`, following Flutter standard `_test.dart` convention):

```
models/
  macro_test.dart                              # Macro model serialization, equality
services/
  macro_registry_test.dart                     # MacroRegistry CRUD, persistence, CommandPool
services/relay/
  acp_update_parser_test.dart                  # Extend existing tests for available_commands_update
  relay_chat_service_test.dart                 # Extend existing tests for callback wiring
widgets/
  tui_macro_cluster_test.dart                  # Grid render, tap, collapse, handedness
  macro_picker_sheet_test.dart                 # Command list, label prompt, bind/clear
```

## Related Documents

- [Mobile Client](mobile-client.md) -- service architecture, widget overview, ConversationScreen layout
- [Data Channel Protocol](data-channel-protocol.md) -- ACP update parsing, session/update flow
- [System Overview](system-overview.md) -- two-layer architecture, relay role
