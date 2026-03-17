# TASK-087: ACP available_commands_update Parser

Extend `AcpUpdateParser` to parse `available_commands_update` session updates into a typed result, and wire the parsed commands through `RelayChatService` to `MacroRegistry`'s command pool.

**Architecture:** [docs/architecture/macro-shortcuts.md](../../docs/architecture/macro-shortcuts.md)
**PRD:** [vision/macro-shortcuts/PRD.macro-shortcuts.md](../../vision/macro-shortcuts/PRD.macro-shortcuts.md) -- FR 3.3 (Command Pool, agent commands)

## Dependencies

- **Requires:** TASK-022 (MacroRegistry with `updateAgentCommands()` method)
- **Does not require:** TASK-086 (Grid Widget) -- can be implemented in parallel with TASK-086
- **Blocks:** TASK-085 (Picker UI benefits from agent commands in the pool, but picker works without them)

## Scope

**In scope:** New `AcpAvailableCommandsUpdate` sealed class, `AcpCommand` model, parser extension for `available_commands_update` kind, `RelayChatService` callback, `LiveKitService` wiring to forward commands to `MacroRegistry`.

**Out of scope:** No UI changes, no MacroRegistry changes beyond calling existing `updateAgentCommands()`, no changes to the relay or agent. The `available_commands_update` event is already being sent by OpenClaw and forwarded by the relay -- this task only parses and wires it on the client side.

## Implementation Checklist

### AcpCommand Model

File: `apps/mobile/lib/services/relay/acp_update_parser.dart` (modify -- add to existing file)

- [ ] `AcpCommand` class with fields: `name` (String), `description` (String), `hint` (String?)
- [ ] `AcpCommand` equality (`==`) and `hashCode` override
- [ ] `AcpCommand.toString()` for debugging

### AcpAvailableCommandsUpdate Subclass

File: `apps/mobile/lib/services/relay/acp_update_parser.dart` (modify -- add new sealed subclass)

- [ ] `final class AcpAvailableCommandsUpdate extends AcpUpdate` with `List<AcpCommand> commands` field
- [ ] Constructor: `const AcpAvailableCommandsUpdate(this.commands)`
- [ ] Equality: two instances are equal if their command lists are equal
- [ ] `hashCode`: based on commands list
- [ ] `toString()` for debugging: `'AcpAvailableCommandsUpdate(${commands.length} commands)'`

**Implementation note:** This follows the exact same pattern as existing sealed subclasses (`AcpTextDelta`, `AcpUsageUpdate`, `AcpToolCallUpdate`, etc.) in the same file. Use the existing code as a template.

### Parser Extension

File: `apps/mobile/lib/services/relay/acp_update_parser.dart` (modify -- add case in `parse()`)

- [ ] Add handling for `kind == 'available_commands_update'` in `AcpUpdateParser.parse()`
- [ ] Extract `availableCommands` from the `update` map
- [ ] If `availableCommands` is not a `List`, fall back to `AcpNonContentUpdate('available_commands_update')`
- [ ] Parse each element in the list: require `name` (String) and `description` (String), `hint` (String?) is optional
- [ ] Skip individual malformed entries (missing name or description) -- do not fail the entire parse
- [ ] If the list is empty, return `AcpAvailableCommandsUpdate([])` (valid: agent has no commands)
- [ ] On success, return `AcpAvailableCommandsUpdate(parsedCommands)`

**Implementation note:** The new `if (kind == 'available_commands_update')` block should be inserted BEFORE the final `return AcpNonContentUpdate(kind)` fallback at the bottom of `parse()`. This replaces the current behavior where `available_commands_update` falls through to `AcpNonContentUpdate`.

### Wire Format Reference

The expected payload from the relay (confirmed in field tests):

```json
{
  "sessionId": "sess_abc123",
  "update": {
    "sessionUpdate": "available_commands_update",
    "availableCommands": [
      { "name": "/memory", "description": "Manage long-term memory", "hint": "[search|add|list] [text]" },
      { "name": "/plan", "description": "View or update the current plan" }
    ]
  }
}
```

Note: The `availableCommands` array is nested inside the `update` object (same structure as all other ACP session updates). The parser already extracts `update` before dispatching on `kind`.

### RelayChatService Extension

File: `apps/mobile/lib/services/relay/relay_chat_service.dart` (modify)

- [ ] Add optional callback field: `void Function(List<AcpCommand>)? onAvailableCommandsUpdate`
- [ ] Accept in constructor: `RelayChatService({required this.publish, this.onAvailableCommandsUpdate})`
- [ ] In `_handleSessionUpdate()`, add a new branch after the existing `AcpToolCallUpdate` check:
  ```dart
  } else if (update is AcpAvailableCommandsUpdate) {
    onAvailableCommandsUpdate?.call(update.commands);
  }
  ```

**Implementation note:** The `AcpAvailableCommandsUpdate` is NOT forwarded to `_activeStream` -- it is a session-level event, not part of a prompt response stream. It fires the callback directly, which is why it goes in `_handleSessionUpdate()` alongside the other event routing, but uses a separate callback rather than the stream.

### LiveKitService Wiring

File: `apps/mobile/lib/services/livekit_service.dart` (modify)

- [ ] In `_initRelayChatService()` (around line 1684), pass the new callback when constructing `RelayChatService`:
  ```dart
  _relayChatService = RelayChatService(
    publish: (data) async { ... },
    onAvailableCommandsUpdate: _handleAvailableCommandsUpdate,
  );
  ```
- [ ] Add `_handleAvailableCommandsUpdate(List<AcpCommand> commands)` method
- [ ] Convert `List<AcpCommand>` to `List<PoolCommand>` (all with `source: CommandSource.agent`)
- [ ] Call `_macroRegistry?.updateAgentCommands(poolCommands)` (null-safe because MacroRegistry may not exist yet if called before ConversationScreen is built)

**Implementation note:** This requires `LiveKitService` to hold a reference to `MacroRegistry`. Two approaches: (a) `LiveKitService` accepts an optional `MacroRegistry?` setter called by `ConversationScreen` after creating both services, or (b) `ConversationScreen` registers a callback on `LiveKitService` that forwards commands to `MacroRegistry`. Approach (a) is simpler. The architecture doc says `MacroRegistry` is owned by `ConversationScreen`, so the wiring happens there.

## Tests

### Parser Tests

File: `apps/mobile/test/services/relay/acp_update_parser_test.dart` (modify -- add new test group)

- [ ] Parse valid `available_commands_update` with 2 commands (one with hint, one without) -> returns `AcpAvailableCommandsUpdate` with 2 `AcpCommand` entries
- [ ] Parse with all fields present (name, description, hint) -> AcpCommand has correct hint value
- [ ] Parse with hint absent -> AcpCommand.hint is null
- [ ] Missing `availableCommands` key -> falls back to `AcpNonContentUpdate('available_commands_update')`
- [ ] `availableCommands` is not an array (e.g., string) -> falls back to `AcpNonContentUpdate`
- [ ] Malformed entry (missing `name`) is skipped, valid entries still parsed
- [ ] Malformed entry (missing `description`) is skipped, valid entries still parsed
- [ ] Empty `availableCommands` array -> returns `AcpAvailableCommandsUpdate([])` (not AcpNonContentUpdate)
- [ ] `AcpCommand` equality and hashCode

**Implementation note:** Add the new test group to the existing `acp_update_parser_test.dart` file (currently ~190 lines). Follow the existing test structure: `group('available_commands_update', () { ... })`.

### Integration Tests

File: `apps/mobile/test/services/relay/relay_chat_service_test.dart` (modify -- add new test group)

- [ ] `RelayChatService`: mock data channel message with `available_commands_update` -> `onAvailableCommandsUpdate` callback fires with correct `AcpCommand` list
- [ ] Callback not set (null): `available_commands_update` message is silently ignored (no crash)
- [ ] Malformed `available_commands_update`: callback does not fire, no crash

### CommandPool Integration Test

File: `apps/mobile/test/services/macro_registry_test.dart` (modify -- add to existing TASK-022 tests)

- [ ] `MacroRegistry.updateAgentCommands()` rebuilds CommandPool with agent commands
- [ ] After `updateAgentCommands()`, `commandPool.all` includes agent commands
- [ ] CommandPool dedup: agent command with same name as local `/help` replaces local entry

## Definition of Done

- [ ] `available_commands_update` payloads are parsed into typed `AcpAvailableCommandsUpdate` (no longer returns `AcpNonContentUpdate`)
- [ ] Malformed payloads degrade gracefully to `AcpNonContentUpdate` (no crashes, preserves existing behavior)
- [ ] Individual malformed entries in the array are skipped (partial parse succeeds)
- [ ] Agent commands flow from relay -> `RelayChatService` callback -> `MacroRegistry.updateAgentCommands()` -> `CommandPool`
- [ ] Picker UI (TASK-085) can read agent commands from `CommandPool.all` once it ships
- [ ] All parser tests pass via `flutter test test/services/relay/acp_update_parser_test.dart`
- [ ] All relay integration tests pass via `flutter test test/services/relay/relay_chat_service_test.dart`
- [ ] Existing ACP parser tests still pass (no regressions)

## References

- [Epic 15: Macro Shortcuts](./EPIC.md)
- [Architecture: Macro Shortcuts](../../docs/architecture/macro-shortcuts.md) -- AcpUpdateParser Extension, RelayChatService Extension, Data Flow: ACP Command Discovery sections
- [Architecture: Data Channel Protocol](../../docs/architecture/data-channel-protocol.md) -- ACP update parsing flow
- Source reference: `apps/mobile/lib/services/relay/acp_update_parser.dart` (existing parser, sealed class hierarchy)
- Source reference: `apps/mobile/lib/services/relay/relay_chat_service.dart` lines 239-257 (`_handleSessionUpdate` method)
- Source reference: `apps/mobile/lib/services/livekit_service.dart` lines 1684-1690 (`_initRelayChatService` method)
- Test reference: `apps/mobile/test/services/relay/acp_update_parser_test.dart` (existing parser tests to extend)
