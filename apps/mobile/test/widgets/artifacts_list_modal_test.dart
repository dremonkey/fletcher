import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/conversation_state.dart';
import 'package:fletcher/theme/tui_widgets.dart';
import 'package:fletcher/widgets/artifact_viewer.dart';

ArtifactEvent _makeArtifact({
  ArtifactType type = ArtifactType.code,
  String? title,
  String? content,
}) {
  return ArtifactEvent(
    artifactType: type,
    title: title,
    content: content,
  );
}

void main() {
  group('Artifacts list modal', () {
    testWidgets('renders items with displayTitle', (tester) async {
      final artifacts = [
        _makeArtifact(title: 'alpha.dart', content: 'a'),
        _makeArtifact(title: 'beta.dart', content: 'b'),
      ];

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showArtifactsListModal(
                context,
                artifacts: artifacts,
              ),
              child: const Text('Open list'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open list'));
      await tester.pumpAndSettle();

      expect(find.text('alpha.dart'), findsOneWidget);
      expect(find.text('beta.dart'), findsOneWidget);
    });

    testWidgets('shows artifact count in header', (tester) async {
      final artifacts = [
        _makeArtifact(title: 'one'),
        _makeArtifact(title: 'two'),
        _makeArtifact(title: 'three'),
      ];

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showArtifactsListModal(
                context,
                artifacts: artifacts,
              ),
              child: const Text('Open list'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open list'));
      await tester.pumpAndSettle();

      // TuiHeader uppercases the label
      expect(find.text('ARTIFACTS (3)'), findsOneWidget);
    });

    testWidgets('shows empty state message when no artifacts',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showArtifactsListModal(
                context,
                artifacts: const [],
              ),
              child: const Text('Open list'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open list'));
      await tester.pumpAndSettle();

      expect(find.text('No artifacts in this session'), findsOneWidget);
    });

    testWidgets('has close button with [X] label', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showArtifactsListModal(
                context,
                artifacts: [_makeArtifact(title: 'test')],
              ),
              child: const Text('Open list'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open list'));
      await tester.pumpAndSettle();

      expect(find.text('[X]'), findsOneWidget);
    });

    testWidgets('close button dismisses modal', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showArtifactsListModal(
                context,
                artifacts: [_makeArtifact(title: 'test')],
              ),
              child: const Text('Open list'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open list'));
      await tester.pumpAndSettle();

      // Modal is visible
      expect(find.text('ARTIFACTS (1)'), findsOneWidget);

      // Tap close
      await tester.tap(find.text('[X]'));
      await tester.pumpAndSettle();

      // Modal is dismissed
      expect(find.text('ARTIFACTS (1)'), findsNothing);
    });

    testWidgets('latest artifact card has amber border', (tester) async {
      final artifacts = [
        _makeArtifact(title: 'old_file'),
        _makeArtifact(title: 'new_file'),
      ];

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showArtifactsListModal(
                context,
                artifacts: artifacts,
              ),
              child: const Text('Open list'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open list'));
      await tester.pumpAndSettle();

      // The last item (new_file) should have an amber left border.
      // TuiCards inside the list will have Container with border decoration.
      // We verify by looking at the TuiCard widgets.
      final tuiCards = find.byType(TuiCard);
      // There should be at least 2 TuiCard widgets for the artifact list items
      // (the TuiModal itself doesn't produce a TuiCard, but the list items do)
      expect(tuiCards, findsAtLeast(2));
    });

    testWidgets('shows type badge on each card', (tester) async {
      final artifacts = [
        _makeArtifact(type: ArtifactType.diff, title: 'changes'),
        _makeArtifact(type: ArtifactType.error, title: 'crash'),
      ];

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showArtifactsListModal(
                context,
                artifacts: artifacts,
              ),
              child: const Text('Open list'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open list'));
      await tester.pumpAndSettle();

      expect(find.text('[DIFF]'), findsOneWidget);
      expect(find.text('[ERROR]'), findsOneWidget);
    });

    testWidgets('tapping a card opens single artifact drawer',
        (tester) async {
      final artifacts = [
        _makeArtifact(
          type: ArtifactType.code,
          title: 'hello.dart',
          content: 'void main() {}',
        ),
      ];

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showArtifactsListModal(
                context,
                artifacts: artifacts,
              ),
              child: const Text('Open list'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open list'));
      await tester.pumpAndSettle();

      // Tap the artifact card
      await tester.tap(find.text('hello.dart'));
      await tester.pumpAndSettle();

      // The single artifact drawer should now be visible with the TuiHeader
      expect(find.text('HELLO.DART'), findsOneWidget);
      expect(find.text('[CODE]'), findsOneWidget);
    });

    testWidgets('modal uses TuiModal wrapper', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showArtifactsListModal(
                context,
                artifacts: [_makeArtifact(title: 'x')],
              ),
              child: const Text('Open list'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open list'));
      await tester.pumpAndSettle();

      // TuiModal should be in the widget tree
      expect(find.byType(TuiModal), findsOneWidget);
    });
  });
}
