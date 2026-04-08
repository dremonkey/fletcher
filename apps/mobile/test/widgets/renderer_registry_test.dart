import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/content_block.dart';
import 'package:fletcher/widgets/renderer_registry.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(body: child),
  );
}

/// Builds [block] via a fresh [RendererRegistry] and pumps the result.
///
/// Returns the root [Widget] rendered (not the MaterialApp wrapper).
Future<void> _pump(WidgetTester tester, ContentBlock block) async {
  final registry = RendererRegistry();
  registry.register('text/x-diff', (b) => _DiffSentinel(key: const Key('diff')));
  registry.register('text/markdown', (b) => _MarkdownSentinel(key: const Key('markdown')));
  registry.register('text/*', (b) => _TextSentinel(key: const Key('text')));
  registry.register('image/*', (b) => _ImageSentinel(key: const Key('image')));
  registry.register('audio/*', (b) => _AudioSentinel(key: const Key('audio')));
  registry.register('resource_link', (b) => _ResourceLinkSentinel(key: const Key('resource_link')));
  registry.register('*/*', (b) => _FallbackSentinel(key: const Key('fallback')));
  await tester.pumpWidget(_wrap(registry.build(block)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel widgets — identity markers for assertions
// ─────────────────────────────────────────────────────────────────────────────

class _DiffSentinel extends StatelessWidget {
  const _DiffSentinel({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

class _MarkdownSentinel extends StatelessWidget {
  const _MarkdownSentinel({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

class _TextSentinel extends StatelessWidget {
  const _TextSentinel({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

class _ImageSentinel extends StatelessWidget {
  const _ImageSentinel({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

class _AudioSentinel extends StatelessWidget {
  const _AudioSentinel({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

class _ResourceLinkSentinel extends StatelessWidget {
  const _ResourceLinkSentinel({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

class _FallbackSentinel extends StatelessWidget {
  const _FallbackSentinel({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

// ─────────────────────────────────────────────────────────────────────────────

void main() {
  group('RendererRegistry', () {
    // ── Exact MIME match ────────────────────────────────────────────────────
    group('exact MIME match', () {
      testWidgets('text/markdown routes to MarkdownSentinel', (tester) async {
        final block = const TextContent(
          text: '# Hello',
          mimeType: 'text/markdown',
        );
        await _pump(tester, block);
        expect(find.byType(_MarkdownSentinel), findsOneWidget);
        expect(find.byType(_TextSentinel), findsNothing);
        expect(find.byType(_FallbackSentinel), findsNothing);
      });

      testWidgets('text/x-diff routes to DiffSentinel via MIME', (tester) async {
        // TextContent with text/x-diff mimeType should hit the exact MIME rule,
        // not the structural DiffContent rule.
        final block = const TextContent(
          text: '--- a\n+++ b',
          mimeType: 'text/x-diff',
        );
        await _pump(tester, block);
        expect(find.byType(_DiffSentinel), findsOneWidget);
        expect(find.byType(_TextSentinel), findsNothing);
      });
    });

    // ── Wildcard subtype match ───────────────────────────────────────────────
    group('wildcard subtype match', () {
      testWidgets('text/html matches text/* pattern', (tester) async {
        final block = const TextContent(text: '<b>hi</b>', mimeType: 'text/html');
        await _pump(tester, block);
        expect(find.byType(_TextSentinel), findsOneWidget);
        expect(find.byType(_FallbackSentinel), findsNothing);
      });

      testWidgets('text/plain matches text/* pattern', (tester) async {
        final block = const TextContent(text: 'hello', mimeType: 'text/plain');
        await _pump(tester, block);
        expect(find.byType(_TextSentinel), findsOneWidget);
      });

      testWidgets('image/png matches image/* pattern', (tester) async {
        final block = const ImageContent(
          data: 'base64data',
          mimeType: 'image/png',
        );
        await _pump(tester, block);
        expect(find.byType(_ImageSentinel), findsOneWidget);
        expect(find.byType(_FallbackSentinel), findsNothing);
      });

      testWidgets('image/jpeg matches image/* pattern', (tester) async {
        final block = const ImageContent(
          data: 'base64data',
          mimeType: 'image/jpeg',
        );
        await _pump(tester, block);
        expect(find.byType(_ImageSentinel), findsOneWidget);
      });

      testWidgets('audio/wav matches audio/* pattern', (tester) async {
        final block = const AudioContent(
          data: 'base64data',
          mimeType: 'audio/wav',
        );
        await _pump(tester, block);
        expect(find.byType(_AudioSentinel), findsOneWidget);
        expect(find.byType(_FallbackSentinel), findsNothing);
      });
    });

    // ── Specificity ordering: most specific wins ─────────────────────────────
    group('specificity ordering', () {
      testWidgets('text/markdown wins over text/* for markdown content',
          (tester) async {
        final block = const TextContent(
          text: '# Title',
          mimeType: 'text/markdown',
        );
        await _pump(tester, block);
        // Should route to MarkdownSentinel, not TextSentinel.
        expect(find.byType(_MarkdownSentinel), findsOneWidget);
        expect(find.byType(_TextSentinel), findsNothing);
      });

      testWidgets('text/x-diff wins over text/* for diff MIME', (tester) async {
        final block = const TextContent(
          text: '--- a\n+++ b\n@@ -1 +1 @@',
          mimeType: 'text/x-diff',
        );
        await _pump(tester, block);
        expect(find.byType(_DiffSentinel), findsOneWidget);
        expect(find.byType(_TextSentinel), findsNothing);
      });

      testWidgets('text/* wins over */* for plain text', (tester) async {
        final block = const TextContent(text: 'hello');
        await _pump(tester, block);
        // TextContent with no mimeType defaults to text/plain → text/*.
        expect(find.byType(_TextSentinel), findsOneWidget);
        expect(find.byType(_FallbackSentinel), findsNothing);
      });
    });

    // ── Structural dispatch (sealed class type, not MIME) ────────────────────
    group('structural dispatch', () {
      testWidgets('DiffContent dispatches by type — ignores MIME', (tester) async {
        final registry = RendererRegistry();
        // Register */* only — DiffContent should still be caught by structural dispatch.
        registry.register('*/*', (b) => _FallbackSentinel(key: const Key('fallback')));

        final block = const DiffContent(
          path: 'lib/main.dart',
          newText: 'void main() {}',
        );
        // DiffContent is handled structurally before MIME lookup.
        // The returned widget should NOT be _FallbackSentinel.
        await tester.pumpWidget(_wrap(registry.build(block)));
        expect(find.byType(_FallbackSentinel), findsNothing);
      });

      testWidgets('TerminalContent dispatches by type', (tester) async {
        final registry = RendererRegistry();
        registry.register('*/*', (b) => _FallbackSentinel(key: const Key('fallback')));

        final block = const TerminalContent(terminalId: 'term-1');
        await tester.pumpWidget(_wrap(registry.build(block)));
        expect(find.byType(_FallbackSentinel), findsNothing);
      });

      testWidgets('RawContent dispatches by type', (tester) async {
        final registry = RendererRegistry();
        registry.register('*/*', (b) => _FallbackSentinel(key: const Key('fallback')));

        final block = RawContent(json: const {'type': 'unknown', 'data': 42});
        await tester.pumpWidget(_wrap(registry.build(block)));
        expect(find.byType(_FallbackSentinel), findsNothing);
      });
    });

    // ── Global wildcard fallback */* ─────────────────────────────────────────
    group('global wildcard fallback', () {
      testWidgets('unknown MIME falls through to */* fallback', (tester) async {
        final registry = RendererRegistry();
        registry.register('*/*', (b) => _FallbackSentinel(key: const Key('fallback')));

        // ResourceContent with an unusual MIME — no other pattern will match.
        final block = const ResourceContent(
          uri: 'urn:example:resource',
          mimeType: 'application/x-custom-format',
        );
        await tester.pumpWidget(_wrap(registry.build(block)));
        expect(find.byType(_FallbackSentinel), findsOneWidget);
      });

      testWidgets('null mimeType on TextContent defaults to text/plain — text/* matches',
          (tester) async {
        final block = const TextContent(text: 'no mime');
        await _pump(tester, block);
        // text/plain → text/* → TextSentinel, not FallbackSentinel.
        expect(find.byType(_TextSentinel), findsOneWidget);
        expect(find.byType(_FallbackSentinel), findsNothing);
      });
    });

    // ── ResourceLinkContent special type ────────────────────────────────────
    group('ResourceLinkContent', () {
      testWidgets('routes to resource_link pattern', (tester) async {
        final block = const ResourceLinkContent(
          uri: 'https://example.com/doc',
          name: 'doc.pdf',
        );
        await _pump(tester, block);
        expect(find.byType(_ResourceLinkSentinel), findsOneWidget);
        expect(find.byType(_FallbackSentinel), findsNothing);
      });
    });

    // ── Default singleton ────────────────────────────────────────────────────
    group('RendererRegistry.instance', () {
      testWidgets('returns a widget for every ContentBlock subtype',
          (tester) async {
        final registry = RendererRegistry.instance;
        final blocks = <ContentBlock>[
          const TextContent(text: 'hello'),
          const TextContent(text: '# md', mimeType: 'text/markdown'),
          const ImageContent(data: 'data', mimeType: 'image/png'),
          const AudioContent(data: 'data', mimeType: 'audio/wav'),
          const ResourceContent(uri: 'urn:x'),
          const ResourceLinkContent(uri: 'https://x.com', name: 'x'),
          const DiffContent(path: 'a.dart', newText: 'x'),
          const TerminalContent(terminalId: 'tid'),
          RawContent(json: const {'type': 'future_type'}),
        ];

        for (final block in blocks) {
          await tester.pumpWidget(_wrap(registry.build(block)));
          // Verify the widget tree renders without throwing.
          expect(find.byType(MaterialApp), findsOneWidget,
              reason: 'Expected a widget for ${block.runtimeType}');
        }
      });

      testWidgets('no match in empty registry falls back gracefully',
          (tester) async {
        // An empty registry has no */* entry — build() must not throw.
        final registry = RendererRegistry();
        final block = const TextContent(text: 'no renderers');
        final widget = registry.build(block);
        await tester.pumpWidget(_wrap(widget));
        // Should render the hardcoded RawJsonRenderer fallback.
        expect(find.byType(MaterialApp), findsOneWidget);
      });
    });
  });
}
