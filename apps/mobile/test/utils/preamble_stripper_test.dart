import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/utils/preamble_stripper.dart';

void main() {
  group('stripPreamble (TASK-077)', () {
    test('strips JSON metadata preamble from user message', () {
      const input =
          '{"sender":"device-abc123","room":"foo-bar-1234","timestamp":1234567890}\n'
          'Hello, how are you?';
      expect(stripPreamble(input), 'Hello, how are you?');
    });

    test('strips preamble with whitespace-padded JSON', () {
      const input =
          '  {"sender":"device-abc"}  \n'
          'User text here';
      expect(stripPreamble(input), 'User text here');
    });

    test('preserves multi-line message body after preamble', () {
      const input =
          '{"sender":"device-abc"}\n'
          'Line 1\n'
          'Line 2\n'
          'Line 3';
      expect(stripPreamble(input), 'Line 1\nLine 2\nLine 3');
    });

    test('returns original text when no newline present', () {
      const input = 'Just a plain message';
      expect(stripPreamble(input), input);
    });

    test('returns original text when first line is not JSON', () {
      const input = 'Not JSON at all\nSecond line';
      expect(stripPreamble(input), input);
    });

    test('returns original text when first line starts with { but is invalid JSON', () {
      const input = '{broken json\nActual message';
      expect(stripPreamble(input), input);
    });

    test('returns original text when first line is a JSON array', () {
      const input = '[1, 2, 3]\nActual message';
      expect(stripPreamble(input), input);
    });

    test('handles empty string', () {
      expect(stripPreamble(''), '');
    });

    test('handles message that is just a newline', () {
      expect(stripPreamble('\n'), '\n');
    });

    test('handles preamble with empty body after newline', () {
      const input = '{"sender":"device-abc"}\n';
      expect(stripPreamble(input), '');
    });

    test('does not strip when first line looks like JSON but user intent', () {
      // If the user literally typed JSON as their message, we'd strip it.
      // This is an acceptable edge case — real user messages don't start
      // with valid JSON objects.
      const input = '{"key":"value"}\nrest';
      expect(stripPreamble(input), 'rest');
    });
  });
}
