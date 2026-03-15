# Task 076: Slash Command Interceptor + Registry

**Epic:** 25 — Session Resumption
**Status:** [x]
**Depends on:** none
**Blocks:** 077 (sessions command)

## Goal

Add client-side slash command infrastructure so that `/`-prefixed text input is intercepted before reaching the agent or relay, and routed to a local command registry. This is the foundation for `/sessions` (TASK-077, Epic 25) and all future macro shortcuts (Epic 15 / TASK-022). Ship with `/help` as the proof-of-life command.

## Context

Currently, `sendTextMessage()` in `LiveKitService` (line 1480) sends all text input either to the relay (text mode) or the voice agent (voice mode). There is no mechanism to intercept commands locally.

The architecture follows the existing patterns:
- **State:** `ConversationState` (immutable, `copyWith()`) — add `commandResults` field parallel to `systemEvents`
- **Chat stream:** `_ChatItem` union in `ChatTranscript` — add `.commandResult()` variant parallel to `.systemEvent()`
- **Widget:** New `CommandResultCard` — follows `SystemEventCard` pattern (compact inline card)

```
  sendTextMessage(text)
    │
    ├── starts with "/" ?
    │    YES → parse command + args
    │         → CommandRegistry.dispatch(command, args)
    │         → handler returns Future<CommandResult?>
    │         → add result to state.commandResults
    │         → return (skip agent/relay send)
    │
    └── NO → existing flow (optimistic add + relay/agent)
```

**Design decisions (from review):**
- **Async handlers:** `typedef CommandHandler = Future<CommandResult?> Function(String args)` — `/sessions` will need relay round-trips
- **Swallow input:** `/`-prefixed input is NOT added to the transcript as a user message. The result card header shows the command name for context.
- **Case-insensitive, trim after `/`:** `/  HELP` → command "help". Bare `/` is ignored (treated as regular text).
- **Error boundary:** `dispatch()` wraps handler calls in try/catch, returns error `CommandResult` on exception.

**Shared infrastructure:** This serves both Epic 25 (session resumption → `/sessions`) and Epic 15 (macro shortcuts → `/pulse`, `/bug`, `/snapshot`, etc.). The `CommandRegistry` is the single point where all macro buttons and slash commands converge.

## Implementation

### 1. Command result model (`apps/mobile/lib/models/command_result.dart`)

New file. Simple data class:

```dart
class CommandResult {
  final String command;     // e.g. "help", "sessions"
  final String text;        // display text (may contain newlines)
  final DateTime timestamp;
  // Future: optional widget builder for rich results like SessionCard
}
```

### 2. Command registry (`apps/mobile/lib/services/command_registry.dart`)

New file. Standalone class, owned by `LiveKitService`:

```dart
typedef CommandHandler = Future<CommandResult?> Function(String args);

class CommandRegistry {
  final Map<String, CommandHandler> _commands = {};

  void register(String name, CommandHandler handler);
  Future<CommandResult?> dispatch(String input);
  List<String> get registeredCommands;
}
```

Key behaviors:
- `dispatch(input)` parses input: strips leading `/`, splits on first space → `(command, args)`, lowercases command, trims both.
- If `command` is empty (bare `/`), returns `null` (caller treats as regular text).
- If command not found, returns `CommandResult(command: input, text: "Unknown command: /$command. Type /help for available commands.")`.
- Wraps handler call in try/catch — on exception, returns `CommandResult(command: command, text: "Command failed: $error")`.

Register `/help` in the constructor or via an `init()` method:
```dart
register('help', (_) async {
  final cmds = registeredCommands.map((c) => '/$c').join(', ');
  return CommandResult(command: 'help', text: 'Available commands: $cmds', timestamp: DateTime.now());
});
```

### 3. Intercept in `sendTextMessage()` (`apps/mobile/lib/services/livekit_service.dart`)

Modify `sendTextMessage()` — add guard at the top, after `trim()` and `isEmpty` check, before the optimistic transcript add:

```dart
// Slash command intercept — route to registry, skip agent/relay
if (trimmed.startsWith('/') && trimmed.length > 1) {
  final result = await _commandRegistry.dispatch(trimmed);
  if (result != null) {
    _addCommandResult(result);
  }
  return;
}
```

Add `_commandRegistry` field (instantiate in constructor or `_connect()`).
Add `_addCommandResult(CommandResult result)` helper that appends to `state.commandResults` via `_updateState()`.

### 4. Wire into `ConversationState` (`apps/mobile/lib/models/conversation_state.dart`)

Add `commandResults` field:
- `final List<CommandResult> commandResults;`
- Default: `const []`
- Add to `copyWith()`
- Import `command_result.dart`

### 5. Render in `ChatTranscript` (`apps/mobile/lib/widgets/chat_transcript.dart`)

Add `_ChatItem.commandResult(CommandResult)` variant to the union class (follow `.systemEvent()` pattern).

In `_buildItems()`, merge `state.commandResults` into the timestamped item list (same pattern as systemEvents at ~line 143-167).

In the `itemBuilder`, handle the new variant — render as `CommandResultCard`.

### 6. `CommandResultCard` widget (`apps/mobile/lib/widgets/command_result_card.dart`)

New file. Follow `SystemEventCard` pattern — compact `TuiCard` with:
- Header: `CMD` type label + command name (e.g. `/ help`) in `AppColors.green` or similar distinct color
- Body: result text
- Timestamp

### 7. Tests

Unit tests co-located with source (per project convention):

**`apps/mobile/test/services/command_registry_test.dart`** (or `.spec.dart` — match project convention):
- `/help` returns list of registered commands
- Unknown command returns error result with command name
- Case-insensitive dispatch (`/HELP` → "help")
- Whitespace trimming (`/  help` → "help")
- Bare `/` returns null (not treated as command)
- Args parsing: `/sessions foo` → command "sessions", args "foo"
- Handler exception → error CommandResult (not thrown)
- Handler returning null → no result added

**Widget test** for `CommandResultCard`:
- Renders command name in header
- Renders body text
- Renders timestamp

## Not in scope

- `/sessions` command implementation (TASK-077 — needs spike TASK-075 first)
- Session card widget (needs `/sessions` data shape)
- Relay-side `session/list` forwarding (server change, not client)
- Macro grid UI (Epic 15 / TASK-022)
- Text field autocomplete/suggestions for `/` prefix
- Persistent command history
- Rich widget results (future: `CommandResult` gains optional `widgetBuilder` for cards like `SessionCard`)

## Relates to

- `tasks/25-session-resumption/EPIC.md` — parent epic
- `tasks/15-macro-shortcuts/022-macro-shortcut-system.md` — macro grid that will use this registry
- `apps/mobile/lib/services/livekit_service.dart` — intercept point
- `apps/mobile/lib/models/system_event.dart` — pattern for `CommandResult` model
- `apps/mobile/lib/widgets/system_event_card.dart` — pattern for `CommandResultCard` widget

## Acceptance criteria

- [ ] Typing `/help` in the text field shows a command result card in the chat stream listing available commands
- [ ] Typing `/help` does NOT send a message to the agent or relay
- [ ] Typing `/help` does NOT appear as a user message in the transcript
- [ ] Typing `/unknown` shows an "unknown command" result card
- [ ] Regular text (no `/` prefix) continues to work as before (optimistic add + relay/agent)
- [ ] Bare `/` is treated as regular text (sent to agent/relay)
- [ ] `/HELP` and `/  help` both resolve to the help command
- [ ] Handler exceptions produce an error result card (not a crash)
- [ ] Unit tests pass for CommandRegistry (8+ test cases)
- [ ] Widget test passes for CommandResultCard

<!--
Status key:
  [ ]  pending
  [~]  in progress
  [x]  done
  [!]  failed / blocked
-->
