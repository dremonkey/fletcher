import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/conversation_state.dart';
import 'package:fletcher/theme/app_colors.dart';
import 'package:fletcher/widgets/artifact_viewer.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      backgroundColor: AppColors.background,
      body: child,
    ),
  );
}

/// Helper to create a test artifact.
ArtifactEvent _makeArtifact({
  ArtifactType type = ArtifactType.code,
  String? title,
  String? content,
  String? file,
  String? diff,
  String? message,
  String? stack,
}) {
  return ArtifactEvent(
    artifactType: type,
    title: title,
    content: content,
    file: file,
    diff: diff,
    message: message,
    stack: stack,
  );
}

void main() {
  group('ArtifactInlineButton', () {
    testWidgets('renders artifact name in button label', (tester) async {
      final artifact = _makeArtifact(title: 'main.dart');
      await tester.pumpWidget(_wrap(
        ArtifactInlineButton(
          artifact: artifact,
          onTap: () {},
        ),
      ));

      expect(find.text('[ARTIFACT: main.dart]'), findsOneWidget);
    });

    testWidgets('has amber border', (tester) async {
      final artifact = _makeArtifact(title: 'test');
      await tester.pumpWidget(_wrap(
        ArtifactInlineButton(
          artifact: artifact,
          onTap: () {},
        ),
      ));

      // Find the Container inside ArtifactInlineButton
      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(ArtifactInlineButton),
          matching: find.byType(Container),
        ),
      );
      final decoration = container.decoration as BoxDecoration;
      final border = decoration.border as Border;
      expect(border.top.color, AppColors.amber);
    });

    testWidgets('has minimum 48dp height constraint', (tester) async {
      final artifact = _makeArtifact(title: 'test');
      await tester.pumpWidget(_wrap(
        ArtifactInlineButton(
          artifact: artifact,
          onTap: () {},
        ),
      ));

      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(ArtifactInlineButton),
          matching: find.byType(Container),
        ),
      );
      expect(container.constraints?.minHeight, 48);
    });

    testWidgets('has sharp corners (BorderRadius.zero)', (tester) async {
      final artifact = _makeArtifact(title: 'test');
      await tester.pumpWidget(_wrap(
        ArtifactInlineButton(
          artifact: artifact,
          onTap: () {},
        ),
      ));

      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(ArtifactInlineButton),
          matching: find.byType(Container),
        ),
      );
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.borderRadius, BorderRadius.zero);
    });

    testWidgets('calls onTap when tapped', (tester) async {
      var tapped = false;
      final artifact = _makeArtifact(title: 'clickable');
      await tester.pumpWidget(_wrap(
        ArtifactInlineButton(
          artifact: artifact,
          onTap: () => tapped = true,
        ),
      ));

      await tester.tap(find.byType(ArtifactInlineButton));
      expect(tapped, isTrue);
    });

    testWidgets('truncates long titles', (tester) async {
      final artifact =
          _makeArtifact(title: 'this_is_a_very_long_artifact_name_that_needs_truncation');
      await tester.pumpWidget(_wrap(
        ArtifactInlineButton(
          artifact: artifact,
          onTap: () {},
        ),
      ));

      // Should be truncated to 24 chars max (21 + "...")
      expect(find.textContaining('...'), findsOneWidget);
    });
  });

  group('Single artifact drawer', () {
    testWidgets('showSingleArtifactDrawer renders drawer with TuiHeader',
        (tester) async {
      final artifact = _makeArtifact(
        type: ArtifactType.code,
        title: 'app.dart',
        content: 'void main() {}',
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  showSingleArtifactDrawer(context, artifact: artifact),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      // TuiHeader uppercases the label
      expect(find.text('APP.DART'), findsOneWidget);
    });

    testWidgets('drawer shows type badge', (tester) async {
      final artifact = _makeArtifact(
        type: ArtifactType.code,
        title: 'test',
        content: 'print("hello")',
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  showSingleArtifactDrawer(context, artifact: artifact),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('[CODE]'), findsOneWidget);
    });

    testWidgets('drawer has amber top border', (tester) async {
      final artifact = _makeArtifact(
        type: ArtifactType.code,
        title: 'test',
        content: 'hello',
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  showSingleArtifactDrawer(context, artifact: artifact),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      // Find the drawer's outermost Container (surface background)
      final containers = find.byType(Container);
      // Look for the one with amber top border
      bool foundAmberBorder = false;
      for (final element in containers.evaluate()) {
        final widget = element.widget as Container;
        final decoration = widget.decoration;
        if (decoration is BoxDecoration && decoration.border is Border) {
          final border = decoration.border as Border;
          if (border.top.color == AppColors.amber &&
              border.top.width == 2) {
            foundAmberBorder = true;
            break;
          }
        }
      }
      expect(foundAmberBorder, isTrue,
          reason: 'Drawer should have a 2dp amber top border');
    });

    testWidgets('drawer has sharp corners', (tester) async {
      final artifact = _makeArtifact(
        type: ArtifactType.code,
        title: 'test',
        content: 'hello',
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  showSingleArtifactDrawer(context, artifact: artifact),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      // Verify no rounded corners in any Container decoration
      final containers = find.byType(Container);
      for (final element in containers.evaluate()) {
        final widget = element.widget as Container;
        final decoration = widget.decoration;
        if (decoration is BoxDecoration) {
          expect(
            decoration.borderRadius == null ||
                decoration.borderRadius == BorderRadius.zero,
            isTrue,
            reason: 'All borders should have sharp corners',
          );
        }
      }
    });

    testWidgets('diff badge shows DIFF', (tester) async {
      final artifact = _makeArtifact(
        type: ArtifactType.diff,
        title: 'changes',
        diff: '+added\n-removed',
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  showSingleArtifactDrawer(context, artifact: artifact),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('[DIFF]'), findsOneWidget);
    });

    testWidgets('error badge shows ERROR', (tester) async {
      final artifact = _makeArtifact(
        type: ArtifactType.error,
        title: 'oops',
        message: 'Something failed',
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  showSingleArtifactDrawer(context, artifact: artifact),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('[ERROR]'), findsOneWidget);
    });

    testWidgets('search badge shows SEARCH', (tester) async {
      final artifact = _makeArtifact(
        type: ArtifactType.searchResults,
        title: 'results',
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  showSingleArtifactDrawer(context, artifact: artifact),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('[SEARCH]'), findsOneWidget);
    });
  });

  group('Diff viewer styling', () {
    testWidgets('added lines use healthGreen', (tester) async {
      final artifact = _makeArtifact(
        type: ArtifactType.diff,
        title: 'test.dart',
        diff: '+added line',
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  showSingleArtifactDrawer(context, artifact: artifact),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      final text = tester.widget<Text>(find.text('+added line'));
      expect(text.style?.color, AppColors.healthGreen);
    });

    testWidgets('removed lines use healthRed', (tester) async {
      final artifact = _makeArtifact(
        type: ArtifactType.diff,
        title: 'test.dart',
        diff: '-removed line',
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  showSingleArtifactDrawer(context, artifact: artifact),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      final text = tester.widget<Text>(find.text('-removed line'));
      expect(text.style?.color, AppColors.healthRed);
    });
  });

  group('Error viewer styling', () {
    testWidgets('error message uses healthRed', (tester) async {
      final artifact = _makeArtifact(
        type: ArtifactType.error,
        title: 'error',
        message: 'File not found',
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  showSingleArtifactDrawer(context, artifact: artifact),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      final text = tester.widget<Text>(find.text('File not found'));
      expect(text.style?.color, AppColors.healthRed);
    });

    testWidgets('stack trace uses textSecondary', (tester) async {
      final artifact = _makeArtifact(
        type: ArtifactType.error,
        title: 'error',
        message: 'Crash',
        stack: 'at line 42\nat line 99',
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  showSingleArtifactDrawer(context, artifact: artifact),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      // Stack trace label
      expect(find.text('STACK TRACE'), findsOneWidget);
      // Stack trace content
      final stackText =
          tester.widget<Text>(find.text('at line 42\nat line 99'));
      expect(stackText.style?.color, AppColors.textSecondary);
    });
  });
}
