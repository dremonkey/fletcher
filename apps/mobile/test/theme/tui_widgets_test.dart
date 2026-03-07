import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/theme/app_colors.dart';
import 'package:fletcher/theme/tui_widgets.dart';

/// Wraps a widget in a MaterialApp for testing.
Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: child,
    ),
  );
}

void main() {
  group('TuiHeader', () {
    testWidgets('renders label text in uppercase', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiHeader(label: 'test'),
      ));

      expect(find.text('TEST'), findsOneWidget);
    });

    testWidgets('renders box-drawing characters', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiHeader(label: 'demo'),
      ));

      // Opening: ┌─ (U+250C U+2500 space)
      expect(find.text('\u250C\u2500 '), findsOneWidget);
      // Closing: space ─┐ (space U+2500 U+2510)
      expect(find.text(' \u2500\u2510'), findsOneWidget);
    });

    testWidgets('uses custom color', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiHeader(label: 'colored', color: AppColors.cyan),
      ));

      final labelFinder = find.text('COLORED');
      expect(labelFinder, findsOneWidget);

      final Text labelWidget = tester.widget(labelFinder);
      expect(labelWidget.style?.color, equals(AppColors.cyan));
    });
  });

  group('TuiCard', () {
    testWidgets('has sharp corners (BorderRadius.zero)', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiCard(child: Text('content')),
      ));

      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.borderRadius, BorderRadius.zero);
    });

    testWidgets('has surface background color', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiCard(child: Text('content')),
      ));

      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, AppColors.surface);
    });

    testWidgets('renders left border when borderColor is set', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiCard(
          borderColor: AppColors.amber,
          child: Text('content'),
        ),
      ));

      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      final border = decoration.border as Border;
      expect(border.left.color, AppColors.amber);
      expect(border.left.width, 2.0);
    });

    testWidgets('renders child content', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiCard(child: Text('hello card')),
      ));

      expect(find.text('hello card'), findsOneWidget);
    });
  });

  group('TuiButton', () {
    testWidgets('has minimum 48dp height', (tester) async {
      await tester.pumpWidget(_wrap(
        TuiButton(label: 'press', onPressed: () {}),
      ));

      final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox).first);
      expect(sizedBox.height, greaterThanOrEqualTo(48));
    });

    testWidgets('renders label in uppercase', (tester) async {
      await tester.pumpWidget(_wrap(
        TuiButton(label: 'click', onPressed: () {}),
      ));

      expect(find.text('CLICK'), findsOneWidget);
    });

    testWidgets('triggers onPressed callback', (tester) async {
      var pressed = false;
      await tester.pumpWidget(_wrap(
        TuiButton(label: 'tap', onPressed: () => pressed = true),
      ));

      await tester.tap(find.byType(TuiButton));
      expect(pressed, isTrue);
    });

    testWidgets('has sharp corners', (tester) async {
      await tester.pumpWidget(_wrap(
        TuiButton(label: 'sharp', onPressed: () {}),
      ));

      final button = tester.widget<OutlinedButton>(
        find.byType(OutlinedButton),
      );
      final shape = button.style?.shape?.resolve({});
      expect(shape, isA<RoundedRectangleBorder>());
      expect(
        (shape as RoundedRectangleBorder).borderRadius,
        BorderRadius.zero,
      );
    });
  });

  group('TuiModal', () {
    testWidgets('has amber border by default', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiModal(
          title: 'modal',
          child: Text('modal content'),
        ),
      ));

      // Find the outermost Container (TuiModal's root)
      final containers = find.byType(Container);
      // The first Container is from TuiModal
      final container = tester.widget<Container>(containers.first);
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.border, isNotNull);
      final border = decoration.border as Border;
      expect(border.top.color, AppColors.amber);
      expect(border.bottom.color, AppColors.amber);
      expect(border.left.color, AppColors.amber);
      expect(border.right.color, AppColors.amber);
    });

    testWidgets('has sharp corners', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiModal(
          title: 'test',
          child: Text('content'),
        ),
      ));

      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.borderRadius, BorderRadius.zero);
    });

    testWidgets('renders title via TuiHeader', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiModal(
          title: 'info',
          child: Text('body'),
        ),
      ));

      // TuiHeader uppercases the label
      expect(find.text('INFO'), findsOneWidget);
    });

    testWidgets('has dark background', (tester) async {
      await tester.pumpWidget(_wrap(
        const TuiModal(
          title: 'dark',
          child: Text('bg test'),
        ),
      ));

      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, AppColors.background);
    });
  });
}
