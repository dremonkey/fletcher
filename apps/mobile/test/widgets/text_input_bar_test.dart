import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/conversation_state.dart';
import 'package:fletcher/theme/app_colors.dart';
import 'package:fletcher/widgets/mic_button.dart';
import 'package:fletcher/widgets/text_input_bar.dart';

// Minimal mock of LiveKitService for widget testing.
// We only need to control state and capture method calls.
// The real LiveKitService requires livekit_client which needs
// native platform channels, so we test the widget in isolation.

void main() {
  group('TextInputBar - layout and animation', () {
    // These tests verify the core static widget structure.
    // Full integration tests with LiveKitService would require
    // a mock/fake that implements ChangeNotifier, which is
    // beyond the scope of pure widget tests.

    testWidgets('MicButton supports onLongPress callback', (tester) async {
      var longPressed = false;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: MicButton(
              status: ConversationStatus.idle,
              aiAudioLevel: 0.0,
              isMuted: false,
              onToggleMute: () {},
              onLongPress: () => longPressed = true,
            ),
          ),
        ),
      ));

      // Long press on the mic button
      await tester.longPress(find.byType(MicButton));
      await tester.pump();

      expect(longPressed, isTrue);
    });

    testWidgets('MicButton tap still works with onLongPress set', (tester) async {
      var tapped = false;
      var longPressed = false;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: MicButton(
              status: ConversationStatus.idle,
              aiAudioLevel: 0.0,
              isMuted: false,
              onToggleMute: () => tapped = true,
              onLongPress: () => longPressed = true,
            ),
          ),
        ),
      ));

      await tester.tap(find.byType(MicButton));
      await tester.pump();

      expect(tapped, isTrue);
      expect(longPressed, isFalse);
    });

    testWidgets('MicButton works without onLongPress (backward compat)',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: MicButton(
              status: ConversationStatus.idle,
              aiAudioLevel: 0.0,
              isMuted: false,
              onToggleMute: () {},
              // No onLongPress provided
            ),
          ),
        ),
      ));

      // Should not throw on long press
      await tester.longPress(find.byType(MicButton));
      await tester.pump();
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
