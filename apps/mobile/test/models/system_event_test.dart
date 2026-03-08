import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/system_event.dart';

void main() {
  group('SystemEventType', () {
    test('has exactly three values', () {
      expect(SystemEventType.values.length, 3);
    });

    test('contains network, room, agent', () {
      expect(SystemEventType.values, contains(SystemEventType.network));
      expect(SystemEventType.values, contains(SystemEventType.room));
      expect(SystemEventType.values, contains(SystemEventType.agent));
    });
  });

  group('SystemEventStatus', () {
    test('has exactly three values', () {
      expect(SystemEventStatus.values.length, 3);
    });

    test('contains pending, success, error', () {
      expect(SystemEventStatus.values, contains(SystemEventStatus.pending));
      expect(SystemEventStatus.values, contains(SystemEventStatus.success));
      expect(SystemEventStatus.values, contains(SystemEventStatus.error));
    });
  });

  group('SystemEvent', () {
    late SystemEvent event;
    late DateTime timestamp;

    setUp(() {
      timestamp = DateTime(2026, 3, 7, 12, 0, 1);
      event = SystemEvent(
        id: 'network-boot',
        type: SystemEventType.network,
        status: SystemEventStatus.pending,
        message: 'resolving...',
        timestamp: timestamp,
        prefix: '\u25B8',
      );
    });

    test('stores all fields correctly', () {
      expect(event.id, 'network-boot');
      expect(event.type, SystemEventType.network);
      expect(event.status, SystemEventStatus.pending);
      expect(event.message, 'resolving...');
      expect(event.timestamp, timestamp);
      expect(event.prefix, '\u25B8');
    });

    test('typeLabel returns correct label for network', () {
      expect(event.typeLabel, 'NETWORK');
    });

    test('typeLabel returns correct label for room', () {
      final roomEvent = event.copyWith(type: SystemEventType.room);
      expect(roomEvent.typeLabel, 'ROOM');
    });

    test('typeLabel returns correct label for agent', () {
      final agentEvent = event.copyWith(type: SystemEventType.agent);
      expect(agentEvent.typeLabel, 'AGENT');
    });

    group('copyWith', () {
      test('returns new instance with updated id', () {
        final updated = event.copyWith(id: 'new-id');
        expect(updated.id, 'new-id');
        expect(updated.type, event.type);
        expect(updated.status, event.status);
        expect(updated.message, event.message);
      });

      test('returns new instance with updated type', () {
        final updated = event.copyWith(type: SystemEventType.room);
        expect(updated.type, SystemEventType.room);
        expect(updated.id, event.id);
      });

      test('returns new instance with updated status', () {
        final updated = event.copyWith(status: SystemEventStatus.success);
        expect(updated.status, SystemEventStatus.success);
        expect(updated.message, event.message);
      });

      test('returns new instance with updated message', () {
        final updated = event.copyWith(message: 'tailscale 100.1.2.3');
        expect(updated.message, 'tailscale 100.1.2.3');
        expect(updated.status, event.status);
      });

      test('returns new instance with updated timestamp', () {
        final newTs = DateTime(2026, 3, 7, 12, 0, 5);
        final updated = event.copyWith(timestamp: newTs);
        expect(updated.timestamp, newTs);
      });

      test('returns new instance with updated prefix', () {
        final updated = event.copyWith(prefix: '\u2715');
        expect(updated.prefix, '\u2715');
      });

      test('preserves all fields when no arguments given', () {
        final copy = event.copyWith();
        expect(copy.id, event.id);
        expect(copy.type, event.type);
        expect(copy.status, event.status);
        expect(copy.message, event.message);
        expect(copy.timestamp, event.timestamp);
        expect(copy.prefix, event.prefix);
      });
    });
  });
}
