# Task 038: Verbose ACP Tool Feedback

**Epic:** 07 — UI/UX (TUI Brutalist)
**Status:** [x]
**Depends on:** none
**Blocks:** none

## Goal

Enable verbose ACP mode so the relay receives tool call, plan, and reasoning events from OpenClaw, and render them as inline collapsed indicators in the mobile chat transcript. This eliminates the "frozen" feeling during long tool executions by showing the user what the agent is doing.

## Context

OpenClaw's ACP gateway filters out internal `tool_call`, `plan`, and `reasoning` chunks by default. The Fletcher UI hears silence and sees no activity until the final text response arrives.

The relay can request verbose mode during `session/new`. Once enabled, OpenClaw emits additional `session/update` notifications:
```json
{ "sessionUpdate": "tool_call", "id": "tc_123", "title": "memory_search", "input": "{...}" }
{ "sessionUpdate": "tool_call_update", "id": "tc_123", "status": "completed", "content": {...} }
```

The relay already passes all `session/update` notifications through transparently. The mobile parser currently classifies these as `AcpNonContentUpdate`. We need to:
1. Request verbose mode in the relay
2. Parse tool_call events in mobile
3. Render them inline in the chat transcript

### Data flow

```
OpenClaw ACP agent
  │ verbose: true in session/new
  │
  ├─ session/update { tool_call }        ←── new, previously filtered
  ├─ session/update { tool_call_update } ←── new
  ├─ session/update { agent_message_chunk } ←── existing
  │
  ▼
Relay (transparent passthrough)
  │
  ▼
Mobile
  ├─ AcpUpdateParser → AcpToolCallUpdate
  ├─ ConversationState.pendingToolCalls
  └─ ChatTranscript → ToolCallCard (inline, collapsed)
```

## Implementation

### 1. Relay: Request verbose mode (`apps/relay/src/bridge/relay-bridge.ts`)

Update `session/new` params in `start()` and `doReinit()` to include verbose flag:

```typescript
const result = await this.acpClient.sessionNew({
  cwd: process.cwd(),
  mcpServers: [],
  _meta: {
    room_name: this.options.roomName,
    verbose: true,  // <-- NEW: request tool_call, plan, reasoning events
  },
});
```

### 2. Mobile: Parse tool_call events (`apps/mobile/lib/services/relay/acp_update_parser.dart`)

Add new sealed class variants:

```dart
/// A tool call started or completed.
final class AcpToolCallUpdate extends AcpUpdate {
  final String id;
  final String? title;   // tool name (e.g., "memory_search")
  final String? status;  // null=started, "completed", "error"
  final String? input;   // JSON string of tool arguments (optional)

  const AcpToolCallUpdate({
    required this.id,
    this.title,
    this.status,
    this.input,
  });
}
```

Update `parse()`:

```dart
if (kind == 'tool_call') {
  final id = update['id'];
  if (id is! String) return null;
  return AcpToolCallUpdate(
    id: id,
    title: update['title'] as String?,
    status: null,
    input: update['input'] is String ? update['input'] as String : null,
  );
}

if (kind == 'tool_call_update') {
  final id = update['id'];
  if (id is! String) return null;
  return AcpToolCallUpdate(
    id: id,
    title: null,
    status: update['status'] as String?,
  );
}
```

### 3. Mobile: Add tool call state (`apps/mobile/lib/models/conversation_state.dart`)

Add a `ToolCallInfo` model:

```dart
class ToolCallInfo {
  final String id;
  final String name;
  final DateTime startedAt;
  final String? status;  // null=in_progress, "completed", "error"
  final Duration? duration;

  const ToolCallInfo({
    required this.id,
    required this.name,
    required this.startedAt,
    this.status,
    this.duration,
  });

  ToolCallInfo copyWith({String? status, Duration? duration}) => ToolCallInfo(
    id: id, name: name, startedAt: startedAt,
    status: status ?? this.status,
    duration: duration ?? this.duration,
  );
}
```

Add to `ConversationState`:
```dart
final List<ToolCallInfo> activeToolCalls;
```

### 4. Mobile: Wire updates to state (`apps/mobile/lib/services/livekit_service.dart`)

In the relay update handler:

```dart
if (update is AcpToolCallUpdate) {
  if (update.status == null && update.title != null) {
    // Tool call started
    final toolCall = ToolCallInfo(
      id: update.id,
      name: update.title!,
      startedAt: DateTime.now(),
    );
    _updateState(state.copyWith(
      activeToolCalls: [...state.activeToolCalls, toolCall],
    ));
  } else if (update.status != null) {
    // Tool call completed/errored — update existing entry
    final updated = state.activeToolCalls.map((tc) {
      if (tc.id != update.id) return tc;
      return tc.copyWith(
        status: update.status,
        duration: DateTime.now().difference(tc.startedAt),
      );
    }).toList();
    _updateState(state.copyWith(activeToolCalls: updated));
  }
}
```

### 5. Mobile: Render tool call indicators (`apps/mobile/lib/widgets/tool_call_card.dart`)

Create a compact inline card for the chat transcript:

```dart
class ToolCallCard extends StatelessWidget {
  final ToolCallInfo toolCall;

  @override
  Widget build(BuildContext context) {
    final statusIcon = toolCall.status == 'completed' ? '✓' :
                       toolCall.status == 'error' ? '✕' : '▸';
    final durationText = toolCall.duration != null
      ? ' (${toolCall.duration!.inMilliseconds / 1000}s)'
      : '';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2, horizontal: AppSpacing.base),
      child: Text(
        '$statusIcon ${toolCall.name}$durationText',
        style: AppTypography.statusMetric.copyWith(
          color: AppColors.textSecondary,
        ),
      ),
    );
  }
}
```

### 6. Mobile: Integrate into ChatTranscript (`apps/mobile/lib/widgets/chat_transcript.dart`)

Insert tool call cards between agent message chunks in the transcript. Tool calls appear inline, above the text response they produce.

In the transcript build method, check `state.activeToolCalls` and insert `ToolCallCard` widgets at the appropriate position (after the last user message, before the agent response).

### 7. Unit tests

Parser tests (`acp_update_parser_test.dart`):
- `tool_call` with valid `id` and `title` → `AcpToolCallUpdate` (status: null)
- `tool_call` with missing `id` → null
- `tool_call_update` with `id` and `status` → `AcpToolCallUpdate`
- `tool_call_update` with missing `id` → null

State tests:
- Adding a tool call to `activeToolCalls`
- Updating tool call status from null to "completed"
- Duration calculation on completion

Relay test:
- Verify `session/new` params include `verbose: true` in `_meta`

## Not in scope

- Expanded tool call detail view (arguments, results) — collapsed indicator only
- Grouped tool call blocks (`▸ 3 tool calls (4.1s)`) — individual cards only
- `plan` and `reasoning` update types — tool_call only for MVP
- Widget render tests — unit tests for parser + state per review decision

## Relates to

- Task 058: Token Usage Display (also extends AcpUpdateParser)
- Task 024: Diagnostics Panel — Live Pipeline Values (existing diagnostics surface)
- `apps/relay/src/bridge/relay-bridge.ts` — relay session/new params

## Acceptance criteria

- [ ] Relay sends `verbose: true` in `session/new` `_meta`
- [ ] `AcpToolCallUpdate` class added to sealed hierarchy
- [ ] `AcpUpdateParser.parse()` handles `tool_call` and `tool_call_update` kinds
- [ ] `ToolCallInfo` model with id, name, startedAt, status, duration
- [ ] `ConversationState.activeToolCalls` list maintained
- [ ] `ToolCallCard` widget renders inline in chat transcript
- [ ] Unit tests for parser (4 cases), state management (3 cases), relay params (1 case)
