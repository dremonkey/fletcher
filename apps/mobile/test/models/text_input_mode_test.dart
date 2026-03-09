import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/conversation_state.dart';

void main() {
  group('TextInputMode', () {
    test('ConversationState defaults to voiceFirst', () {
      const state = ConversationState();
      expect(state.inputMode, TextInputMode.voiceFirst);
    });

    test('copyWith(inputMode: textInput) switches to text input', () {
      const state = ConversationState();
      final updated = state.copyWith(inputMode: TextInputMode.textInput);
      expect(updated.inputMode, TextInputMode.textInput);
    });

    test('copyWith(inputMode: voiceFirst) switches back to voice', () {
      const state =
          ConversationState(inputMode: TextInputMode.textInput);
      final updated = state.copyWith(inputMode: TextInputMode.voiceFirst);
      expect(updated.inputMode, TextInputMode.voiceFirst);
    });

    test('copyWith without inputMode preserves current value', () {
      const state =
          ConversationState(inputMode: TextInputMode.textInput);
      final updated = state.copyWith(status: ConversationStatus.idle);
      expect(updated.inputMode, TextInputMode.textInput);
    });

    test('copyWith preserves other fields when setting inputMode', () {
      const state = ConversationState(
        status: ConversationStatus.processing,
        userAudioLevel: 0.5,
        isAgentThinking: true,
      );
      final updated = state.copyWith(inputMode: TextInputMode.textInput);
      expect(updated.status, ConversationStatus.processing);
      expect(updated.userAudioLevel, 0.5);
      expect(updated.isAgentThinking, isTrue);
      expect(updated.inputMode, TextInputMode.textInput);
    });
  });

  group('TranscriptEntry.origin', () {
    test('defaults to voice', () {
      final entry = TranscriptEntry(
        id: 'test-1',
        role: TranscriptRole.user,
        text: 'hello',
        timestamp: DateTime.now(),
      );
      expect(entry.origin, MessageOrigin.voice);
    });

    test('can be set to text', () {
      final entry = TranscriptEntry(
        id: 'test-2',
        role: TranscriptRole.user,
        text: 'typed message',
        timestamp: DateTime.now(),
        origin: MessageOrigin.text,
      );
      expect(entry.origin, MessageOrigin.text);
    });

    test('copyWith preserves origin by default', () {
      final entry = TranscriptEntry(
        id: 'test-3',
        role: TranscriptRole.user,
        text: 'original',
        timestamp: DateTime.now(),
        origin: MessageOrigin.text,
      );
      final updated = entry.copyWith(text: 'updated');
      expect(updated.origin, MessageOrigin.text);
    });

    test('copyWith can change origin', () {
      final entry = TranscriptEntry(
        id: 'test-4',
        role: TranscriptRole.user,
        text: 'msg',
        timestamp: DateTime.now(),
        origin: MessageOrigin.voice,
      );
      final updated = entry.copyWith(origin: MessageOrigin.text);
      expect(updated.origin, MessageOrigin.text);
    });
  });

  group('MessageOrigin enum', () {
    test('has voice and text values', () {
      expect(MessageOrigin.values, contains(MessageOrigin.voice));
      expect(MessageOrigin.values, contains(MessageOrigin.text));
      expect(MessageOrigin.values.length, 2);
    });
  });

  group('TextInputMode enum', () {
    test('has voiceFirst and textInput values', () {
      expect(TextInputMode.values, contains(TextInputMode.voiceFirst));
      expect(TextInputMode.values, contains(TextInputMode.textInput));
      expect(TextInputMode.values.length, 2);
    });
  });
}
