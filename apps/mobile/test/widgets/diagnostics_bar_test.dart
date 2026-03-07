import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/conversation_state.dart';
import 'package:fletcher/models/health_state.dart';
import 'package:fletcher/theme/app_colors.dart';
import 'package:fletcher/widgets/diagnostics_bar.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: child,
    ),
  );
}

void main() {
  group('DiagnosticsBar', () {
    testWidgets('renders SYS: OK when healthy and idle', (tester) async {
      await tester.pumpWidget(_wrap(
        const DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.82,
        ),
      ));

      expect(find.textContaining('SYS:'), findsOneWidget);
      expect(find.textContaining('OK'), findsOneWidget);
    });

    testWidgets('renders VAD confidence with 2 decimal places', (tester) async {
      await tester.pumpWidget(_wrap(
        const DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.5,
        ),
      ));

      expect(find.textContaining('0.50'), findsOneWidget);
    });

    testWidgets('renders RT placeholder', (tester) async {
      await tester.pumpWidget(_wrap(
        const DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.0,
        ),
      ));

      expect(find.textContaining('RT:'), findsOneWidget);
      expect(find.textContaining('--'), findsOneWidget);
    });

    testWidgets('has minimum height of 48dp', (tester) async {
      await tester.pumpWidget(_wrap(
        const DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.0,
        ),
      ));

      final container = tester.widget<Container>(find.byType(Container).first);
      expect(container.constraints?.minHeight, greaterThanOrEqualTo(48));
    });

    testWidgets('health orb is green when healthy', (tester) async {
      await tester.pumpWidget(_wrap(
        const DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.0,
        ),
      ));

      // Find the 12x12 orb container inside RepaintBoundary
      final containers = find.byType(Container);
      bool foundGreenOrb = false;
      for (final element in containers.evaluate()) {
        final widget = element.widget as Container;
        final decoration = widget.decoration;
        if (decoration is BoxDecoration &&
            decoration.color == AppColors.healthGreen) {
          foundGreenOrb = true;
          break;
        }
      }
      expect(foundGreenOrb, isTrue);
    });

    testWidgets('health orb is red when unhealthy', (tester) async {
      await tester.pumpWidget(_wrap(
        const DiagnosticsBar(
          overallHealth: OverallHealth.unhealthy,
          status: ConversationStatus.error,
          vadConfidence: 0.0,
        ),
      ));

      final containers = find.byType(Container);
      bool foundRedOrb = false;
      for (final element in containers.evaluate()) {
        final widget = element.widget as Container;
        final decoration = widget.decoration;
        if (decoration is BoxDecoration &&
            decoration.color == AppColors.healthRed) {
          foundRedOrb = true;
          break;
        }
      }
      expect(foundRedOrb, isTrue);
    });

    testWidgets('shows trailing widget when provided', (tester) async {
      await tester.pumpWidget(_wrap(
        const DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.0,
          trailing: Text('ARTIFACTS: 2'),
        ),
      ));

      expect(find.text('ARTIFACTS: 2'), findsOneWidget);
    });

    testWidgets('shows SYS: ERROR when status is error', (tester) async {
      await tester.pumpWidget(_wrap(
        const DiagnosticsBar(
          overallHealth: OverallHealth.unhealthy,
          status: ConversationStatus.error,
          vadConfidence: 0.0,
        ),
      ));

      expect(find.textContaining('ERROR'), findsOneWidget);
    });

    testWidgets('shows SYS: RECONNECTING when reconnecting', (tester) async {
      await tester.pumpWidget(_wrap(
        const DiagnosticsBar(
          overallHealth: OverallHealth.degraded,
          status: ConversationStatus.reconnecting,
          vadConfidence: 0.0,
        ),
      ));

      expect(find.textContaining('RECONNECTING'), findsOneWidget);
    });

    testWidgets('tapping left side opens diagnostics modal', (tester) async {
      var tapped = false;
      await tester.pumpWidget(_wrap(
        DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.5,
          onTapDiagnostics: () => tapped = true,
        ),
      ));

      // Tap on the GestureDetector area (left side)
      await tester.tap(find.byType(GestureDetector).first);
      await tester.pump();

      expect(tapped, isTrue);
    });
  });
}
