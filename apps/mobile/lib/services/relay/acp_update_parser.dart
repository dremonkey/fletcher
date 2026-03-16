import 'package:flutter/foundation.dart';

/// Parser for ACP `session/update` notification params.
///
/// ACP spec: https://agentclientprotocol.com/protocol/prompt-turn.md
///
/// Wire format (from the relay, unchanged from OpenClaw):
/// ```json
/// {
///   "sessionId": "sess_abc123",
///   "update": {
///     "sessionUpdate": "<kind>",
///     ...kind-specific fields
///   }
/// }
/// ```
///
/// The `update` field is a **singular object** with a `sessionUpdate`
/// discriminator — NOT an `updates[]` array.
///
/// Usage:
/// ```dart
/// final update = AcpUpdateParser.parse(params);
/// if (update is AcpTextDelta) {
///   print(update.text);
/// }
/// ```

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/// Parsed result of a `session/update` notification.
sealed class AcpUpdate {
  const AcpUpdate();
}

/// A text chunk from an `agent_message_chunk` update.
/// This is the only update kind that contributes to the rendered response.
final class AcpTextDelta extends AcpUpdate {
  final String text;

  const AcpTextDelta(this.text);

  @override
  bool operator ==(Object other) => other is AcpTextDelta && other.text == text;

  @override
  int get hashCode => text.hashCode;

  @override
  String toString() => 'AcpTextDelta(${text.length} chars)';
}

/// A `usage_update` event carrying token usage for the current session.
///
/// Fields:
/// - [used]: tokens consumed so far in this session.
/// - [size]: total context window size (in tokens).
///
/// [percentage] is a convenience getter: `used / size`, clamped to 0.0
/// when [size] is zero to avoid division errors.
final class AcpUsageUpdate extends AcpUpdate {
  final int used;
  final int size;

  const AcpUsageUpdate({required this.used, required this.size});

  double get percentage => size > 0 ? used / size : 0.0;

  @override
  bool operator ==(Object other) =>
      other is AcpUsageUpdate && other.used == used && other.size == size;

  @override
  int get hashCode => Object.hash(used, size);

  @override
  String toString() => 'AcpUsageUpdate(used: $used, size: $size)';
}

/// A tool call started or updated.
///
/// Emitted when OpenClaw receives verbose mode (`verbose: true` in `session/new`).
///
/// On tool invocation:
/// ```json
/// { "sessionUpdate": "tool_call", "id": "tc_123", "title": "memory_search", "input": "{...}" }
/// ```
/// On tool completion or error:
/// ```json
/// { "sessionUpdate": "tool_call_update", "id": "tc_123", "status": "completed" }
/// ```
///
/// [status] is null when the tool call has just started (kind == `tool_call`),
/// and non-null (`"completed"`, `"error"`, etc.) for `tool_call_update` events.
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

  @override
  bool operator ==(Object other) =>
      other is AcpToolCallUpdate &&
      other.id == id &&
      other.title == title &&
      other.status == status &&
      other.input == input;

  @override
  int get hashCode => Object.hash(id, title, status, input);

  @override
  String toString() => 'AcpToolCallUpdate(id: $id, title: $title, status: $status)';
}

/// A user message replayed during `session/load`.
///
/// Contains the full prompt text from the original user turn. The text may
/// include an OpenClaw sender JSON preamble that callers should strip.
final class AcpUserMessage extends AcpUpdate {
  final String text;

  const AcpUserMessage(this.text);

  @override
  bool operator ==(Object other) =>
      other is AcpUserMessage && other.text == text;

  @override
  int get hashCode => text.hashCode;

  @override
  String toString() => 'AcpUserMessage(${text.length} chars)';
}

/// A thinking/reasoning chunk from an `agent_thought_chunk` update.
/// Same wire format as `agent_message_chunk` but carries model reasoning.
final class AcpThinkingDelta extends AcpUpdate {
  final String text;

  const AcpThinkingDelta(this.text);

  @override
  bool operator ==(Object other) =>
      other is AcpThinkingDelta && other.text == text;

  @override
  int get hashCode => text.hashCode;

  @override
  String toString() => 'AcpThinkingDelta(${text.length} chars)';
}

/// A recognized but non-renderable update.
///
/// Covers: `available_commands_update`, `plan`, unknown future kinds, and
/// `agent_message_chunk` carrying non-text content (image, resource, etc.).
///
/// [kind] is the raw `sessionUpdate` string — callers can inspect it
/// for future feature handling or logging.
final class AcpNonContentUpdate extends AcpUpdate {
  final String kind;

  const AcpNonContentUpdate(this.kind);

  @override
  bool operator ==(Object other) =>
      other is AcpNonContentUpdate && other.kind == kind;

  @override
  int get hashCode => kind.hashCode;

  @override
  String toString() => 'AcpNonContentUpdate($kind)';
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/// Parses the `params` map from a `session/update` JSON-RPC notification.
///
/// Returns:
/// - [AcpTextDelta] for `agent_message_chunk` with `{ type: "text", text }`
/// - [AcpUsageUpdate] for `usage_update` with `used` and `size` fields
/// - [AcpToolCallUpdate] for `tool_call` and `tool_call_update` kinds
/// - [AcpNonContentUpdate] for all other recognized or unknown kinds,
///   and for `agent_message_chunk` with non-text content
/// - `null` for malformed input (missing required fields, wrong types)
abstract final class AcpUpdateParser {
  const AcpUpdateParser._();

  static AcpUpdate? parse(Map<String, dynamic> params) {
    final update = params['update'];
    if (update is! Map<String, dynamic>) return null;

    final kind = update['sessionUpdate'];
    if (kind is! String) return null;

    if (kind == 'agent_message_chunk') {
      return _parseAgentMessageChunk(kind, update);
    }

    if (kind == 'agent_thought_chunk') {
      return _parseThoughtChunk(update);
    }

    if (kind == 'user_message') {
      return _parseUserMessage(update);
    }

    if (kind == 'usage_update') {
      final used = update['used'];
      final size = update['size'];
      if (used is! int || size is! int) return null;
      return AcpUsageUpdate(used: used, size: size);
    }

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

    return AcpNonContentUpdate(kind);
  }

  static AcpUpdate? _parseUserMessage(Map<String, dynamic> update) {
    final prompt = update['prompt'];
    if (prompt is! List) return null;

    final textParts = <String>[];
    for (final part in prompt) {
      if (part is Map<String, dynamic> &&
          part['type'] == 'text' &&
          part['text'] is String) {
        textParts.add(part['text'] as String);
      }
    }
    if (textParts.isEmpty) return null;
    return AcpUserMessage(textParts.join(''));
  }

  static AcpUpdate? _parseThoughtChunk(Map<String, dynamic> update) {
    final content = update['content'];
    if (content is! Map<String, dynamic>) return null;
    if (content['type'] != 'text') return null;
    final text = content['text'];
    if (text is! String) return null;
    return AcpThinkingDelta(text);
  }

  static AcpUpdate? _parseAgentMessageChunk(
    String kind,
    Map<String, dynamic> update,
  ) {
    final content = update['content'];
    if (content is! Map<String, dynamic>) {
      debugPrint('[AcpUpdateParser] agent_message_chunk has no content map');
      return null;
    }

    final contentType = content['type'];

    if (contentType != 'text') {
      return AcpNonContentUpdate(kind);
    }

    final text = content['text'];
    if (text is! String) return null;

    return AcpTextDelta(text);
  }
}
