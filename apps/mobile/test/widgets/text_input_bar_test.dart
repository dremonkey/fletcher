import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/conversation_state.dart';
import 'package:fletcher/widgets/mic_button.dart';

void main() {
  group('MicButton', () {
    testWidgets('tap calls onToggleMute', (tester) async {
      var tapped = false;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: MicButton(
              status: ConversationStatus.idle,
              aiAudioLevel: 0.0,
              isMuted: false,
              onToggleMute: () => tapped = true,
            ),
          ),
        ),
      ));

      await tester.tap(find.byType(MicButton));
      await tester.pump();

      expect(tapped, isTrue);
    });

    testWidgets('renders mic icon when not muted', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: MicButton(
              status: ConversationStatus.idle,
              aiAudioLevel: 0.0,
              isMuted: false,
              onToggleMute: () {},
            ),
          ),
        ),
      ));

      expect(find.byIcon(Icons.mic_rounded), findsOneWidget);
    });

    testWidgets('renders mic_off icon when muted', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: MicButton(
              status: ConversationStatus.idle,
              aiAudioLevel: 0.0,
              isMuted: true,
              onToggleMute: () {},
            ),
          ),
        ),
      ));

      expect(find.byIcon(Icons.mic_off_rounded), findsOneWidget);
    });
  });

  group('TranscriptEntry origin display', () {
    test('voice origin entry has voice origin', () {
      final entry = TranscriptEntry(
        id: 'v1',
        role: TranscriptRole.user,
        text: 'spoken text',
        isFinal: true,
        timestamp: DateTime.now(),
        origin: MessageOrigin.voice,
      );
      expect(entry.origin, MessageOrigin.voice);
    });

    test('text origin entry has text origin', () {
      final entry = TranscriptEntry(
        id: 't1',
        role: TranscriptRole.user,
        text: 'typed text',
        isFinal: true,
        timestamp: DateTime.now(),
        origin: MessageOrigin.text,
      );
      expect(entry.origin, MessageOrigin.text);
    });
  });
}
