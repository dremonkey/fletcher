import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/utils/room_name_generator.dart';

void main() {
  group('NameGenerator', () {
    group('word lists', () {
      test('adjectives list contains at least 100 entries', () {
        expect(NameGenerator.adjectives.length, greaterThanOrEqualTo(100));
      });

      test('nouns list contains at least 100 entries', () {
        expect(NameGenerator.nouns.length, greaterThanOrEqualTo(100));
      });

      test('adjectives are all lowercase', () {
        for (final word in NameGenerator.adjectives) {
          expect(word, equals(word.toLowerCase()),
              reason: 'Adjective "$word" must be lowercase');
        }
      });

      test('nouns are all lowercase', () {
        for (final word in NameGenerator.nouns) {
          expect(word, equals(word.toLowerCase()),
              reason: 'Noun "$word" must be lowercase');
        }
      });

      test('adjectives contain no whitespace or hyphens', () {
        for (final word in NameGenerator.adjectives) {
          expect(word.contains(RegExp(r'[\s\-]')), isFalse,
              reason:
                  'Adjective "$word" must not contain whitespace or hyphens');
        }
      });

      test('nouns contain no whitespace or hyphens', () {
        for (final word in NameGenerator.nouns) {
          expect(word.contains(RegExp(r'[\s\-]')), isFalse,
              reason: 'Noun "$word" must not contain whitespace or hyphens');
        }
      });
    });

    group('generateWordPair()', () {
      test('returns adj-noun format (exactly one hyphen)', () {
        final pair = NameGenerator.generateWordPair();
        final parts = pair.split('-');
        expect(parts.length, equals(2),
            reason: 'Expected format adj-noun, got "$pair"');
      });

      test('returns all lowercase', () {
        final pair = NameGenerator.generateWordPair();
        expect(pair, equals(pair.toLowerCase()));
      });

      test('first word is from the adjectives list', () {
        final pair = NameGenerator.generateWordPair();
        final parts = pair.split('-');
        expect(NameGenerator.adjectives.contains(parts[0]), isTrue,
            reason: '"${parts[0]}" not found in adjectives list');
      });

      test('second word is from the nouns list', () {
        final pair = NameGenerator.generateWordPair();
        final parts = pair.split('-');
        expect(NameGenerator.nouns.contains(parts[1]), isTrue,
            reason: '"${parts[1]}" not found in nouns list');
      });

      test('produces different pairs on successive calls (probabilistic)', () {
        final pairs = {for (var i = 0; i < 10; i++) NameGenerator.generateWordPair()};
        expect(pairs.length, greaterThan(1),
            reason: 'Expected at least 2 unique pairs from 10 calls');
      });
    });

    group('generateRoomName()', () {
      test('returns adj-noun-XXXX format (exactly three hyphen-separated parts)',
          () {
        final name = NameGenerator.generateRoomName();
        final parts = name.split('-');
        expect(parts.length, equals(3),
            reason: 'Expected format adj-noun-XXXX, got "$name"');
      });

      test('suffix is exactly 4 characters', () {
        final name = NameGenerator.generateRoomName();
        final suffix = name.split('-').last;
        expect(suffix.length, equals(4),
            reason: 'Suffix should be 4 chars, got "$suffix"');
      });

      test('suffix contains only lowercase alphanumeric characters', () {
        for (var i = 0; i < 20; i++) {
          final name = NameGenerator.generateRoomName();
          final suffix = name.split('-').last;
          expect(suffix, matches(RegExp(r'^[a-z0-9]{4}$')),
              reason: 'Suffix "$suffix" must match [a-z0-9]{4}');
        }
      });

      test('adjective part is from the adjectives list', () {
        final name = NameGenerator.generateRoomName();
        final parts = name.split('-');
        expect(NameGenerator.adjectives.contains(parts[0]), isTrue,
            reason: '"${parts[0]}" not found in adjectives list');
      });

      test('noun part is from the nouns list', () {
        final name = NameGenerator.generateRoomName();
        final parts = name.split('-');
        expect(NameGenerator.nouns.contains(parts[1]), isTrue,
            reason: '"${parts[1]}" not found in nouns list');
      });

      test('produces different names on successive calls (probabilistic)', () {
        final names = {for (var i = 0; i < 10; i++) NameGenerator.generateRoomName()};
        expect(names.length, greaterThan(1),
            reason: 'Expected at least 2 unique names from 10 calls');
      });

      test('never returns an empty string', () {
        for (var i = 0; i < 20; i++) {
          expect(NameGenerator.generateRoomName().isEmpty, isFalse);
        }
      });
    });

    group('generateSessionName()', () {
      test('returns adj-noun-YYYYMMDD format (exactly three hyphen-separated parts)',
          () {
        final name = NameGenerator.generateSessionName();
        final parts = name.split('-');
        expect(parts.length, equals(3),
            reason: 'Expected format adj-noun-YYYYMMDD, got "$name"');
      });

      test('date suffix matches today\'s date in YYYYMMDD format', () {
        final name = NameGenerator.generateSessionName();
        final suffix = name.split('-').last;
        final now = DateTime.now();
        final expected =
            '${now.year}${now.month.toString().padLeft(2, '0')}${now.day.toString().padLeft(2, '0')}';
        expect(suffix, equals(expected),
            reason: 'Date suffix "$suffix" should match today "$expected"');
      });

      test('date suffix is exactly 8 characters', () {
        final name = NameGenerator.generateSessionName();
        final suffix = name.split('-').last;
        expect(suffix.length, equals(8),
            reason: 'Date suffix "$suffix" should be 8 chars (YYYYMMDD)');
      });

      test('date suffix contains only digits', () {
        final name = NameGenerator.generateSessionName();
        final suffix = name.split('-').last;
        expect(suffix, matches(RegExp(r'^\d{8}$')),
            reason: 'Date suffix "$suffix" must be 8 digits');
      });

      test('adjective part is from the adjectives list', () {
        final name = NameGenerator.generateSessionName();
        final parts = name.split('-');
        expect(NameGenerator.adjectives.contains(parts[0]), isTrue,
            reason: '"${parts[0]}" not found in adjectives list');
      });

      test('noun part is from the nouns list', () {
        final name = NameGenerator.generateSessionName();
        final parts = name.split('-');
        expect(NameGenerator.nouns.contains(parts[1]), isTrue,
            reason: '"${parts[1]}" not found in nouns list');
      });
    });

    group('E2E prefix pattern', () {
      test('e2e-prefixed room name matches e2e-adj-noun-XXXX format', () {
        final name = NameGenerator.generateRoomName();
        final e2eName = 'e2e-$name';

        // Should have exactly three hyphens: e2e-<adj>-<noun>-<suffix>
        final parts = e2eName.split('-');
        expect(parts.length, equals(4),
            reason:
                'E2E room name should have format e2e-adj-noun-XXXX, got "$e2eName"');
        expect(parts[0], equals('e2e'));
        expect(NameGenerator.adjectives.contains(parts[1]), isTrue,
            reason: '"${parts[1]}" not found in adjectives list');
        expect(NameGenerator.nouns.contains(parts[2]), isTrue,
            reason: '"${parts[2]}" not found in nouns list');
        expect(parts[3], matches(RegExp(r'^[a-z0-9]{4}$')),
            reason: 'Suffix "${parts[3]}" must match [a-z0-9]{4}');
      });

      test('non-E2E room name does not start with e2e-', () {
        for (var i = 0; i < 20; i++) {
          expect(NameGenerator.generateRoomName().startsWith('e2e-'), isFalse);
        }
      });
    });

    group('deprecated generate()', () {
      test('still returns a string (backward compat)', () {
        // ignore: deprecated_member_use
        final name = NameGenerator.generate();
        expect(name.isNotEmpty, isTrue);
      });

      test('returns adj-noun format (two parts)', () {
        // ignore: deprecated_member_use
        final name = NameGenerator.generate();
        final parts = name.split('-');
        expect(parts.length, equals(2),
            reason: 'Expected format adj-noun, got "$name"');
      });
    });
  });
}
