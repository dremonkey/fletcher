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

/// A recognized but non-renderable update.
///
/// Covers: `available_commands_update`, `plan`, `tool_call`,
/// `tool_call_update`, unknown future kinds, and `agent_message_chunk`
/// carrying non-text content (image, resource, etc.).
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

    return AcpNonContentUpdate(kind);
  }

  static AcpUpdate? _parseAgentMessageChunk(
    String kind,
    Map<String, dynamic> update,
  ) {
    final content = update['content'];
    if (content is! Map<String, dynamic>) return null;

    if (content['type'] != 'text') return AcpNonContentUpdate(kind);

    final text = content['text'];
    if (text is! String) return null;

    return AcpTextDelta(text);
  }
}
