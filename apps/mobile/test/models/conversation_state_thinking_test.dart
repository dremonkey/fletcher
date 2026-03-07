import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/conversation_state.dart';

void main() {
  group('ConversationState.isAgentThinking', () {
    test('defaults to false', () {
      const state = ConversationState();
      expect(state.isAgentThinking, isFalse);
    });

    test('can be set to true via constructor', () {
      const state = ConversationState(isAgentThinking: true);
      expect(state.isAgentThinking, isTrue);
    });

    test('copyWith(isAgentThinking: true) sets it to true', () {
      const state = ConversationState();
      final updated = state.copyWith(isAgentThinking: true);
      expect(updated.isAgentThinking, isTrue);
    });

    test('copyWith(isAgentThinking: false) sets it to false', () {
      const state = ConversationState(isAgentThinking: true);
      final updated = state.copyWith(isAgentThinking: false);
      expect(updated.isAgentThinking, isFalse);
    });

    test('copyWith without isAgentThinking preserves current value', () {
      const state = ConversationState(isAgentThinking: true);
      final updated = state.copyWith(status: ConversationStatus.idle);
      expect(updated.isAgentThinking, isTrue);
    });

    test('copyWith preserves other fields when setting isAgentThinking', () {
      const state = ConversationState(
        status: ConversationStatus.processing,
        userAudioLevel: 0.5,
      );
      final updated = state.copyWith(isAgentThinking: true);
      expect(updated.status, ConversationStatus.processing);
      expect(updated.userAudioLevel, 0.5);
      expect(updated.isAgentThinking, isTrue);
    });
  });
}
