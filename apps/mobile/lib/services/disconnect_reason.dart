import 'package:livekit_client/livekit_client.dart';

/// Reasons that warrant automatic reconnection (transient failures).
const reconnectableReasons = {
  DisconnectReason.unknown,
  DisconnectReason.disconnected,
  DisconnectReason.signalingConnectionFailure,
  DisconnectReason.reconnectAttemptsExceeded,
};

/// Whether a disconnect reason should trigger auto-reconnection.
bool shouldReconnect(DisconnectReason reason) =>
    reconnectableReasons.contains(reason);

/// User-friendly message for a disconnect reason.
String disconnectMessage(DisconnectReason reason) {
  switch (reason) {
    case DisconnectReason.clientInitiated:
      return 'Disconnected';
    case DisconnectReason.duplicateIdentity:
      return 'Another session took over this connection';
    case DisconnectReason.participantRemoved:
      return 'Removed from room';
    case DisconnectReason.roomDeleted:
      return 'Room no longer exists';
    case DisconnectReason.serverShutdown:
      return 'Server shut down';
    case DisconnectReason.joinFailure:
      return 'Failed to join room';
    case DisconnectReason.stateMismatch:
      return 'Connection state error';
    default:
      return 'Connection lost';
  }
}
