import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'package:fletcher/models/content_block.dart';
import 'package:fletcher/widgets/renderers/markdown_renderer.dart';
import 'package:fletcher/theme/app_colors.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      backgroundColor: AppColors.background,
      body: SizedBox(
        width: 400,
        height: 600,
        child: child,
      ),
    ),
  );
}

void main() {
  setUpAll(() async {
    dotenv.testLoad(fileInput: '');
  });

  group('MarkdownRenderer', () {
    testWidgets('renders plain text from TextContent', (tester) async {
      final block = TextContent(
        text: 'Hello, world!',
        mimeType: 'text/markdown',
      );
      await tester.pumpWidget(_wrap(MarkdownRenderer(block: block)));
      await tester.pump();
      expect(find.textContaining('Hello, world!'), findsOneWidget);
    });

    testWidgets('renders heading text', (tester) async {
      final block = TextContent(
        text: '# My Heading',
        mimeType: 'text/markdown',
      );
      await tester.pumpWidget(_wrap(MarkdownRenderer(block: block)));
      await tester.pump();
      expect(find.textContaining('My Heading'), findsOneWidget);
    });

    testWidgets('accepts TextContent with no mimeType', (tester) async {
      final block = TextContent(text: 'some **bold** text');
      await tester.pumpWidget(_wrap(MarkdownRenderer(block: block)));
      await tester.pump();
      // Should not throw.
      expect(find.byType(MarkdownRenderer), findsOneWidget);
    });

    testWidgets('renders empty text without error', (tester) async {
      final block = TextContent(text: '');
      await tester.pumpWidget(_wrap(MarkdownRenderer(block: block)));
      await tester.pump();
      expect(find.byType(MarkdownRenderer), findsOneWidget);
    });
  });
}
