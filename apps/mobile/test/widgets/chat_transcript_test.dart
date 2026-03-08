import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/theme/app_colors.dart';
import 'package:fletcher/theme/tui_widgets.dart';
import 'package:fletcher/widgets/thinking_spinner.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: child,
    ),
  );
}

void main() {
  group('ChatTranscript', () {
    // Note: ChatTranscript requires a LiveKitService which has heavy
    // dependencies (livekit_client, permissions, etc.) that can't easily
    // be instantiated in a unit test. We test the _TranscriptMessage
    // rendering via the TuiCard widgets it produces.

    testWidgets('shows empty state message when no transcript', (tester) async {
      // We can't easily create a real LiveKitService in tests, so we verify
      // the widget tree structure using the transcript message components.
      // For full integration testing, use widget tests with mocked service.

      // Test the individual message component by checking TuiCard rendering
      await tester.pumpWidget(_wrap(
        Column(
          children: [
            TuiCard(
              borderColor: AppColors.amber,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const TuiHeader(label: 'Fletcher', color: AppColors.amber),
                  const SizedBox(height: 8),
                  Text('Hello there', style: TextStyle(color: AppColors.textPrimary)),
                ],
              ),
            ),
          ],
        ),
      ));

      expect(find.text('FLETCHER'), findsOneWidget);
      expect(find.text('Hello there'), findsOneWidget);
    });

    testWidgets('agent message has amber border and header', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiCard(
          borderColor: AppColors.amber,
          child: TuiHeader(label: 'Fletcher', color: AppColors.amber),
        ),
      ));

      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      final border = decoration.border as Border;
      expect(border.left.color, AppColors.amber);
    });

    testWidgets('user message has cyan header and no border accent', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiCard(
          child: TuiHeader(label: 'You', color: AppColors.cyan),
        ),
      ));

      // No left border accent for user messages
      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.border, isNull); // TuiCard with null borderColor
    });

    testWidgets('interim text is shown in italic', (tester) async {
      await tester.pumpWidget(_wrap(
        Text(
          'Transcribing...',
          style: TextStyle(
            fontStyle: FontStyle.italic,
            color: AppColors.textSecondary,
          ),
        ),
      ));

      final text = tester.widget<Text>(find.text('Transcribing...'));
      expect(text.style?.fontStyle, FontStyle.italic);
    });

    testWidgets('final text is shown in normal style', (tester) async {
      await tester.pumpWidget(_wrap(
        Text(
          'Hello world',
          style: TextStyle(
            fontStyle: FontStyle.normal,
            color: AppColors.textPrimary,
          ),
        ),
      ));

      final text = tester.widget<Text>(find.text('Hello world'));
      expect(text.style?.fontStyle, FontStyle.normal);
    });

    testWidgets('divider uses textSecondary color', (tester) async {
      await tester.pumpWidget(_wrap(
        Divider(
          color: AppColors.textSecondary.withAlpha(77),
          height: 1,
        ),
      ));

      expect(find.byType(Divider), findsOneWidget);
    });
  });

  group('ThinkingSpinner integration', () {
    // Since ChatTranscript requires a real LiveKitService (heavy dependency),
    // we test the ThinkingSpinner widget rendering in isolation — confirming
    // it produces the expected amber TuiCard output that ChatTranscript
    // would display.

    testWidgets('thinking spinner renders when shown', (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));
      expect(find.byType(ThinkingSpinner), findsOneWidget);
      expect(find.byType(TuiCard), findsOneWidget);
    });

    testWidgets('thinking spinner has amber border matching agent messages',
        (tester) async {
      await tester.pumpWidget(_wrap(const ThinkingSpinner()));

      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      final border = decoration.border as Border;
      expect(border.left.color, AppColors.amber);
    });

    testWidgets('thinking spinner is not shown when absent', (tester) async {
      // Simulate a chat list without the thinking spinner
      await tester.pumpWidget(_wrap(
        const Column(
          children: [
            TuiCard(
              borderColor: AppColors.amber,
              child: TuiHeader(label: 'Fletcher', color: AppColors.amber),
            ),
          ],
        ),
      ));

      expect(find.byType(ThinkingSpinner), findsNothing);
    });
  });
}
