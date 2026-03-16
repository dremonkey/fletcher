import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:fletcher/services/session_storage.dart';

void main() {
  // Required for SharedPreferences mock
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    // Reset SharedPreferences to empty before each test
    SharedPreferences.setMockInitialValues({});
  });

  group('getSessionKey', () {
    test('generates and stores key on first call', () async {
      final key = await SessionStorage.getSessionKey();

      expect(key.isNotEmpty, isTrue);
      // Verify it was persisted
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('fletcher_session_key'), equals(key));
    });

    test('returns the same key on second call (persistence)', () async {
      final key1 = await SessionStorage.getSessionKey();
      final key2 = await SessionStorage.getSessionKey();
      expect(key2, equals(key1));
    });

    test('session key starts with agent:main:relay: prefix', () async {
      final key = await SessionStorage.getSessionKey();
      expect(key.startsWith('agent:main:relay:'), isTrue,
          reason: 'Key "$key" must start with agent:main:relay:');
    });

    test('session key format matches agent:main:relay:adj-noun-YYYYMMDD', () async {
      final key = await SessionStorage.getSessionKey();
      // Format: agent:main:relay:<adj>-<noun>-<YYYYMMDD>
      expect(
        key,
        matches(RegExp(r'^agent:main:relay:[a-z]+-[a-z]+-\d{8}$')),
        reason: 'Key "$key" does not match expected format',
      );
    });

    test('returns existing key from prefs when already stored', () async {
      const existingKey = 'agent:main:relay:jade-beacon-20260315';
      SharedPreferences.setMockInitialValues({
        'fletcher_session_key': existingKey,
      });

      final key = await SessionStorage.getSessionKey();
      expect(key, equals(existingKey));
    });
  });

  group('createNewSessionKey', () {
    test('creates and returns a new key', () async {
      final key = await SessionStorage.createNewSessionKey();

      expect(key.isNotEmpty, isTrue);
      expect(key.startsWith('agent:main:relay:'), isTrue);
    });

    test('replaces existing key', () async {
      const existingKey = 'agent:main:relay:jade-beacon-20260315';
      SharedPreferences.setMockInitialValues({
        'fletcher_session_key': existingKey,
      });

      final newKey = await SessionStorage.createNewSessionKey();
      // New key should be persisted
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('fletcher_session_key'), equals(newKey));
    });

    test('subsequent getSessionKey returns the newly created key', () async {
      // First establish a key
      await SessionStorage.getSessionKey();

      // Create a new one
      final newKey = await SessionStorage.createNewSessionKey();

      // getSessionKey should now return the new key
      final retrieved = await SessionStorage.getSessionKey();
      expect(retrieved, equals(newKey));
    });
  });

  group('saveSession', () {
    test('persists room name and timestamp', () async {
      await SessionStorage.saveSession('fletcher-1234567890');

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('fletcher_last_room'), 'fletcher-1234567890');
      expect(prefs.getInt('fletcher_last_connected_at'), isNotNull);
    });

    test('overwrites previous session', () async {
      await SessionStorage.saveSession('fletcher-111');
      await SessionStorage.saveSession('fletcher-222');

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('fletcher_last_room'), 'fletcher-222');
    });
  });

  group('getRecentRoom', () {
    test('returns null when no session saved', () async {
      final room = await SessionStorage.getRecentRoom(
        stalenessThreshold: const Duration(seconds: 120),
      );
      expect(room, isNull);
    });

    test('returns null when only room name saved (no timestamp)', () async {
      SharedPreferences.setMockInitialValues({
        'fletcher_last_room': 'fletcher-123',
        // no fletcher_last_connected_at
      });

      final room = await SessionStorage.getRecentRoom(
        stalenessThreshold: const Duration(seconds: 120),
      );
      expect(room, isNull);
    });

    test('returns null when only timestamp saved (no room name)', () async {
      SharedPreferences.setMockInitialValues({
        'fletcher_last_connected_at': DateTime.now().millisecondsSinceEpoch,
        // no fletcher_last_room
      });

      final room = await SessionStorage.getRecentRoom(
        stalenessThreshold: const Duration(seconds: 120),
      );
      expect(room, isNull);
    });

    test('returns room name when session is recent', () async {
      // Save a session that was "just now"
      SharedPreferences.setMockInitialValues({
        'fletcher_last_room': 'fletcher-recent',
        'fletcher_last_connected_at': DateTime.now().millisecondsSinceEpoch,
      });

      final room = await SessionStorage.getRecentRoom(
        stalenessThreshold: const Duration(seconds: 120),
      );
      expect(room, 'fletcher-recent');
    });

    test('returns null when session is stale', () async {
      // Save a session from 5 minutes ago
      final fiveMinutesAgo = DateTime.now()
          .subtract(const Duration(minutes: 5))
          .millisecondsSinceEpoch;
      SharedPreferences.setMockInitialValues({
        'fletcher_last_room': 'fletcher-stale',
        'fletcher_last_connected_at': fiveMinutesAgo,
      });

      final room = await SessionStorage.getRecentRoom(
        stalenessThreshold: const Duration(seconds: 120), // 2 min threshold
      );
      expect(room, isNull);
    });

    test('returns room at exactly the threshold boundary', () async {
      // Session saved exactly at the threshold edge — should still be recent
      // (elapsed <= threshold, since we use > not >=)
      final justUnder = DateTime.now()
          .subtract(const Duration(seconds: 119))
          .millisecondsSinceEpoch;
      SharedPreferences.setMockInitialValues({
        'fletcher_last_room': 'fletcher-boundary',
        'fletcher_last_connected_at': justUnder,
      });

      final room = await SessionStorage.getRecentRoom(
        stalenessThreshold: const Duration(seconds: 120),
      );
      expect(room, 'fletcher-boundary');
    });

    test('respects custom staleness threshold', () async {
      // Session from 30s ago with a 10s threshold → stale
      final thirtySecondsAgo = DateTime.now()
          .subtract(const Duration(seconds: 30))
          .millisecondsSinceEpoch;
      SharedPreferences.setMockInitialValues({
        'fletcher_last_room': 'fletcher-short',
        'fletcher_last_connected_at': thirtySecondsAgo,
      });

      final room = await SessionStorage.getRecentRoom(
        stalenessThreshold: const Duration(seconds: 10),
      );
      expect(room, isNull);
    });

    test('session from 30s ago with 60s threshold is recent', () async {
      final thirtySecondsAgo = DateTime.now()
          .subtract(const Duration(seconds: 30))
          .millisecondsSinceEpoch;
      SharedPreferences.setMockInitialValues({
        'fletcher_last_room': 'fletcher-ok',
        'fletcher_last_connected_at': thirtySecondsAgo,
      });

      final room = await SessionStorage.getRecentRoom(
        stalenessThreshold: const Duration(seconds: 60),
      );
      expect(room, 'fletcher-ok');
    });
  });

  group('clearSession', () {
    test('removes saved session data', () async {
      await SessionStorage.saveSession('fletcher-to-clear');

      // Verify it's there
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('fletcher_last_room'), isNotNull);

      await SessionStorage.clearSession();

      // Re-fetch prefs after clear
      final prefsAfter = await SharedPreferences.getInstance();
      expect(prefsAfter.getString('fletcher_last_room'), isNull);
      expect(prefsAfter.getInt('fletcher_last_connected_at'), isNull);
    });

    test('getRecentRoom returns null after clear', () async {
      await SessionStorage.saveSession('fletcher-cleared');
      await SessionStorage.clearSession();

      final room = await SessionStorage.getRecentRoom(
        stalenessThreshold: const Duration(seconds: 120),
      );
      expect(room, isNull);
    });
  });

  group('save + get round-trip', () {
    test('saved session is immediately retrievable', () async {
      await SessionStorage.saveSession('fletcher-roundtrip');

      final room = await SessionStorage.getRecentRoom(
        stalenessThreshold: const Duration(seconds: 120),
      );
      expect(room, 'fletcher-roundtrip');
    });

    test('multiple saves only keep the latest', () async {
      await SessionStorage.saveSession('fletcher-first');
      await SessionStorage.saveSession('fletcher-second');
      await SessionStorage.saveSession('fletcher-third');

      final room = await SessionStorage.getRecentRoom(
        stalenessThreshold: const Duration(seconds: 120),
      );
      expect(room, 'fletcher-third');
    });
  });
}
