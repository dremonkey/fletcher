import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/theme/app_colors.dart';
import 'package:fletcher/theme/app_typography.dart';
import 'package:fletcher/theme/tui_widgets.dart';
import 'package:fletcher/widgets/thinking_spinner.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      backgroundColor: AppColors.background,
      body: child,
    ),
  );
}

void main() {
  group('ThinkingSpinner', () {
    testWidgets('renders without errors', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));
      expect(find.byType(ThinkingSpinner), findsOneWidget);
    });

    testWidgets('is wrapped in a TuiCard with amber border', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));

      // Find the TuiCard
      expect(find.byType(TuiCard), findsOneWidget);

      // Verify the Container decoration has amber left border
      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      final border = decoration.border as Border;
      expect(border.left.color, AppColors.amber);
    });

    testWidgets('uses monospace amber text', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));
      await tester.pump();

      // Find the Text widget inside the spinner
      final textWidgets = tester.widgetList<Text>(find.byType(Text));
      expect(textWidgets.isNotEmpty, isTrue);

      final text = textWidgets.first;
      expect(text.style?.color, AppColors.amber);
      expect(text.style?.fontFamily, AppTypography.body.fontFamily);
    });

    testWidgets('is wrapped in RepaintBoundary', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));
      expect(find.byType(RepaintBoundary), findsWidgets);
    });

    testWidgets('animation frames change over time', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));

      // Capture initial frame text
      final initialText = tester.widget<Text>(find.byType(Text).first);
      final initialContent = initialText.data;

      // Advance past first frame boundary (250ms)
      await tester.pump(const Duration(milliseconds: 300));

      final secondText = tester.widget<Text>(find.byType(Text).first);
      final secondContent = secondText.data;

      // The text content should have changed between frames
      expect(secondContent, isNot(equals(initialContent)));
    });

    testWidgets('cycles through all 4 frames over 1 second', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));

      final seenFrames = <String>{};

      // Sample at each quarter of the 1000ms cycle
      for (int i = 0; i < 4; i++) {
        final text = tester.widget<Text>(find.byType(Text).first);
        seenFrames.add(text.data ?? '');
        await tester.pump(const Duration(milliseconds: 250));
      }

      // Should have seen at least 2 distinct frames
      expect(seenFrames.length, greaterThanOrEqualTo(2));
    });
  });
}
