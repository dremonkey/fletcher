import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/utils/room_name_generator.dart';

void main() {
  group('RoomNameGenerator', () {
    group('word lists', () {
      test('adjectives list contains at least 100 entries', () {
        expect(RoomNameGenerator.adjectives.length, greaterThanOrEqualTo(100));
      });

      test('nouns list contains at least 100 entries', () {
        expect(RoomNameGenerator.nouns.length, greaterThanOrEqualTo(100));
      });

      test('adjectives are all lowercase', () {
        for (final word in RoomNameGenerator.adjectives) {
          expect(word, equals(word.toLowerCase()),
              reason: 'Adjective "$word" must be lowercase');
        }
      });

      test('nouns are all lowercase', () {
        for (final word in RoomNameGenerator.nouns) {
          expect(word, equals(word.toLowerCase()),
              reason: 'Noun "$word" must be lowercase');
        }
      });

      test('adjectives contain no whitespace or hyphens', () {
        for (final word in RoomNameGenerator.adjectives) {
          expect(word.contains(RegExp(r'[\s\-]')), isFalse,
              reason:
                  'Adjective "$word" must not contain whitespace or hyphens');
        }
      });

      test('nouns contain no whitespace or hyphens', () {
        for (final word in RoomNameGenerator.nouns) {
          expect(word.contains(RegExp(r'[\s\-]')), isFalse,
              reason: 'Noun "$word" must not contain whitespace or hyphens');
        }
      });
    });

    group('generate()', () {
      test('returns a string containing exactly one hyphen', () {
        final name = RoomNameGenerator.generate();
        expect(name.split('-').length, equals(2),
            reason: 'Expected format word1-word2, got "$name"');
      });

      test('returns all lowercase', () {
        final name = RoomNameGenerator.generate();
        expect(name, equals(name.toLowerCase()));
      });

      test('first word is from the adjectives list', () {
        final name = RoomNameGenerator.generate();
        final parts = name.split('-');
        expect(RoomNameGenerator.adjectives.contains(parts[0]), isTrue,
            reason: '"${parts[0]}" not found in adjectives list');
      });

      test('second word is from the nouns list', () {
        final name = RoomNameGenerator.generate();
        final parts = name.split('-');
        expect(RoomNameGenerator.nouns.contains(parts[1]), isTrue,
            reason: '"${parts[1]}" not found in nouns list');
      });

      test('produces different names on successive calls (probabilistic)', () {
        // Run 10 times and expect at least 2 unique values.
        // Chance of all 10 being identical: (1/10000)^9 — negligible.
        final names = {for (var i = 0; i < 10; i++) RoomNameGenerator.generate()};
        expect(names.length, greaterThan(1),
            reason: 'Expected at least 2 unique names from 10 calls');
      });

      test('never returns an empty string', () {
        for (var i = 0; i < 20; i++) {
          expect(RoomNameGenerator.generate().isEmpty, isFalse);
        }
      });
    });

    group('E2E prefix pattern', () {
      test('e2e-prefixed name matches e2e-word1-word2 format', () {
        // Simulate the prefix logic from _generateRoomName() when E2E_TEST_MODE=true.
        final name = RoomNameGenerator.generate();
        final e2eName = 'e2e-$name';

        // Should have exactly two hyphens: e2e-<adj>-<noun>
        final parts = e2eName.split('-');
        expect(parts.length, equals(3),
            reason: 'E2E name should have format e2e-word1-word2, got "$e2eName"');
        expect(parts[0], equals('e2e'));
        expect(RoomNameGenerator.adjectives.contains(parts[1]), isTrue,
            reason: '"${parts[1]}" not found in adjectives list');
        expect(RoomNameGenerator.nouns.contains(parts[2]), isTrue,
            reason: '"${parts[2]}" not found in nouns list');
      });

      test('non-E2E name does not start with e2e-', () {
        // Run several times to confirm the plain generate() never produces e2e- prefix.
        for (var i = 0; i < 20; i++) {
          expect(RoomNameGenerator.generate().startsWith('e2e-'), isFalse);
        }
      });
    });
  });
}
