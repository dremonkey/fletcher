import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/utils/agent_text_parser.dart';

void main() {
  group('parseAgentText()', () {
    group('complete messages (no streaming, both tags present)', () {
      test('parses both think and final tags', () {
        final result = parseAgentText(
          '<think>reasoning here</think> <final>visible response</final>',
        );
        expect(result.thinking, equals('reasoning here'));
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.visible, equals('visible response'));
      });

      test('handles multiline think content', () {
        final result = parseAgentText(
          '<think>line one\nline two</think> <final>answer</final>',
        );
        expect(result.thinking, equals('line one\nline two'));
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.visible, equals('answer'));
      });

      test('final only — no think tag', () {
        final result = parseAgentText('<final>response only</final>');
        expect(result.thinking, isNull);
        expect(result.thinkingState, equals(ThinkingState.none));
        expect(result.visible, equals('response only'));
      });

      test('think tag followed by plain text (no final tag)', () {
        final result = parseAgentText('<think>reasoning</think> plain text after');
        expect(result.thinking, equals('reasoning'));
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.visible, equals('plain text after'));
      });

      test('no tags at all — returns raw as visible', () {
        final result = parseAgentText('hello world');
        expect(result.thinking, isNull);
        expect(result.thinkingState, equals(ThinkingState.none));
        expect(result.visible, equals('hello world'));
      });

      test('empty think block — thinking is null, thinkingState is complete', () {
        final result = parseAgentText('<think></think> <final>visible</final>');
        expect(result.thinking, isNull);
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.visible, equals('visible'));
      });

      test('empty think block (whitespace only) — thinking is null', () {
        final result = parseAgentText('<think>   </think> <final>response</final>');
        expect(result.thinking, isNull);
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.visible, equals('response'));
      });
    });

    group('streaming progression (partial messages)', () {
      test('unclosed think — inProgress, thinking set, visible empty', () {
        final result = parseAgentText('<think>reasoning so far');
        expect(result.thinkingState, equals(ThinkingState.inProgress));
        expect(result.thinking, equals('reasoning so far'));
        expect(result.visible, equals(''));
      });

      test('think complete, unclosed final — complete, visible streaming', () {
        final result = parseAgentText(
          '<think>reasoning</think> <final>partial response',
        );
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.thinking, equals('reasoning'));
        expect(result.visible, equals('partial response'));
      });

      test('think complete, no final yet — complete, visible empty', () {
        final result = parseAgentText('<think>reasoning</think> ');
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.thinking, equals('reasoning'));
        expect(result.visible, equals(''));
      });

      test('think complete, empty remainder — complete, visible empty', () {
        final result = parseAgentText('<think>reasoning</think>');
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.thinking, equals('reasoning'));
        expect(result.visible, equals(''));
      });
    });

    group('partial tag holding (streaming safety)', () {
      test('string ending with < is held — not in visible', () {
        final result = parseAgentText('hello<');
        expect(result.visible, equals('hello'));
        expect(result.thinkingState, equals(ThinkingState.none));
      });

      test('string ending with <thi is held', () {
        final result = parseAgentText('hello<thi');
        expect(result.visible, equals('hello'));
      });

      test('string ending with <think is held', () {
        final result = parseAgentText('hello<think');
        expect(result.visible, equals('hello'));
      });

      test('complete <think> tag is NOT held (it is confirmed)', () {
        final result = parseAgentText('<think>content');
        // <think> is fully confirmed, so thinkingState should be inProgress
        expect(result.thinkingState, equals(ThinkingState.inProgress));
        expect(result.thinking, equals('content'));
      });

      test('string ending with </think> <fin — visible is held', () {
        final result = parseAgentText('<think>R</think> <fin');
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.thinking, equals('R'));
        expect(result.visible, equals(''));
      });

      test('think complete, remainder ends with < — visible is empty', () {
        final result = parseAgentText('<think>reasoning</think> <');
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.visible, equals(''));
      });

      test('string ending with </fin — held', () {
        final result = parseAgentText('<think>R</think> <final>text</fin');
        expect(result.thinkingState, equals(ThinkingState.complete));
        // </fin is a partial suffix of </final> — the visible text would be
        // "text</fin" with </fin stripped → "text"
        expect(result.visible, equals('text'));
      });

      test('plain text ending with partial tag — partial stripped', () {
        final result = parseAgentText('hello world<');
        expect(result.visible, equals('hello world'));
      });

      test('plain text ending with <f — partial stripped', () {
        final result = parseAgentText('some text<f');
        expect(result.visible, equals('some text'));
      });
    });

    group('whitespace handling', () {
      test('thinking content is trimmed', () {
        final result = parseAgentText('<think>  spaced  </think> <final>ok</final>');
        expect(result.thinking, equals('spaced'));
      });

      test('visible content is trimmed', () {
        final result = parseAgentText('<think>r</think> <final>  spaced  </final>');
        expect(result.visible, equals('spaced'));
      });

      test('remainder after think is trimmed for visible', () {
        final result = parseAgentText('<think>r</think>   plain   ');
        expect(result.visible, equals('plain'));
      });

      test('no tags — content is trimmed', () {
        final result = parseAgentText('  hello  ');
        expect(result.visible, equals('hello'));
      });
    });

    group('edge cases', () {
      test('empty string returns empty visible', () {
        final result = parseAgentText('');
        expect(result.visible, equals(''));
        expect(result.thinking, isNull);
        expect(result.thinkingState, equals(ThinkingState.none));
      });

      test('only whitespace', () {
        final result = parseAgentText('   ');
        expect(result.visible, equals(''));
        expect(result.thinkingState, equals(ThinkingState.none));
      });

      test('typical full OpenClaw message', () {
        const raw =
            '<think>The user (identified as Fletcher) asked for a one-sentence '
            'summary of the interaction so far, which consists of an '
            'introduction/math question followed by a name confirmation.'
            '</think> <final>You introduced yourself as Fletcher, we did some '
            'quick math, and I confirmed your name for you.</final>';
        final result = parseAgentText(raw);
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.thinking, startsWith('The user (identified as Fletcher)'));
        expect(result.visible, startsWith('You introduced yourself'));
      });

      test('final tag text is not stripped as partial when complete', () {
        final result = parseAgentText('<think>R</think> <final>answer</final>');
        expect(result.visible, equals('answer'));
        expect(result.thinking, equals('R'));
      });

      test('inProgress with empty streaming content', () {
        final result = parseAgentText('<think>');
        expect(result.thinkingState, equals(ThinkingState.inProgress));
        expect(result.thinking, isNull);
        expect(result.visible, equals(''));
      });

      test('text before <think> tag — treated as plain text (BUG-038)', () {
        // <think> mid-text is a literal mention, NOT a structural tag.
        // The parser should return raw text as visible with no thinking.
        final result =
            parseAgentText('prefix text <think>R</think> <final>V</final>');
        expect(result.thinkingState, equals(ThinkingState.none));
        expect(result.thinking, isNull);
        expect(
          result.visible,
          equals('prefix text <think>R</think> <final>V</final>'),
        );
      });

      test('<think> with leading whitespace is still recognized', () {
        final result =
            parseAgentText('  <think>reasoning</think> <final>answer</final>');
        expect(result.thinkingState, equals(ThinkingState.complete));
        expect(result.thinking, equals('reasoning'));
        expect(result.visible, equals('answer'));
      });

      test('BUG-038 regression: literal <think> mention in prose', () {
        // The agent discusses the <think> feature in its response text.
        // This should NOT trigger the think-tag parser.
        const raw = 'Epic 25: We implemented Slash commands and `<think>` tag '
            'parsing, but the core engine for Seamless Resumption is next.';
        final result = parseAgentText(raw);
        expect(result.thinkingState, equals(ThinkingState.none));
        expect(result.thinking, isNull);
        expect(result.visible, equals(raw));
      });

      test('BUG-038 regression: <think> in markdown backticks mid-text', () {
        const raw =
            'The parser handles `<think>` and `<final>` tags at render time.';
        final result = parseAgentText(raw);
        expect(result.thinkingState, equals(ThinkingState.none));
        expect(result.thinking, isNull);
        expect(result.visible, equals(raw));
      });

      test('standalone <final> mid-text is treated as plain text', () {
        const raw = 'We added <final>output</final> tag support.';
        final result = parseAgentText(raw);
        expect(result.thinkingState, equals(ThinkingState.none));
        expect(result.thinking, isNull);
        expect(result.visible, equals(raw));
      });
    });
  });
}
