import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'package:fletcher/models/content_block.dart';
import 'package:fletcher/widgets/renderers/diff_renderer.dart';
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

  group('DiffRenderer', () {
    testWidgets('renders file path header', (tester) async {
      final block = DiffContent(
        path: 'lib/main.dart',
        newText: 'void main() {}',
      );
      await tester.pumpWidget(_wrap(DiffRenderer(block: block)));
      expect(find.text('lib/main.dart'), findsOneWidget);
    });

    testWidgets('renders new text lines as additions when no oldText', (tester) async {
      final block = DiffContent(
        path: 'new_file.dart',
        newText: 'line one\nline two',
      );
      await tester.pumpWidget(_wrap(DiffRenderer(block: block)));
      await tester.pump();
      // Additions are prefixed with '+'.
      expect(find.textContaining('+line one'), findsOneWidget);
      expect(find.textContaining('+line two'), findsOneWidget);
    });

    testWidgets('renders unified diff header lines when oldText provided', (tester) async {
      final block = DiffContent(
        path: 'src/app.dart',
        oldText: 'hello\nworld',
        newText: 'hello\nearth',
      );
      await tester.pumpWidget(_wrap(DiffRenderer(block: block)));
      await tester.pump();
      // Diff headers should appear.
      expect(find.textContaining('--- a/src/app.dart'), findsOneWidget);
      expect(find.textContaining('+++ b/src/app.dart'), findsOneWidget);
    });

    testWidgets('renders minus line for removed text', (tester) async {
      final block = DiffContent(
        path: 'x.dart',
        oldText: 'removed line\nkept line',
        newText: 'kept line',
      );
      await tester.pumpWidget(_wrap(DiffRenderer(block: block)));
      await tester.pump();
      expect(find.textContaining('-removed line'), findsOneWidget);
    });

    testWidgets('renders plus line for added text', (tester) async {
      final block = DiffContent(
        path: 'x.dart',
        oldText: 'kept line',
        newText: 'kept line\nadded line',
      );
      await tester.pumpWidget(_wrap(DiffRenderer(block: block)));
      await tester.pump();
      expect(find.textContaining('+added line'), findsOneWidget);
    });

    testWidgets('shows (no changes) when old and new text are identical', (tester) async {
      const text = 'same content';
      final block = DiffContent(
        path: 'y.dart',
        oldText: text,
        newText: text,
      );
      await tester.pumpWidget(_wrap(DiffRenderer(block: block)));
      await tester.pump();
      expect(find.text('(no changes)'), findsOneWidget);
    });
  });

  group('DiffRenderer._buildDiffLines (unit)', () {
    test('returns additions when no oldText', () {
      final block = DiffContent(path: 'f.dart', newText: 'a\nb');
      final lines = DiffRenderer.buildDiffLinesForTest(block);
      expect(lines, contains('+a'));
      expect(lines, contains('+b'));
    });

    test('empty line stays empty when no oldText', () {
      final block = DiffContent(path: 'f.dart', newText: 'a\n\nb');
      final lines = DiffRenderer.buildDiffLinesForTest(block);
      // The empty line should not get a '+' prefix.
      expect(lines, contains(''));
    });

    test('returns no-changes marker for identical texts', () {
      final block = DiffContent(
        path: 'f.dart',
        oldText: 'same',
        newText: 'same',
      );
      final lines = DiffRenderer.buildDiffLinesForTest(block);
      expect(lines, ['(no changes)']);
    });

    test('includes diff headers for changed content', () {
      final block = DiffContent(
        path: 'src/x.dart',
        oldText: 'old',
        newText: 'new',
      );
      final lines = DiffRenderer.buildDiffLinesForTest(block);
      expect(lines.any((l) => l.startsWith('---')), isTrue);
      expect(lines.any((l) => l.startsWith('+++')), isTrue);
    });
  });
}
