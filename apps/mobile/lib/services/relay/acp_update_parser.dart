import 'package:flutter/foundation.dart';

import '../../models/content_block.dart';

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
/// if (update is AcpContentDelta) {
///   final block = update.content;
///   if (block is TextContent) print(block.text);
/// }
/// ```

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/// Parsed result of a `session/update` notification.
sealed class AcpUpdate {
  const AcpUpdate();
}

/// A content chunk from an `agent_message_chunk` (or `user_message_chunk`)
/// update, carrying a typed [ContentBlock].
///
/// Replaces the old `AcpTextDelta(String text)` — text content is now
/// represented as `AcpContentDelta(TextContent(text: "..."), "agent_message_chunk")`.
/// All other content types (image, audio, resource, diff, terminal, etc.) are
/// carried as their respective [ContentBlock] subclass.
///
/// [updateKind] is the raw `sessionUpdate` discriminator string (e.g.
/// `"agent_message_chunk"`), preserved so callers can distinguish message
/// chunks from replay chunks without a parallel type hierarchy.
final class AcpContentDelta extends AcpUpdate {
  final ContentBlock content;
  final String updateKind;

  const AcpContentDelta(this.content, this.updateKind);

  @override
  bool operator ==(Object other) =>
      other is AcpContentDelta &&
      other.updateKind == updateKind &&
      _contentEqual(content, other.content);

  // Value equality for ContentBlock subtypes (sealed, so we cover all cases).
  static bool _contentEqual(ContentBlock a, ContentBlock b) {
    if (a.runtimeType != b.runtimeType) return false;
    if (a is TextContent && b is TextContent) {
      return a.text == b.text && a.mimeType == b.mimeType;
    }
    if (a is ImageContent && b is ImageContent) {
      return a.data == b.data && a.mimeType == b.mimeType && a.uri == b.uri;
    }
    if (a is AudioContent && b is AudioContent) {
      return a.data == b.data && a.mimeType == b.mimeType;
    }
    if (a is ResourceContent && b is ResourceContent) {
      return a.uri == b.uri &&
          a.mimeType == b.mimeType &&
          a.text == b.text &&
          a.blob == b.blob;
    }
    if (a is ResourceLinkContent && b is ResourceLinkContent) {
      return a.uri == b.uri &&
          a.name == b.name &&
          a.mimeType == b.mimeType &&
          a.title == b.title &&
          a.description == b.description &&
          a.size == b.size;
    }
    if (a is DiffContent && b is DiffContent) {
      return a.path == b.path &&
          a.oldText == b.oldText &&
          a.newText == b.newText;
    }
    if (a is TerminalContent && b is TerminalContent) {
      return a.terminalId == b.terminalId;
    }
    if (a is RawContent && b is RawContent) {
      // Map deep equality via toString as a simple approximation.
      return a.json.toString() == b.json.toString();
    }
    return false;
  }

  @override
  int get hashCode => Object.hash(updateKind, content.runtimeType);

  @override
  String toString() => 'AcpContentDelta(${content.runtimeType}, $updateKind)';
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
/// { "sessionUpdate": "tool_call", "id": "tc_123", "kind": "read", "title": "Reading main.dart", "input": "{...}" }
/// ```
/// On tool completion or error:
/// ```json
/// {
///   "sessionUpdate": "tool_call_update",
///   "id": "tc_123",
///   "status": "completed",
///   "content": [
///     { "type": "content", "content": { "type": "text", "text": "result" } },
///     { "type": "diff", "path": "/foo", "newText": "bar" }
///   ]
/// }
/// ```
///
/// [kind] classifies the operation type: `read`, `edit`, `delete`, `move`,
/// `search`, `execute`, `think`, `fetch`, or `other`. Only present on
/// `tool_call` events (not `tool_call_update`).
///
/// [status] is null when the tool call has just started (kind == `tool_call`),
/// and non-null (`"completed"`, `"failed"`, `"error"`, etc.) for
/// `tool_call_update` events.
///
/// [content] carries the parsed tool result content blocks (for
/// `tool_call_update` events that include a `content` array). Empty list when
/// absent.
final class AcpToolCallUpdate extends AcpUpdate {
  final String id;
  final String? kind;    // operation kind: read, edit, search, execute, think, fetch, delete, move, other
  final String? title;   // human-readable description (e.g., "Reading main.dart")
  final String? status;  // null=started, "completed", "failed", "error"
  final String? input;   // JSON string of tool arguments (optional)

  /// Parsed content blocks from `tool_call_update.content[]`.
  /// Empty when the update carries no content (e.g. plain status-only updates).
  final List<ContentBlock> content;

  const AcpToolCallUpdate({
    required this.id,
    this.kind,
    this.title,
    this.status,
    this.input,
    this.content = const [],
  });

  @override
  bool operator ==(Object other) =>
      other is AcpToolCallUpdate &&
      other.id == id &&
      other.kind == kind &&
      other.title == title &&
      other.status == status &&
      other.input == input &&
      _contentListEqual(content, other.content);

  static bool _contentListEqual(
    List<ContentBlock> a,
    List<ContentBlock> b,
  ) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!AcpContentDelta._contentEqual(a[i], b[i])) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(id, kind, title, status, input, content.length);

  @override
  String toString() =>
      'AcpToolCallUpdate(id: $id, kind: $kind, title: $title, status: $status, '
      'content: ${content.length} blocks)';
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

/// A thinking/reasoning chunk from an `agent_thought_chunk` session update.
///
/// ACP spec: https://agentclientprotocol.com/protocol/schema#param-agent-thought-chunk
///
/// Wire format is identical to `agent_message_chunk` — a `ContentBlock` with
/// `{ type: "text", text: "..." }` — but uses the `"agent_thought_chunk"`
/// discriminator to distinguish model reasoning from visible output.
///
/// ```json
/// {
///   "sessionUpdate": "agent_thought_chunk",
///   "content": { "type": "text", "text": "Let me reason about..." },
///   "_meta": {}
/// }
/// ```
///
/// **Status (2026-03):** OpenClaw's ACP bridge does not yet emit this update
/// kind (documented as "Unsupported" in their compatibility matrix). This
/// parser is implemented per the ACP spec for forward compatibility.
/// See: https://docs.openclaw.ai/cli/acp#compatibility-matrix
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
/// Covers: `available_commands_update`, `plan`, and unknown future kinds.
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
/// - [AcpContentDelta] for `agent_message_chunk` — all content types parsed
///   into typed [ContentBlock] instances (text, image, audio, resource, etc.)
/// - [AcpThinkingDelta] for `agent_thought_chunk` with `{ type: "text", text }`
/// - [AcpUsageUpdate] for `usage_update` with `used` and `size` fields
/// - [AcpToolCallUpdate] for `tool_call` and `tool_call_update` kinds
/// - [AcpNonContentUpdate] for all other recognized or unknown kinds
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

    if (kind == 'user_message_chunk') {
      return _parseUserMessageChunk(update);
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
        kind: update['kind'] as String?,
        title: update['title'] as String?,
        status: null,
        input: update['input'] is String ? update['input'] as String : null,
      );
    }

    if (kind == 'tool_call_update') {
      final id = update['id'];
      if (id is! String) return null;
      final contentBlocks = _parseToolCallContent(update['content']);
      return AcpToolCallUpdate(
        id: id,
        title: null,
        status: update['status'] as String?,
        content: contentBlocks,
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

  /// Parse `user_message_chunk` — emitted during `session/load` replay.
  ///
  /// Uses the `content` ContentBlock structure (same as `agent_message_chunk`),
  /// NOT the `prompt` array that `user_message` uses.
  static AcpUpdate? _parseUserMessageChunk(Map<String, dynamic> update) {
    final content = update['content'];
    if (content is! Map<String, dynamic>) return null;
    if (content['type'] != 'text') return null;
    final text = content['text'];
    if (text is! String) return null;
    return AcpUserMessage(text);
  }

  static AcpUpdate? _parseThoughtChunk(Map<String, dynamic> update) {
    final content = update['content'];
    if (content is! Map<String, dynamic>) return null;
    if (content['type'] != 'text') return null;
    final text = content['text'];
    if (text is! String) return null;
    return AcpThinkingDelta(text);
  }

  /// Parse the `content[]` array from a `tool_call_update` event.
  ///
  /// Each item is a ToolCallContent object:
  /// - `{ type: "content", content: ContentBlock }` — wrapped block, unwrapped
  ///   via [ContentBlock.fromJson] which handles the `"content"` wrapper type.
  /// - `{ type: "diff", path, oldText?, newText }` — [DiffContent]
  /// - `{ type: "terminal", terminalId }` — [TerminalContent]
  /// - anything else — [RawContent] via [ContentBlock.fromJson] fallback
  ///
  /// Returns an empty list when [raw] is null, not a list, or empty.
  static List<ContentBlock> _parseToolCallContent(dynamic raw) {
    if (raw is! List) return const [];
    final blocks = <ContentBlock>[];
    for (final item in raw) {
      if (item is! Map<String, dynamic>) continue;
      try {
        blocks.add(ContentBlock.fromJson(item));
      } catch (_) {
        // Malformed item — skip silently to avoid dropping the entire update.
        debugPrint('[AcpUpdateParser] Skipped malformed tool_call_update '
            'content item: $item');
      }
    }
    return blocks;
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

    // Validate text blocks eagerly — a text content with a non-string `text`
    // field is malformed and we return null rather than a RawContent.
    if (content['type'] == 'text') {
      final text = content['text'];
      if (text is! String) return null;
    }

    final block = ContentBlock.fromJson(content);
    return AcpContentDelta(block, kind);
  }
}
