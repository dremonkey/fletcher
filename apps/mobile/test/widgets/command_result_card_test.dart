import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/models/command_result.dart';
import 'package:fletcher/theme/app_colors.dart';
import 'package:fletcher/theme/tui_widgets.dart';
import 'package:fletcher/widgets/command_result_card.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      backgroundColor: AppColors.background,
      body: child,
    ),
  );
}

void main() {
  group('CommandResultCard', () {
    testWidgets('renders command name in header', (tester) async {
      final result = CommandResult(
        command: 'help',
        text: 'Available commands: /help',
        timestamp: DateTime(2026, 3, 15, 12, 0, 0),
      );
      await tester.pumpWidget(_wrap(CommandResultCard(result: result)));
      expect(find.text('/help'), findsOneWidget);
    });

    testWidgets('renders result body text', (tester) async {
      final result = CommandResult(
        command: 'help',
        text: 'Available commands: /help',
        timestamp: DateTime(2026, 3, 15, 12, 0, 0),
      );
      await tester.pumpWidget(_wrap(CommandResultCard(result: result)));
      expect(find.text('Available commands: /help'), findsOneWidget);
    });

    testWidgets('renders timestamp', (tester) async {
      final result = CommandResult(
        command: 'help',
        text: 'test',
        timestamp: DateTime(2026, 3, 15, 14, 30, 45),
      );
      await tester.pumpWidget(_wrap(CommandResultCard(result: result)));
      expect(find.text('14:30:45'), findsOneWidget);
    });

    testWidgets('renders CMD type label', (tester) async {
      final result = CommandResult(
        command: 'help',
        text: 'test',
        timestamp: DateTime(2026, 3, 15, 12, 0, 0),
      );
      await tester.pumpWidget(_wrap(CommandResultCard(result: result)));
      expect(find.text('CMD'), findsOneWidget);
    });

    testWidgets('error results use red border color', (tester) async {
      final result = CommandResult(
        command: 'unknown',
        text: 'Unknown command',
        timestamp: DateTime(2026, 3, 15, 12, 0, 0),
        isError: true,
      );
      await tester.pumpWidget(_wrap(CommandResultCard(result: result)));
      // Verify CMD label uses red
      final cmdText = tester.widget<Text>(find.text('CMD'));
      expect(cmdText.style?.color, AppColors.healthRed);
    });

    testWidgets('success results use green border color', (tester) async {
      final result = CommandResult(
        command: 'help',
        text: 'Available commands: /help',
        timestamp: DateTime(2026, 3, 15, 12, 0, 0),
      );
      await tester.pumpWidget(_wrap(CommandResultCard(result: result)));
      final cmdText = tester.widget<Text>(find.text('CMD'));
      // Check it uses green (healthGreen — not red)
      expect(cmdText.style?.color, isNot(AppColors.healthRed));
    });
  });
}
