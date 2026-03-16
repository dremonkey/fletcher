import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/utils/agent_text_parser.dart';
import 'package:fletcher/widgets/thinking_block.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: child,
      ),
    ),
  );
}

void main() {
  group('ThinkingBlock', () {
    group('complete mode', () {
      testWidgets('renders collapsed by default with diamond indicator',
          (tester) async {
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: 'The user asked for a summary.',
            state: ThinkingState.complete,
          ),
        ));

        // Should show collapsed state with ◆ indicator.
        final texts = tester.widgetList<Text>(find.byType(Text)).toList();
        expect(texts, isNotEmpty);

        // The collapsed line includes ◆ and the preview.
        final collapsedText = texts.first;
        expect(collapsedText.data, contains('◆'));
        expect(collapsedText.data, contains('thinking'));
      });

      testWidgets('collapsed state shows preview text in quotes',
          (tester) async {
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: 'My reasoning.',
            state: ThinkingState.complete,
          ),
        ));

        final text = tester.widget<Text>(find.byType(Text).first);
        // Preview is shown in quotes.
        expect(text.data, contains('"My reasoning."'));
      });

      testWidgets('collapsed state has maxLines: 1 and ellipsis overflow',
          (tester) async {
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text:
                'Very long reasoning text that should be truncated when collapsed'
                ' because it exceeds the single line limit in the UI.',
            state: ThinkingState.complete,
          ),
        ));

        final text = tester.widget<Text>(find.byType(Text).first);
        expect(text.maxLines, equals(1));
        expect(text.overflow, equals(TextOverflow.ellipsis));
      });

      testWidgets('expands on tap — shows down triangle indicator',
          (tester) async {
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: 'Full reasoning text.',
            state: ThinkingState.complete,
          ),
        ));

        // Tap the thinking block to expand.
        await tester.tap(find.byType(ThinkingBlock));
        await tester.pump();

        // Find all Text widgets and verify ▼ appears.
        final texts = tester.widgetList<Text>(find.byType(Text)).toList();
        final allText = texts.map((t) => t.data ?? '').join(' ');
        expect(allText, contains('▼'));
        expect(allText, contains('thinking'));
      });

      testWidgets('expands on tap — shows full thinking text', (tester) async {
        const fullText = 'Full reasoning text for the expanded view.';

        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: fullText,
            state: ThinkingState.complete,
          ),
        ));

        // Tap to expand.
        await tester.tap(find.byType(ThinkingBlock));
        await tester.pump();

        // The full text should now be visible.
        expect(find.text(fullText), findsOneWidget);
      });

      testWidgets('collapses on second tap', (tester) async {
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: 'Full reasoning text.',
            state: ThinkingState.complete,
          ),
        ));

        // First tap — expand. Use the header text as the tap target.
        await tester.tap(find.byType(Text).first);
        await tester.pump();

        // Verify expanded (▼ present).
        {
          final texts = tester.widgetList<Text>(find.byType(Text)).toList();
          final allText = texts.map((t) => t.data ?? '').join(' ');
          expect(allText, contains('▼'));
        }

        // Second tap — collapse. Tap the ▼ header text.
        await tester.tap(find.text('▼ thinking'));
        await tester.pump();

        // Verify collapsed (◆ present, ▼ absent).
        {
          final texts = tester.widgetList<Text>(find.byType(Text)).toList();
          final allText = texts.map((t) => t.data ?? '').join(' ');
          expect(allText, contains('◆'));
          expect(allText, isNot(contains('▼')));
        }
      });

      testWidgets('long text truncated with ellipsis when collapsed',
          (tester) async {
        const longText =
            'This is a very long reasoning text that definitely exceeds '
            'the maximum single line width and must be truncated with an '
            'ellipsis to prevent overflow in the compact collapsed view.';

        await tester.pumpWidget(_wrap(
          SizedBox(
            width: 300,
            child: const ThinkingBlock(
              text: longText,
              state: ThinkingState.complete,
            ),
          ),
        ));

        final text = tester.widget<Text>(find.byType(Text).first);
        expect(text.maxLines, equals(1));
        expect(text.overflow, equals(TextOverflow.ellipsis));
      });

      testWidgets('null text — collapsed still shows indicator', (tester) async {
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: null,
            state: ThinkingState.complete,
          ),
        ));

        final text = tester.widget<Text>(find.byType(Text).first);
        expect(text.data, contains('◆'));
        expect(text.data, contains('thinking'));
      });

      testWidgets('GestureDetector wraps the collapsed view', (tester) async {
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: 'Some reasoning.',
            state: ThinkingState.complete,
          ),
        ));

        expect(find.byType(GestureDetector), findsOneWidget);
      });
    });

    group('in-progress mode', () {
      testWidgets('shows diamond + thinking label + dots', (tester) async {
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: null,
            state: ThinkingState.inProgress,
          ),
        ));

        final text = tester.widget<Text>(find.byType(Text).first);
        expect(text.data, equals('◆ thinking ···'));
      });

      testWidgets('shows indicator even with partial text', (tester) async {
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: 'The user is',
            state: ThinkingState.inProgress,
          ),
        ));

        // In-progress mode always shows the fixed "◆ thinking ···" label,
        // not the partial streaming text.
        final text = tester.widget<Text>(find.byType(Text).first);
        expect(text.data, equals('◆ thinking ···'));
      });

      testWidgets('not tappable — tap does nothing', (tester) async {
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: null,
            state: ThinkingState.inProgress,
          ),
        ));

        // No GestureDetector in inProgress mode.
        expect(find.byType(GestureDetector), findsNothing);

        // Tapping should not change state.
        await tester.tap(find.byType(ThinkingBlock));
        await tester.pump();

        // Still showing inProgress UI.
        final text = tester.widget<Text>(find.byType(Text).first);
        expect(text.data, equals('◆ thinking ···'));
      });

      testWidgets('has maxLines: 1 with ellipsis', (tester) async {
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: null,
            state: ThinkingState.inProgress,
          ),
        ));

        final text = tester.widget<Text>(find.byType(Text).first);
        expect(text.maxLines, equals(1));
        expect(text.overflow, equals(TextOverflow.ellipsis));
      });
    });

    group('state transitions', () {
      testWidgets('transitions from inProgress to complete', (tester) async {
        // Start in inProgress.
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: 'partial',
            state: ThinkingState.inProgress,
          ),
        ));

        {
          final text = tester.widget<Text>(find.byType(Text).first);
          expect(text.data, equals('◆ thinking ···'));
        }

        // Rebuild with complete state.
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: 'full reasoning',
            state: ThinkingState.complete,
          ),
        ));

        {
          final text = tester.widget<Text>(find.byType(Text).first);
          // Now in complete collapsed mode.
          expect(text.data, contains('◆'));
          expect(text.data, contains('"full reasoning"'));
        }
      });

      testWidgets('renders without error when state is none', (tester) async {
        // ThinkingState.none should not normally be passed to ThinkingBlock,
        // but it should not crash if it is.
        await tester.pumpWidget(_wrap(
          const ThinkingBlock(
            text: null,
            state: ThinkingState.none,
          ),
        ));
        // Just verify it renders without throwing.
        expect(find.byType(ThinkingBlock), findsOneWidget);
      });
    });
  });
}
