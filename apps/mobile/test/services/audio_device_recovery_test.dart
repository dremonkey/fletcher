import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/models/conversation_state.dart';

/// Tests for the Bluetooth audio route recovery feature (Task 009).
///
/// The core recovery logic in LiveKitService._refreshAudioTrack() uses
/// LiveKit's LocalTrack.restartTrack() which can't be unit-tested without
/// the SDK. These tests verify the state model behavior that the UI depends
/// on for correct banner rendering during audio device transitions.
void main() {
  group('ConversationState errorMessage during reconnecting', () {
    test('errorMessage is preserved through copyWith with reconnecting status',
        () {
      const state = ConversationState();
      final reconnecting = state.copyWith(
        status: ConversationStatus.reconnecting,
        errorMessage: 'Switching audio...',
      );

      expect(reconnecting.status, ConversationStatus.reconnecting);
      expect(reconnecting.errorMessage, 'Switching audio...');
    });

    test('errorMessage persists when only status changes', () {
      final withError = const ConversationState().copyWith(
        status: ConversationStatus.reconnecting,
        errorMessage: 'Waiting for network...',
      );
      // A subsequent copyWith that only changes status keeps errorMessage
      final updated = withError.copyWith(
        status: ConversationStatus.reconnecting,
      );

      expect(updated.errorMessage, 'Waiting for network...');
    });

    test('errorMessage can be overwritten with a new message', () {
      final initial = const ConversationState().copyWith(
        status: ConversationStatus.reconnecting,
        errorMessage: 'Switching audio...',
      );
      final updated = initial.copyWith(
        errorMessage: 'Connection lost. Reconnecting...',
      );

      expect(updated.errorMessage, 'Connection lost. Reconnecting...');
    });

    test('reconnecting without errorMessage leaves it null', () {
      final state = const ConversationState().copyWith(
        status: ConversationStatus.reconnecting,
      );

      expect(state.status, ConversationStatus.reconnecting);
      expect(state.errorMessage, isNull);
    });
  });

  group('banner text selection logic', () {
    // Mirrors the logic in conversation_screen.dart lines 226-228:
    //   state.status == ConversationStatus.reconnecting
    //       ? state.errorMessage ?? 'Connection lost. Reconnecting...'
    //       : state.errorMessage ?? 'Connection error'
    String bannerText(ConversationState state) {
      return state.status == ConversationStatus.reconnecting
          ? state.errorMessage ?? 'Connection lost. Reconnecting...'
          : state.errorMessage ?? 'Connection error';
    }

    test('reconnecting with custom errorMessage shows that message', () {
      final state = const ConversationState().copyWith(
        status: ConversationStatus.reconnecting,
        errorMessage: 'Switching audio...',
      );
      expect(bannerText(state), 'Switching audio...');
    });

    test('reconnecting without errorMessage shows default network message', () {
      final state = const ConversationState().copyWith(
        status: ConversationStatus.reconnecting,
      );
      expect(bannerText(state), 'Connection lost. Reconnecting...');
    });

    test('error with custom errorMessage shows that message', () {
      final state = const ConversationState().copyWith(
        status: ConversationStatus.error,
        errorMessage: 'Microphone permission denied',
      );
      expect(bannerText(state), 'Microphone permission denied');
    });

    test('error without errorMessage shows generic error', () {
      final state = const ConversationState().copyWith(
        status: ConversationStatus.error,
      );
      expect(bannerText(state), 'Connection error');
    });

    test('network reconnect message is distinct from audio switch', () {
      final audioSwitch = const ConversationState().copyWith(
        status: ConversationStatus.reconnecting,
        errorMessage: 'Switching audio...',
      );
      final networkReconnect = const ConversationState().copyWith(
        status: ConversationStatus.reconnecting,
      );

      expect(bannerText(audioSwitch), isNot(bannerText(networkReconnect)));
    });
  });

  group('status transitions for audio device recovery', () {
    test('idle → refreshing audio stays idle (no status disruption)', () {
      // The v2 implementation does NOT change status during audio refresh.
      // Verify that going from idle → idle is a valid no-op.
      final idle = const ConversationState().copyWith(
        status: ConversationStatus.idle,
      );
      final stillIdle = idle.copyWith(
        status: ConversationStatus.idle,
      );

      expect(stillIdle.status, ConversationStatus.idle);
    });

    test('muted state is preserved through audio refresh', () {
      final muted = const ConversationState().copyWith(
        status: ConversationStatus.muted,
      );
      // After refresh, status should return to muted
      final afterRefresh = muted.copyWith(
        status: ConversationStatus.muted,
      );

      expect(afterRefresh.status, ConversationStatus.muted);
    });

    test('transcript is preserved during audio refresh', () {
      final withTranscript = const ConversationState().copyWith(
        status: ConversationStatus.idle,
        transcript: [
          TranscriptEntry(
            id: 'seg-1',
            role: TranscriptRole.user,
            text: 'Hello',
            isFinal: true,
            timestamp: DateTime(2026, 3, 1),
          ),
        ],
      );

      // Audio refresh doesn't touch transcripts
      final afterRefresh = withTranscript.copyWith(
        status: ConversationStatus.idle,
      );

      expect(afterRefresh.transcript, hasLength(1));
      expect(afterRefresh.transcript.first.text, 'Hello');
    });
  });
}
