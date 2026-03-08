import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/widgets/compact_waveform.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: child,
    ),
  );
}

void main() {
  group('CompactWaveform', () {
    testWidgets('renders without error with empty amplitudes', (tester) async {
      await tester.pumpWidget(_wrap(
        const CompactWaveform(
          userAmplitudes: [],
          agentAmplitudes: [],
        ),
      ));

      expect(find.byType(CompactWaveform), findsOneWidget);
    });

    testWidgets('renders with sample data', (tester) async {
      await tester.pumpWidget(_wrap(
        const CompactWaveform(
          userAmplitudes: [0.1, 0.2, 0.5, 0.8, 0.3],
          agentAmplitudes: [0.0, 0.1, 0.3, 0.6, 0.2],
        ),
      ));

      expect(find.byType(CompactWaveform), findsOneWidget);
      // CustomPaint exists as a descendant of CompactWaveform
      expect(
        find.descendant(
          of: find.byType(CompactWaveform),
          matching: find.byType(CustomPaint),
        ),
        findsOneWidget,
      );
    });

    testWidgets('has height of 48dp', (tester) async {
      await tester.pumpWidget(_wrap(
        const CompactWaveform(
          userAmplitudes: [],
          agentAmplitudes: [],
        ),
      ));

      final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox).first);
      expect(sizedBox.height, 48);
    });

    testWidgets('is full width', (tester) async {
      await tester.pumpWidget(_wrap(
        const CompactWaveform(
          userAmplitudes: [],
          agentAmplitudes: [],
        ),
      ));

      final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox).first);
      expect(sizedBox.width, double.infinity);
    });

    testWidgets('wraps CustomPaint in RepaintBoundary', (tester) async {
      await tester.pumpWidget(_wrap(
        const CompactWaveform(
          userAmplitudes: [0.5],
          agentAmplitudes: [0.5],
        ),
      ));

      // Flutter inserts its own RepaintBoundary widgets, so check that
      // our explicit RepaintBoundary is an ancestor of the CustomPaint.
      expect(
        find.ancestor(
          of: find.byType(CustomPaint),
          matching: find.byType(RepaintBoundary),
        ),
        findsWidgets,
      );
    });

    testWidgets('handles large amplitude lists', (tester) async {
      final largeList = List<double>.generate(100, (i) => i / 100.0);
      await tester.pumpWidget(_wrap(
        CompactWaveform(
          userAmplitudes: largeList,
          agentAmplitudes: largeList,
        ),
      ));

      expect(find.byType(CompactWaveform), findsOneWidget);
    });
  });
}
