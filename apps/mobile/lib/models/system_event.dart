/// Types of system events displayed inline in the chat transcript.
enum SystemEventType { network, room, agent }

/// Status of a system event lifecycle.
enum SystemEventStatus { pending, success, error }

/// A system event representing a connection lifecycle change.
///
/// System events appear inline in the chat transcript as compact cards,
/// showing network resolution, room connection, and agent arrival/departure.
/// Events with the same [id] are updated in place (status transitions),
/// not duplicated.
class SystemEvent {
  final String id;
  final SystemEventType type;
  final SystemEventStatus status;
  final String message;
  final DateTime timestamp;

  /// Prefix symbol displayed before the type label.
  /// Typically: "\u25B8" (pending/success), "\u26A1" (network switch), "\u2715" (error/disconnect).
  final String prefix;

  const SystemEvent({
    required this.id,
    required this.type,
    required this.status,
    required this.message,
    required this.timestamp,
    required this.prefix,
  });

  SystemEvent copyWith({
    String? id,
    SystemEventType? type,
    SystemEventStatus? status,
    String? message,
    DateTime? timestamp,
    String? prefix,
  }) {
    return SystemEvent(
      id: id ?? this.id,
      type: type ?? this.type,
      status: status ?? this.status,
      message: message ?? this.message,
      timestamp: timestamp ?? this.timestamp,
      prefix: prefix ?? this.prefix,
    );
  }

  /// Display label for the event type (e.g. "NETWORK", "ROOM", "AGENT").
  String get typeLabel {
    switch (type) {
      case SystemEventType.network:
        return 'NETWORK';
      case SystemEventType.room:
        return 'ROOM';
      case SystemEventType.agent:
        return 'AGENT';
    }
  }
}
