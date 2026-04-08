import 'package:flutter/material.dart';

import 'package:fletcher/models/content_block.dart';

/// A factory that produces a widget for a given [ContentBlock].
typedef RendererFactory = Widget Function(ContentBlock block);

/// Maps MIME-type patterns to [RendererFactory] callbacks.
///
/// Pattern-matching priority (most specific wins):
/// 1. Exact string match:      `text/markdown` beats `text/*`
/// 2. Wildcard subtype:        `text/*` matches `text/html`, `text/plain`, …
/// 3. Global fallback:         `*/*` matches everything
///
/// Structural dispatch (not MIME-based) is applied first for:
/// - [DiffContent]    → DiffRenderer
/// - [TerminalContent] → TerminalCard placeholder
/// - [RawContent]     → RawJsonRenderer
///
/// Use [RendererRegistry.instance] for the pre-configured singleton, or
/// construct a fresh instance via [RendererRegistry.forTesting] in tests.
class RendererRegistry {
  /// The application-wide singleton, pre-loaded with the default renderers.
  static final RendererRegistry instance = RendererRegistry._withDefaults();

  /// Creates an empty registry. Useful in tests.
  @visibleForTesting
  RendererRegistry() : _entries = [];

  // Private constructor for the singleton — populates default renderers.
  RendererRegistry._withDefaults() : _entries = [] {
    _registerDefaults();
  }

  final List<_RendererEntry> _entries;

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /// Registers a [factory] for [pattern].
  ///
  /// [pattern] may be:
  /// - An exact MIME type:  `text/markdown`
  /// - A wildcard subtype:  `text/*`
  /// - The global wildcard: `*/*`
  ///
  /// Patterns should be registered from most-specific to least-specific, or
  /// [build] will return the first pattern that matches rather than the most
  /// specific one.
  void register(String pattern, RendererFactory factory) {
    _entries.add(_RendererEntry(pattern: pattern, factory: factory));
  }

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  /// Returns the appropriate renderer widget for [block].
  ///
  /// Applies structural dispatch first (DiffContent, TerminalContent,
  /// RawContent), then MIME-pattern matching for all other block types.
  Widget build(ContentBlock block) {
    // ── Structural dispatch (sealed-class type, not MIME) ───────────────────
    if (block is DiffContent) {
      return _DiffRenderer(block: block);
    }
    if (block is TerminalContent) {
      return _TerminalCardPlaceholder(block: block);
    }
    if (block is RawContent) {
      return _RawJsonRenderer(block: block);
    }

    // ── MIME-pattern dispatch ────────────────────────────────────────────────
    final mime = _mimeFor(block);
    for (final entry in _entries) {
      if (_matches(entry.pattern, mime)) {
        return entry.factory(block);
      }
    }

    // Ultimate fallback — should never be reached if */* is registered.
    return _RawJsonRenderer(block: RawContent(json: const {}));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /// Returns the effective MIME type string for [block].
  ///
  /// - [TextContent]: uses its own [TextContent.mimeType] if set, else
  ///   `text/plain`.
  /// - [ImageContent]: uses [ImageContent.mimeType].
  /// - [AudioContent]: uses [AudioContent.mimeType].
  /// - [ResourceContent]: uses [ResourceContent.mimeType] if set, else
  ///   `application/octet-stream`.
  /// - [ResourceLinkContent]: uses the synthetic `resource_link` type so that
  ///   a matching registration can handle it separately from raw resources.
  /// - Structural types (Diff/Terminal/Raw) are handled before this is called.
  String _mimeFor(ContentBlock block) {
    return switch (block) {
      TextContent(:final mimeType) => mimeType ?? 'text/plain',
      ImageContent(:final mimeType) => mimeType,
      AudioContent(:final mimeType) => mimeType,
      ResourceContent(:final mimeType) => mimeType ?? 'application/octet-stream',
      ResourceLinkContent() => 'resource_link',
      // These are handled before _mimeFor is called:
      DiffContent() => 'text/x-diff',
      TerminalContent() => 'application/x-terminal',
      RawContent() => 'application/json',
    };
  }

  /// Returns true if [mimeType] matches [pattern].
  ///
  /// Rules:
  /// - `*/*` matches everything.
  /// - `type/*` matches `type/<anything>`.
  /// - Exact match: `pattern == mimeType`.
  bool _matches(String pattern, String mimeType) {
    if (pattern == '*/*') return true;
    if (pattern == mimeType) return true;
    if (pattern.endsWith('/*')) {
      final prefix = pattern.substring(0, pattern.length - 2); // e.g. "text"
      return mimeType.startsWith('$prefix/');
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Default renderer registrations
  // ---------------------------------------------------------------------------

  void _registerDefaults() {
    // Most-specific entries first so priority ordering works correctly.
    //
    // Note: actual DiffContent is intercepted by structural dispatch before
    // MIME matching, so the text/x-diff entry below handles TextContent blocks
    // that carry mimeType: 'text/x-diff' (e.g., diffs serialised as text).
    register('text/x-diff', (b) => _TextRenderer(block: b));
    register('text/markdown', (b) => _MarkdownRenderer(block: b));
    register('text/*', (b) => _TextRenderer(block: b));
    register('image/*', (b) => _ImagePlaceholder(block: b));
    register('audio/*', (b) => _AudioPlaceholder(block: b));
    register('resource_link', (b) => _ResourceLinkCardPlaceholder(block: b));
    register('*/*', (b) => _RawJsonRenderer(block: b));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal entry type
// ─────────────────────────────────────────────────────────────────────────────

class _RendererEntry {
  const _RendererEntry({required this.pattern, required this.factory});
  final String pattern;
  final RendererFactory factory;
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in renderers
//
// Phase-3 renderers (text, diff, markdown) are minimal but functional.
// Phase-4 renderers (image, audio, resource_link) are placeholder stubs.
// ─────────────────────────────────────────────────────────────────────────────

/// Renders a [DiffContent] block as plain text (Phase 3 stub).
///
/// Phase 4 (T30.09) will replace this with syntax-highlighted diff rendering.
class _DiffRenderer extends StatelessWidget {
  const _DiffRenderer({required this.block});
  final DiffContent block;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF1A1A1A),
      padding: const EdgeInsets.all(8),
      child: Text(
        block.newText,
        style: const TextStyle(
          fontFamily: 'monospace',
          fontSize: 12,
          color: Color(0xFFE0E0E0),
        ),
      ),
    );
  }
}

/// Renders a [TextContent] block with markdown [mimeType] hint.
///
/// Phase 4 will wire in flutter_markdown. For now, falls back to plain text.
class _MarkdownRenderer extends StatelessWidget {
  const _MarkdownRenderer({required this.block});
  final ContentBlock block;

  @override
  Widget build(BuildContext context) {
    final text = block is TextContent ? (block as TextContent).text : '';
    return Text(text, style: const TextStyle(color: Color(0xFFE0E0E0)));
  }
}

/// Renders a [TextContent] block as plain text.
class _TextRenderer extends StatelessWidget {
  const _TextRenderer({required this.block});
  final ContentBlock block;

  @override
  Widget build(BuildContext context) {
    final text = block is TextContent ? (block as TextContent).text : '';
    return Text(text, style: const TextStyle(color: Color(0xFFE0E0E0)));
  }
}

/// Placeholder for [ImageContent] (Phase 4: T30.14).
class _ImagePlaceholder extends StatelessWidget {
  const _ImagePlaceholder({required this.block});
  final ContentBlock block;

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text(
        '[image — renderer coming in Phase 4]',
        style: TextStyle(color: Color(0xFF888888)),
      ),
    );
  }
}

/// Placeholder for [AudioContent] (Phase 4: T30.15).
class _AudioPlaceholder extends StatelessWidget {
  const _AudioPlaceholder({required this.block});
  final ContentBlock block;

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text(
        '[audio — renderer coming in Phase 4]',
        style: TextStyle(color: Color(0xFF888888)),
      ),
    );
  }
}

/// Placeholder for [ResourceLinkContent] (Phase 4: T30.16).
class _ResourceLinkCardPlaceholder extends StatelessWidget {
  const _ResourceLinkCardPlaceholder({required this.block});
  final ContentBlock block;

  @override
  Widget build(BuildContext context) {
    final uri = block is ResourceLinkContent
        ? (block as ResourceLinkContent).uri
        : '';
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFF444444)),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        '[resource_link: $uri — card coming in Phase 4]',
        style: const TextStyle(color: Color(0xFF888888)),
      ),
    );
  }
}

/// Placeholder for [TerminalContent] (Phase 4).
class _TerminalCardPlaceholder extends StatelessWidget {
  const _TerminalCardPlaceholder({required this.block});
  final TerminalContent block;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(8),
      color: const Color(0xFF0D0D0D),
      child: Text(
        '[terminal: ${block.terminalId} — live view coming in Phase 4]',
        style: const TextStyle(
          fontFamily: 'monospace',
          fontSize: 12,
          color: Color(0xFF00FF00),
        ),
      ),
    );
  }
}

/// Fallback renderer — displays the raw JSON payload.
class _RawJsonRenderer extends StatelessWidget {
  const _RawJsonRenderer({required this.block});
  final ContentBlock block;

  @override
  Widget build(BuildContext context) {
    final raw = block is RawContent ? (block as RawContent).json.toString() : block.toString();
    return Container(
      color: const Color(0xFF1A1A1A),
      padding: const EdgeInsets.all(8),
      child: Text(
        raw,
        style: const TextStyle(
          fontFamily: 'monospace',
          fontSize: 11,
          color: Color(0xFF888888),
        ),
      ),
    );
  }
}
