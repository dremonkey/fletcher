import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'package:fletcher/models/content_block.dart';
import 'package:fletcher/widgets/renderers/code_renderer.dart';
import 'package:fletcher/theme/app_colors.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      backgroundColor: AppColors.background,
      body: child,
    ),
  );
}

void main() {
  setUpAll(() async {
    dotenv.testLoad(fileInput: '');
  });

  group('CodeRenderer', () {
    testWidgets('renders code lines with line numbers', (tester) async {
      final block = TextContent(
        text: 'void main() {\n  print("hi");\n}',
        mimeType: 'text/x-dart',
      );
      await tester.pumpWidget(_wrap(CodeRenderer(block: block)));
      await tester.pump();
      // Line numbers
      expect(find.text('1'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
    });

    testWidgets('shows language badge from mimeType text/x-python', (tester) async {
      final block = TextContent(
        text: 'print("hello")',
        mimeType: 'text/x-python',
      );
      await tester.pumpWidget(_wrap(CodeRenderer(block: block)));
      await tester.pump();
      expect(find.text('python'), findsOneWidget);
    });

    testWidgets('shows no language badge when mimeType is text/plain', (tester) async {
      final block = TextContent(text: 'plain text', mimeType: 'text/plain');
      await tester.pumpWidget(_wrap(CodeRenderer(block: block)));
      await tester.pump();
      // No badge — text/plain has no text/x- language hint.
      expect(find.text('plain'), findsNothing);
    });

    testWidgets('renders ResourceContent with uri as path header', (tester) async {
      final block = ResourceContent(
        uri: '/home/user/project/src/app.ts',
        mimeType: 'text/x-typescript',
        text: 'const x = 1;',
      );
      await tester.pumpWidget(_wrap(CodeRenderer(block: block)));
      await tester.pump();
      expect(find.textContaining('/home/user/project/src/app.ts'), findsOneWidget);
      expect(find.text('typescript'), findsOneWidget);
    });

    testWidgets('renders code text content', (tester) async {
      final block = TextContent(
        text: 'hello world',
        mimeType: 'text/x-dart',
      );
      await tester.pumpWidget(_wrap(CodeRenderer(block: block)));
      await tester.pump();
      expect(find.text('hello world'), findsOneWidget);
    });
  });

  group('CodeRenderer static helpers', () {
    test('extractLanguage returns null for text/plain', () {
      final block = TextContent(text: '', mimeType: 'text/plain');
      expect(CodeRenderer.extractLanguageForTest(block), isNull);
    });

    test('extractLanguage returns language from text/x-<lang>', () {
      final block = TextContent(text: '', mimeType: 'text/x-ruby');
      expect(CodeRenderer.extractLanguageForTest(block), 'ruby');
    });

    test('extractLanguage returns null when mimeType is null', () {
      final block = TextContent(text: '');
      expect(CodeRenderer.extractLanguageForTest(block), isNull);
    });
  });
}
