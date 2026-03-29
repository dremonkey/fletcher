/// ACP ContentBlock sealed class hierarchy.
///
/// Maps 1:1 to the content block types defined in the Agent Client Protocol:
/// - Standard blocks: text, image, audio, resource, resource_link
/// - Tool call content types: content (wrapper), diff, terminal
///
/// Use [ContentBlock.fromJson] to deserialise from ACP JSON payloads.
/// The sealed class enables exhaustive `switch` dispatch at call sites.
///
/// See: docs/specs/acp-protocol/content.md
///      docs/specs/acp-protocol/tool-calls.md
sealed class ContentBlock {
  const ContentBlock();

  /// Deserialise a content block from an ACP JSON payload.
  ///
  /// Dispatches on the `type` field:
  /// - `"text"` → [TextContent]
  /// - `"image"` → [ImageContent]
  /// - `"audio"` → [AudioContent]
  /// - `"resource"` → [ResourceContent]
  /// - `"resource_link"` → [ResourceLinkContent]
  /// - `"diff"` → [DiffContent]
  /// - `"terminal"` → [TerminalContent]
  /// - `"content"` (tool call wrapper) → unwraps and parses inner block
  /// - unknown → [RawContent] (forward-compatible fallback)
  factory ContentBlock.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String? ?? '';
    switch (type) {
      case 'text':
        return TextContent(
          text: json['text'] as String,
          mimeType: json['mimeType'] as String?,
        );
      case 'image':
        return ImageContent(
          data: json['data'] as String,
          mimeType: json['mimeType'] as String,
          uri: json['uri'] as String?,
        );
      case 'audio':
        return AudioContent(
          data: json['data'] as String,
          mimeType: json['mimeType'] as String,
        );
      case 'resource':
        final resource = json['resource'] as Map<String, dynamic>;
        return ResourceContent(
          uri: resource['uri'] as String,
          mimeType: resource['mimeType'] as String?,
          text: resource['text'] as String?,
          blob: resource['blob'] as String?,
        );
      case 'resource_link':
        return ResourceLinkContent(
          uri: json['uri'] as String,
          name: json['name'] as String,
          mimeType: json['mimeType'] as String?,
          title: json['title'] as String?,
          description: json['description'] as String?,
          size: json['size'] as int?,
        );
      case 'diff':
        return DiffContent(
          path: json['path'] as String,
          oldText: json['oldText'] as String?,
          newText: json['newText'] as String,
        );
      case 'terminal':
        return TerminalContent(
          terminalId: json['terminalId'] as String,
        );
      case 'content':
        // Tool call content wrapper — unwrap and parse the inner block.
        final inner = json['content'] as Map<String, dynamic>;
        return ContentBlock.fromJson(inner);
      default:
        return RawContent(json: json);
    }
  }
}

/// Plain-text or markdown content from the agent.
///
/// The optional [mimeType] hints at interpretation:
/// - `text/plain` — plain text
/// - `text/markdown` — markdown rendering
/// - `text/x-diff` — unified diff
/// - `null` — treat as plain text
class TextContent extends ContentBlock {
  final String text;

  /// MIME type hint for rendering (text/plain, text/markdown, etc.).
  final String? mimeType;

  const TextContent({required this.text, this.mimeType});
}

/// Base64-encoded image data.
class ImageContent extends ContentBlock {
  /// Base64-encoded image bytes.
  final String data;

  /// MIME type of the image (e.g. `image/png`, `image/jpeg`).
  final String mimeType;

  /// Optional URI reference for the image source.
  final String? uri;

  const ImageContent({
    required this.data,
    required this.mimeType,
    this.uri,
  });
}

/// Base64-encoded audio data.
class AudioContent extends ContentBlock {
  /// Base64-encoded audio bytes.
  final String data;

  /// MIME type of the audio (e.g. `audio/wav`, `audio/mp3`).
  final String mimeType;

  const AudioContent({required this.data, required this.mimeType});
}

/// Embedded resource — either text or binary blob.
///
/// Exactly one of [text] or [blob] is expected to be non-null, but both are
/// optional to accommodate forward compatibility.
class ResourceContent extends ContentBlock {
  /// The URI identifying the resource.
  final String uri;

  /// Optional MIME type of the resource content.
  final String? mimeType;

  /// Text content (for text resources).
  final String? text;

  /// Base64-encoded binary data (for blob resources).
  final String? blob;

  const ResourceContent({
    required this.uri,
    this.mimeType,
    this.text,
    this.blob,
  });
}

/// Reference to a resource the agent can access.
///
/// Unlike [ResourceContent], this does not embed the resource content —
/// it provides a URI and metadata the client can use to fetch or display it.
class ResourceLinkContent extends ContentBlock {
  /// The URI of the resource.
  final String uri;

  /// Human-readable name for the resource.
  final String name;

  /// Optional MIME type of the resource.
  final String? mimeType;

  /// Optional display title (may differ from [name]).
  final String? title;

  /// Optional description of the resource contents.
  final String? description;

  /// Optional size of the resource in bytes.
  final int? size;

  const ResourceLinkContent({
    required this.uri,
    required this.name,
    this.mimeType,
    this.title,
    this.description,
    this.size,
  });
}

/// A file diff produced by a tool call.
///
/// [oldText] is null for newly created files.
class DiffContent extends ContentBlock {
  /// Absolute path of the file being modified.
  final String path;

  /// Original file content; null for new files.
  final String? oldText;

  /// New file content after the modification.
  final String newText;

  const DiffContent({
    required this.path,
    this.oldText,
    required this.newText,
  });
}

/// A reference to a live terminal session produced by a tool call.
class TerminalContent extends ContentBlock {
  /// Unique identifier of the terminal session.
  final String terminalId;

  const TerminalContent({required this.terminalId});
}

/// Fallback for unrecognised content block types.
///
/// Preserves the raw JSON so callers can inspect or forward it without loss.
/// This enables forward compatibility with future ACP content block types.
class RawContent extends ContentBlock {
  /// The raw JSON payload of the unrecognised content block.
  final Map<String, dynamic> json;

  const RawContent({required this.json});
}
