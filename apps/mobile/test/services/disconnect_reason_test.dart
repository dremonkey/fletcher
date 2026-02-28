import 'package:flutter_test/flutter_test.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:fletcher/services/disconnect_reason.dart';

void main() {
  group('shouldReconnect', () {
    test('returns true for transient failures', () {
      expect(shouldReconnect(DisconnectReason.unknown), isTrue);
      expect(shouldReconnect(DisconnectReason.disconnected), isTrue);
      expect(
          shouldReconnect(DisconnectReason.signalingConnectionFailure), isTrue);
      expect(
          shouldReconnect(DisconnectReason.reconnectAttemptsExceeded), isTrue);
    });

    test('returns false for non-reconnectable reasons', () {
      expect(shouldReconnect(DisconnectReason.clientInitiated), isFalse);
      expect(shouldReconnect(DisconnectReason.duplicateIdentity), isFalse);
      expect(shouldReconnect(DisconnectReason.participantRemoved), isFalse);
      expect(shouldReconnect(DisconnectReason.roomDeleted), isFalse);
      expect(shouldReconnect(DisconnectReason.serverShutdown), isFalse);
      expect(shouldReconnect(DisconnectReason.joinFailure), isFalse);
      expect(shouldReconnect(DisconnectReason.stateMismatch), isFalse);
    });
  });

  group('disconnectMessage', () {
    test('returns user-friendly messages for each reason', () {
      expect(disconnectMessage(DisconnectReason.clientInitiated),
          'Disconnected');
      expect(disconnectMessage(DisconnectReason.duplicateIdentity),
          'Another session took over this connection');
      expect(disconnectMessage(DisconnectReason.participantRemoved),
          'Removed from room');
      expect(disconnectMessage(DisconnectReason.roomDeleted),
          'Room no longer exists');
      expect(
          disconnectMessage(DisconnectReason.serverShutdown), 'Server shut down');
      expect(
          disconnectMessage(DisconnectReason.joinFailure), 'Failed to join room');
      expect(disconnectMessage(DisconnectReason.stateMismatch),
          'Connection state error');
    });

    test('returns generic message for reconnectable reasons', () {
      expect(disconnectMessage(DisconnectReason.unknown), 'Connection lost');
      expect(disconnectMessage(DisconnectReason.disconnected), 'Connection lost');
      expect(disconnectMessage(DisconnectReason.signalingConnectionFailure),
          'Connection lost');
      expect(disconnectMessage(DisconnectReason.reconnectAttemptsExceeded),
          'Connection lost');
    });
  });

  group('reconnectable/non-reconnectable are exhaustive', () {
    test('every DisconnectReason is classified', () {
      for (final reason in DisconnectReason.values) {
        // Should not throw — every reason produces a message
        expect(disconnectMessage(reason), isA<String>());
        // Should return a definite bool
        expect(shouldReconnect(reason), isA<bool>());
      }
    });
  });
}
