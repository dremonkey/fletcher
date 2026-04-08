import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'package:fletcher/models/content_block.dart';
import 'package:fletcher/widgets/renderers/raw_json_renderer.dart';
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

  group('RawJsonRenderer', () {
    testWidgets('displays header warning text', (tester) async {
      final block = RawContent(json: {'type': 'exotic'});
      await tester.pumpWidget(_wrap(RawJsonRenderer(block: block)));
      await tester.pump();
      expect(
        find.textContaining('Unknown content type'),
        findsOneWidget,
      );
    });

    testWidgets('renders formatted JSON content', (tester) async {
      final block = RawContent(json: {'key': 'value', 'number': 42});
      await tester.pumpWidget(_wrap(RawJsonRenderer(block: block)));
      await tester.pump();
      expect(find.textContaining('"key"'), findsOneWidget);
      expect(find.textContaining('"value"'), findsOneWidget);
      expect(find.textContaining('42'), findsOneWidget);
    });

    testWidgets('renders empty JSON object without error', (tester) async {
      final block = RawContent(json: {});
      await tester.pumpWidget(_wrap(RawJsonRenderer(block: block)));
      await tester.pump();
      expect(find.byType(RawJsonRenderer), findsOneWidget);
    });

    testWidgets('renders nested JSON structure', (tester) async {
      final block = RawContent(json: {
        'outer': {'inner': 'value'},
      });
      await tester.pumpWidget(_wrap(RawJsonRenderer(block: block)));
      await tester.pump();
      expect(find.textContaining('"inner"'), findsOneWidget);
    });
  });
}
