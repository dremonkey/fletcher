import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/content_block.dart';
import 'package:fletcher/widgets/renderers/image_renderer.dart';
import 'package:fletcher/widgets/renderer_registry.dart';

// ---------------------------------------------------------------------------
// Minimal 1×1 transparent PNG (67 bytes) — smallest valid PNG.
// ---------------------------------------------------------------------------
const String _tiny1x1PngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
    'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

Widget _wrap(Widget child) => MaterialApp(
      home: Scaffold(body: child),
    );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // Override compute to run synchronously in tests (avoids isolate complexity).
  setUp(() {
    debugDefaultTargetPlatformOverride = null;
  });

  group('ImageTooLargeException', () {
    test('megabytes property returns correct value', () {
      const e = ImageTooLargeException(6 * 1024 * 1024);
      expect(e.megabytes, closeTo(6.0, 0.01));
    });

    test('toString includes size and limit', () {
      const e = ImageTooLargeException(6 * 1024 * 1024);
      final s = e.toString();
      expect(s, contains('6.0 MB'));
      expect(s, contains('5'));
    });
  });

  group('_decodeBase64 (via ImageRenderer)', () {
    testWidgets('valid PNG base64 renders Image.memory widget', (tester) async {
      final block = ImageContent(
        data: _tiny1x1PngBase64,
        mimeType: 'image/png',
      );

      await tester.pumpWidget(_wrap(ImageRenderer(block: block)));

      // Initial frame: loading spinner.
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // Let the async decode complete.
      await tester.pumpAndSettle();

      // After decode: Image.memory should appear.
      expect(find.byType(Image), findsOneWidget);
      // No error view.
      expect(find.byIcon(Icons.broken_image), findsNothing);
    });

    testWidgets('invalid base64 string → error state', (tester) async {
      final block = ImageContent(
        data: '!!!not_valid_base64!!!',
        mimeType: 'image/png',
      );

      await tester.pumpWidget(_wrap(ImageRenderer(block: block)));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.broken_image), findsOneWidget);
      expect(find.byType(Image), findsNothing);
    });

    testWidgets('oversized image (>5MB) → rejection message', (tester) async {
      // Create a base64 string that decodes to >5MB of bytes.
      final bigBytes = Uint8List(5 * 1024 * 1024 + 1);
      final bigBase64 = base64Encode(bigBytes);

      final block = ImageContent(data: bigBase64, mimeType: 'image/png');

      await tester.pumpWidget(_wrap(ImageRenderer(block: block)));
      await tester.pumpAndSettle();

      // Should show the oversized error view, not an image.
      expect(find.byType(Image), findsNothing);
      expect(find.byIcon(Icons.broken_image), findsOneWidget);
      // Message should mention MB and limit.
      expect(find.textContaining('too large'), findsOneWidget);
      expect(find.textContaining('5 MB'), findsOneWidget);
    });

    testWidgets('loading spinner visible before decode completes',
        (tester) async {
      final block = ImageContent(
        data: _tiny1x1PngBase64,
        mimeType: 'image/jpeg',
      );

      await tester.pumpWidget(_wrap(ImageRenderer(block: block)));

      // Before settling: spinner must be present.
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byType(Image), findsNothing);

      await tester.pumpAndSettle();
    });
  });

  group('ImageRenderer MIME type handling', () {
    for (final mime in ['image/jpeg', 'image/png', 'image/gif']) {
      testWidgets('renders successfully for $mime', (tester) async {
        final block = ImageContent(
          data: _tiny1x1PngBase64,
          mimeType: mime,
        );

        await tester.pumpWidget(_wrap(ImageRenderer(block: block)));
        await tester.pumpAndSettle();

        expect(find.byType(Image), findsOneWidget,
            reason: 'Expected Image widget for MIME type $mime');
      });
    }
  });

  group('RendererRegistry image/* registration', () {
    late RendererRegistry registry;

    setUp(() {
      registry = RendererRegistry.instance..clear();
      registerImageRenderer(registry);
    });

    tearDown(() {
      registry.clear();
    });

    testWidgets('image/* pattern dispatches to ImageRenderer', (tester) async {
      final block = ImageContent(
        data: _tiny1x1PngBase64,
        mimeType: 'image/png',
      );

      final widget = registry.build(block);
      expect(widget, isA<ImageRenderer>());
    });

    testWidgets('image/jpeg dispatches to ImageRenderer', (tester) async {
      final block = ImageContent(
        data: _tiny1x1PngBase64,
        mimeType: 'image/jpeg',
      );

      final widget = registry.build(block);
      expect(widget, isA<ImageRenderer>());
    });

    testWidgets('image/gif dispatches to ImageRenderer', (tester) async {
      final block = ImageContent(
        data: _tiny1x1PngBase64,
        mimeType: 'image/gif',
      );

      final widget = registry.build(block);
      expect(widget, isA<ImageRenderer>());
    });
  });
}
