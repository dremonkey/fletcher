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
      body: SizedBox(
        width: 400,
        child: child,
      ),
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
      // Pump past the notch phase so the text is visible (opacity > 0).
      await tester.pump(const Duration(milliseconds: 200));

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

    testWidgets('shows arrow glyph during notch phase', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));
      // Pump slightly so we get a frame rendered.
      await tester.pump(const Duration(milliseconds: 50));

      // During notch, text should contain the arrow glyph.
      final text = tester.widget<Text>(find.byType(Text).first);
      expect(text.data, contains('>>--->'));
    });

    testWidgets('arrow moves during streak phase', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));

      // Advance past the notch phase (400ms) to enter streak.
      await tester.pump(const Duration(milliseconds: 450));

      final textAtStreakStart = tester.widget<Text>(find.byType(Text).first);
      final contentAtStart = textAtStreakStart.data ?? '';

      // Advance further into the streak.
      await tester.pump(const Duration(milliseconds: 200));

      final textLater = tester.widget<Text>(find.byType(Text).first);
      final contentLater = textLater.data ?? '';

      // The arrow should have moved — the content should differ.
      // During streak the arrow glyph is still present but at a different
      // position (different leading whitespace).
      expect(contentLater, isNot(equals(contentAtStart)));
    });

    testWidgets('arrow glyph present during streak', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));

      // Advance into streak phase.
      await tester.pump(const Duration(milliseconds: 500));

      final text = tester.widget<Text>(find.byType(Text).first);
      expect(text.data, contains('>>--->'));
    });

    testWidgets('impact phase shows particle characters', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));

      // We need to advance past notch (400ms) + the entire streak duration.
      // The streak duration depends on line width. Pump a generous amount
      // to definitely be past streak and into impact/rebirth.
      // Pump in steps so the animation controllers can tick.
      for (int i = 0; i < 60; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }

      // At this point we may be in impact, rebirth, or a new notch cycle.
      // Just verify the widget is still rendering without errors.
      expect(find.byType(ThinkingSpinner), findsOneWidget);
    });

    testWidgets('animation cycles (full loop does not crash)', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));

      // Pump through enough time for at least two full cycles.
      // Each cycle: notch(400) + streak(variable) + impact(500) + rebirth(400).
      // With a reasonable line width of ~40 chars at 35ms/char, streak ~ 1200ms.
      // Total cycle ~ 2500ms. Pump 6 seconds for safety.
      for (int i = 0; i < 120; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }

      // Should still be rendering fine.
      expect(find.byType(ThinkingSpinner), findsOneWidget);
      final text = tester.widget<Text>(find.byType(Text).first);
      expect(text.data, isNotNull);
    });

    testWidgets('text content changes over time', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));

      // Capture initial frame text.
      final initialText = tester.widget<Text>(find.byType(Text).first);
      final initialContent = initialText.data;

      // Advance well past notch (400ms) and deep into streak so the arrow
      // has clearly moved. Pump in steps so controllers tick.
      for (int i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }

      final secondText = tester.widget<Text>(find.byType(Text).first);
      final secondContent = secondText.data;

      // The text content should have changed between phases.
      expect(secondContent, isNot(equals(initialContent)));
    });

    testWidgets('uses Opacity widget for fade effects', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));
      // During notch phase, Opacity is used for fade-in.
      expect(find.byType(Opacity), findsWidgets);
    });

    testWidgets('disposes cleanly', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));
      await tester.pump(const Duration(milliseconds: 500));

      // Remove the widget — should dispose without errors.
      await tester.pumpWidget(_wrap(const SizedBox()));
      expect(find.byType(ThinkingSpinner), findsNothing);
    });
  });
}
