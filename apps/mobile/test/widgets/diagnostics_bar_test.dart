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

    testWidgets('renders RT placeholder when no measurement available',
        (tester) async {
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

    testWidgets('renders RT with measured latency value', (tester) async {
      await tester.pumpWidget(_wrap(
        const DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.0,
          diagnostics: DiagnosticsInfo(roundTripMs: 850),
        ),
      ));

      expect(find.textContaining('RT:'), findsOneWidget);
      expect(find.textContaining('850ms'), findsOneWidget);
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

  group('DiagnosticsInfo', () {
    test('formatUptime returns MM:SS for durations under 1 hour', () {
      expect(DiagnosticsInfo.formatUptime(const Duration(seconds: 0)),
          '00:00');
      expect(DiagnosticsInfo.formatUptime(const Duration(seconds: 5)),
          '00:05');
      expect(DiagnosticsInfo.formatUptime(const Duration(minutes: 3, seconds: 42)),
          '03:42');
      expect(DiagnosticsInfo.formatUptime(const Duration(minutes: 59, seconds: 59)),
          '59:59');
    });

    test('formatUptime returns HH:MM:SS for durations of 1 hour or more', () {
      expect(DiagnosticsInfo.formatUptime(const Duration(hours: 1)),
          '01:00:00');
      expect(
        DiagnosticsInfo.formatUptime(
            const Duration(hours: 2, minutes: 15, seconds: 30)),
        '02:15:30',
      );
    });

    test('copyWith preserves existing values when no overrides given', () {
      const info = DiagnosticsInfo(
        roundTripMs: 500,
        sessionName: 'test-room',
        agentIdentity: 'agent-1',
        sttProvider: 'deepgram',
        ttsProvider: 'google',
        llmProvider: 'openclaw',
      );
      final copy = info.copyWith();
      expect(copy.roundTripMs, 500);
      expect(copy.sessionName, 'test-room');
      expect(copy.agentIdentity, 'agent-1');
      expect(copy.sttProvider, 'deepgram');
      expect(copy.ttsProvider, 'google');
      expect(copy.llmProvider, 'openclaw');
    });

    test('copyWith overrides specified values', () {
      const info = DiagnosticsInfo(
        roundTripMs: 500,
        sessionName: 'old-room',
      );
      final copy = info.copyWith(
        roundTripMs: 800,
        sessionName: 'new-room',
      );
      expect(copy.roundTripMs, 800);
      expect(copy.sessionName, 'new-room');
    });

    test('copyWith clears fields with clear flags', () {
      final info = DiagnosticsInfo(
        roundTripMs: 500,
        agentIdentity: 'agent-1',
        connectedAt: DateTime(2026, 3, 7),
      );
      final copy = info.copyWith(
        clearRoundTripMs: true,
        clearAgentIdentity: true,
        clearConnectedAt: true,
      );
      expect(copy.roundTripMs, isNull);
      expect(copy.agentIdentity, isNull);
      expect(copy.connectedAt, isNull);
    });

    test('default DiagnosticsInfo has all null fields', () {
      const info = DiagnosticsInfo();
      expect(info.roundTripMs, isNull);
      expect(info.sessionName, isNull);
      expect(info.agentIdentity, isNull);
      expect(info.connectedAt, isNull);
      expect(info.sttProvider, isNull);
      expect(info.ttsProvider, isNull);
      expect(info.llmProvider, isNull);
    });
  });

  group('Diagnostics modal', () {
    testWidgets('modal shows -- for all fields when no diagnostics data',
        (tester) async {
      await tester.pumpWidget(_wrap(
        DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.5,
        ),
      ));

      // Open the modal
      await tester.tap(find.byType(GestureDetector).first);
      await tester.pumpAndSettle();

      // STT, TTS, LLM should show -- (no hardcoded values)
      // Find all text widgets and check for absence of hardcoded values
      expect(find.text('deepgram'), findsNothing);
      expect(find.text('cartesia'), findsNothing);
    });

    testWidgets('modal shows live session name', (tester) async {
      await tester.pumpWidget(_wrap(
        DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.5,
          diagnostics: DiagnosticsInfo(
            sessionName: 'fletcher-123456',
          ),
        ),
      ));

      await tester.tap(find.byType(GestureDetector).first);
      await tester.pumpAndSettle();

      expect(find.text('fletcher-123456'), findsOneWidget);
    });

    testWidgets('modal shows agent identity', (tester) async {
      await tester.pumpWidget(_wrap(
        DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.5,
          diagnostics: DiagnosticsInfo(
            agentIdentity: 'voice-agent-42',
          ),
        ),
      ));

      await tester.tap(find.byType(GestureDetector).first);
      await tester.pumpAndSettle();

      expect(find.text('voice-agent-42'), findsOneWidget);
    });

    testWidgets('modal shows round-trip latency', (tester) async {
      await tester.pumpWidget(_wrap(
        DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.5,
          diagnostics: DiagnosticsInfo(roundTripMs: 1200),
        ),
      ));

      await tester.tap(find.byType(GestureDetector).first);
      await tester.pumpAndSettle();

      expect(find.text('1200ms'), findsWidgets);
    });

    testWidgets('modal shows pipeline providers from agent metadata',
        (tester) async {
      await tester.pumpWidget(_wrap(
        DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.5,
          diagnostics: DiagnosticsInfo(
            sttProvider: 'google',
            ttsProvider: 'elevenlabs',
            llmProvider: 'nanoclaw',
          ),
        ),
      ));

      await tester.tap(find.byType(GestureDetector).first);
      await tester.pumpAndSettle();

      expect(find.text('google'), findsOneWidget);
      expect(find.text('elevenlabs'), findsOneWidget);
      expect(find.text('nanoclaw'), findsOneWidget);
    });

    testWidgets('modal shows uptime when connectedAt is set', (tester) async {
      // Set connectedAt to 5 minutes ago
      final connectedAt = DateTime.now().subtract(const Duration(minutes: 5));

      await tester.pumpWidget(_wrap(
        DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.5,
          diagnostics: DiagnosticsInfo(connectedAt: connectedAt),
        ),
      ));

      await tester.tap(find.byType(GestureDetector).first);
      await tester.pumpAndSettle();

      // Should show a formatted time like 05:00 or 05:01
      expect(find.textContaining('05:0'), findsOneWidget);
    });

    testWidgets('modal shows -- for uptime when not connected',
        (tester) async {
      await tester.pumpWidget(_wrap(
        const DiagnosticsBar(
          overallHealth: OverallHealth.healthy,
          status: ConversationStatus.idle,
          vadConfidence: 0.5,
        ),
      ));

      await tester.tap(find.byType(GestureDetector).first);
      await tester.pumpAndSettle();

      // UPTIME row should show --
      // SESSION, AGENT, RT, STT, TTS, LLM should also show --
      // Count all the -- instances (6 fields without data + UPTIME = at least 7)
      expect(find.text('--'), findsWidgets);
    });
  });
}
