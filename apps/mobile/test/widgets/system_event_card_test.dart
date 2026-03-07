import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/system_event.dart';
import 'package:fletcher/theme/app_colors.dart';
import 'package:fletcher/theme/tui_widgets.dart';
import 'package:fletcher/widgets/system_event_card.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      backgroundColor: AppColors.background,
      body: child,
    ),
  );
}

SystemEvent _makeEvent({
  String id = 'test-event',
  SystemEventType type = SystemEventType.network,
  SystemEventStatus status = SystemEventStatus.success,
  String message = 'tailscale 100.1.2.3',
  String prefix = '\u25B8',
  DateTime? timestamp,
}) {
  return SystemEvent(
    id: id,
    type: type,
    status: status,
    message: message,
    timestamp: timestamp ?? DateTime(2026, 3, 7, 12, 0, 1),
    prefix: prefix,
  );
}

void main() {
  group('SystemEventCard', () {
    testWidgets('renders prefix symbol', (tester) async {
      final event = _makeEvent(prefix: '\u25B8');
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      expect(find.text('\u25B8'), findsOneWidget);
    });

    testWidgets('shows type label in cyan', (tester) async {
      final event = _makeEvent(type: SystemEventType.network);
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      expect(find.text('NETWORK'), findsOneWidget);

      final typeText = tester.widget<Text>(find.text('NETWORK'));
      expect(typeText.style?.color, AppColors.cyan);
    });

    testWidgets('shows ROOM type label', (tester) async {
      final event = _makeEvent(type: SystemEventType.room);
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      expect(find.text('ROOM'), findsOneWidget);
    });

    testWidgets('shows AGENT type label', (tester) async {
      final event = _makeEvent(type: SystemEventType.agent);
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      expect(find.text('AGENT'), findsOneWidget);
    });

    testWidgets('shows message text', (tester) async {
      final event = _makeEvent(message: 'tailscale 100.1.2.3');
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      expect(find.text('tailscale 100.1.2.3'), findsOneWidget);
    });

    testWidgets('shows timestamp', (tester) async {
      final event = _makeEvent(
        timestamp: DateTime(2026, 3, 7, 14, 30, 45),
      );
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      expect(find.text('14:30:45'), findsOneWidget);
    });

    testWidgets('pending status uses textSecondary color', (tester) async {
      final event = _makeEvent(
        status: SystemEventStatus.pending,
        message: 'resolving...',
      );
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      final messageText = tester.widget<Text>(find.text('resolving...'));
      expect(messageText.style?.color, AppColors.textSecondary);
    });

    testWidgets('success status uses healthGreen color', (tester) async {
      final event = _makeEvent(
        status: SystemEventStatus.success,
        message: 'tailscale 100.1.2.3',
      );
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      final messageText = tester.widget<Text>(
        find.text('tailscale 100.1.2.3'),
      );
      expect(messageText.style?.color, AppColors.healthGreen);
    });

    testWidgets('error status uses healthRed color', (tester) async {
      final event = _makeEvent(
        status: SystemEventStatus.error,
        message: 'disconnected',
      );
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      final messageText = tester.widget<Text>(find.text('disconnected'));
      expect(messageText.style?.color, AppColors.healthRed);
    });

    testWidgets('has cyan left border', (tester) async {
      final event = _makeEvent();
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      // TuiCard wraps in a Container with BoxDecoration
      final container = tester.widget<Container>(
        find.byType(Container).first,
      );
      final decoration = container.decoration as BoxDecoration;
      final border = decoration.border as Border;
      expect(border.left.color, AppColors.cyan);
    });

    testWidgets('AnimatedSwitcher present for message transitions',
        (tester) async {
      final event = _makeEvent();
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      expect(find.byType(AnimatedSwitcher), findsOneWidget);
    });

    testWidgets('no TuiHeader rendered', (tester) async {
      final event = _makeEvent();
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      expect(find.byType(TuiHeader), findsNothing);
    });

    testWidgets('card is not tappable (no GestureDetector/InkWell)',
        (tester) async {
      final event = _makeEvent();
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      // SystemEventCard should not have GestureDetector or InkWell
      // as direct children for tappability.
      // We check there are no InkWell descendants inside the SystemEventCard.
      final cardFinder = find.byType(SystemEventCard);
      expect(
        find.descendant(of: cardFinder, matching: find.byType(InkWell)),
        findsNothing,
      );
      expect(
        find.descendant(
          of: cardFinder,
          matching: find.byType(GestureDetector),
        ),
        findsNothing,
      );
    });

    testWidgets('prefix symbol uses message color for pending', (tester) async {
      final event = _makeEvent(
        status: SystemEventStatus.pending,
        prefix: '\u25B8',
      );
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      final prefixText = tester.widget<Text>(find.text('\u25B8'));
      expect(prefixText.style?.color, AppColors.textSecondary);
    });

    testWidgets('prefix symbol uses message color for error', (tester) async {
      final event = _makeEvent(
        status: SystemEventStatus.error,
        prefix: '\u2715',
      );
      await tester.pumpWidget(_wrap(SystemEventCard(event: event)));

      final prefixText = tester.widget<Text>(find.text('\u2715'));
      expect(prefixText.style?.color, AppColors.healthRed);
    });
  });
}
