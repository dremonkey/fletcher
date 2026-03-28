/// Tests for AcpUpdateParser — the ACP session/update notification parser.
///
/// All test payloads are derived from the official ACP specification:
/// https://agentclientprotocol.com/protocol/prompt-turn.md
///
/// Wire format confirmed against OpenClaw in Fletcher field test 2026-03-12.
///
/// session/update params shape:
///   { "sessionId": string, "update": { "sessionUpdate": string, ...fields } }
///
/// — singular `update` object, NOT an `updates[]` array.

import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/relay/acp_update_parser.dart';

void main() {
  group('AcpUpdateParser.parse', () {
    // -------------------------------------------------------------------------
    // agent_message_chunk — carries streamed response text
    // -------------------------------------------------------------------------

    group('agent_message_chunk', () {
      test('returns AcpTextDelta for text content', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {'type': 'text', 'text': 'Hello, world!'},
          },
        };
        expect(AcpUpdateParser.parse(params), AcpTextDelta('Hello, world!'));
      });

      test('returns AcpTextDelta for empty string (caller filters)', () {
        // The spec does not prohibit empty text chunks. Caller decides
        // whether to render — the parser passes through faithfully.
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {'type': 'text', 'text': ''},
          },
        };
        expect(AcpUpdateParser.parse(params), AcpTextDelta(''));
      });

      test('returns AcpTextDelta for multi-line text', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {'type': 'text', 'text': 'Line 1\nLine 2\nLine 3'},
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpTextDelta('Line 1\nLine 2\nLine 3'),
        );
      });

      test('returns AcpTextDelta for text with unicode', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {'type': 'text', 'text': '温度は72°F ☀️'},
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpTextDelta('温度は72°F ☀️'),
        );
      });

      test('returns AcpNonContentUpdate for image content (non-text)', () {
        // ACP allows agent_message_chunk to carry image ContentBlocks.
        // Mobile does not render these as text — treat as non-content.
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {
              'type': 'image',
              'mimeType': 'image/png',
              'data': 'iVBORw0KGgo=',
            },
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpNonContentUpdate('agent_message_chunk'),
        );
      });

      test('returns AcpNonContentUpdate for resource content', () {
        // Embedded resource — non-renderable as text
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {
              'type': 'resource',
              'resource': {
                'uri': 'file:///home/user/file.dart',
                'mimeType': 'text/x-dart',
                'text': 'void main() {}',
              },
            },
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpNonContentUpdate('agent_message_chunk'),
        );
      });

      test('returns null when content field is absent', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            // no content field — malformed
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when content is null', () {
        final params = <String, dynamic>{
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': null,
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when content is not an object', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': 'bare string',
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when text field is absent', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {'type': 'text'}, // missing text
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when text is not a string', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {'type': 'text', 'text': 42},
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });
    });

    // -------------------------------------------------------------------------
    // user_message — replayed during session/load (TASK-077)
    // -------------------------------------------------------------------------

    group('user_message', () {
      test('returns AcpUserMessage with text from prompt array', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message',
            'prompt': [
              {'type': 'text', 'text': 'Hello, agent!'},
            ],
          },
        };
        expect(AcpUpdateParser.parse(params), AcpUserMessage('Hello, agent!'));
      });

      test('concatenates multiple text parts in prompt', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message',
            'prompt': [
              {'type': 'text', 'text': 'Part 1. '},
              {'type': 'text', 'text': 'Part 2.'},
            ],
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpUserMessage('Part 1. Part 2.'),
        );
      });

      test('ignores non-text parts in prompt', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message',
            'prompt': [
              {'type': 'image', 'data': 'iVBORw=='},
              {'type': 'text', 'text': 'actual message'},
            ],
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpUserMessage('actual message'),
        );
      });

      test('returns null when prompt is missing', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message',
            // no prompt field
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when prompt is not a list', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message',
            'prompt': 'not a list',
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when prompt has no text parts', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message',
            'prompt': [
              {'type': 'image', 'data': 'abc='},
            ],
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('AcpUserMessage equality works', () {
        const a = AcpUserMessage('hello');
        const b = AcpUserMessage('hello');
        const c = AcpUserMessage('world');
        expect(a, equals(b));
        expect(a, isNot(equals(c)));
      });
    });

    // -------------------------------------------------------------------------
    // user_message_chunk — replayed during session/load (BUG-047)
    //
    // Uses ContentBlock structure (like agent_message_chunk), NOT the prompt
    // array that user_message uses. Emitted by OpenClaw's session/load.
    // -------------------------------------------------------------------------

    group('user_message_chunk', () {
      test('returns AcpUserMessage with text from content block', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message_chunk',
            'content': {'type': 'text', 'text': 'What is the weather?'},
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpUserMessage('What is the weather?'),
        );
      });

      test('returns AcpUserMessage for empty string', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message_chunk',
            'content': {'type': 'text', 'text': ''},
          },
        };
        expect(AcpUpdateParser.parse(params), AcpUserMessage(''));
      });

      test('returns AcpUserMessage for multi-line text', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message_chunk',
            'content': {'type': 'text', 'text': 'Line 1\nLine 2'},
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpUserMessage('Line 1\nLine 2'),
        );
      });

      test('returns null when content is missing', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message_chunk',
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when content is not an object', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message_chunk',
            'content': 'bare string',
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null for non-text content type', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message_chunk',
            'content': {'type': 'image', 'data': 'abc='},
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when text field is missing', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message_chunk',
            'content': {'type': 'text'},
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when text is not a string', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message_chunk',
            'content': {'type': 'text', 'text': 42},
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('ignores _meta field (parser does not require it)', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'user_message_chunk',
            'content': {'type': 'text', 'text': 'hello'},
            '_meta': {},
          },
        };
        expect(AcpUpdateParser.parse(params), AcpUserMessage('hello'));
      });
    });

    // -------------------------------------------------------------------------
    // agent_thought_chunk — carries streamed thinking/reasoning text
    //
    // ACP spec: https://agentclientprotocol.com/protocol/schema#param-agent-thought-chunk
    //
    // Wire format mirrors agent_message_chunk — same ContentBlock structure,
    // different sessionUpdate discriminator. Carries model reasoning that
    // should be displayed separately from visible output.
    //
    // As of 2026-03, OpenClaw's ACP bridge does not emit this update kind.
    // Tests verify spec-compliance for forward compatibility.
    // -------------------------------------------------------------------------

    group('agent_thought_chunk', () {
      test('returns AcpThinkingDelta for text content', () {
        // ACP spec: agent_thought_chunk with text ContentBlock
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_thought_chunk',
            'content': {'type': 'text', 'text': 'Let me think about this...'},
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpThinkingDelta('Let me think about this...'),
        );
      });

      test('returns AcpThinkingDelta for empty string', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_thought_chunk',
            'content': {'type': 'text', 'text': ''},
          },
        };
        expect(AcpUpdateParser.parse(params), AcpThinkingDelta(''));
      });

      test('returns AcpThinkingDelta for multi-line reasoning', () {
        // Thought chunks often contain structured reasoning with newlines
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_thought_chunk',
            'content': {
              'type': 'text',
              'text': 'Step 1: Parse the input\nStep 2: Validate\nStep 3: Return',
            },
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpThinkingDelta(
            'Step 1: Parse the input\nStep 2: Validate\nStep 3: Return',
          ),
        );
      });

      test('ignores _meta field per ACP spec (parser does not require it)', () {
        // ACP spec: _meta is reserved metadata that implementations MUST NOT
        // make assumptions about. Parser should work with or without it.
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_thought_chunk',
            'content': {'type': 'text', 'text': 'reasoning'},
            '_meta': {'source': 'extended-thinking', 'model': 'claude-opus'},
          },
        };
        expect(AcpUpdateParser.parse(params), AcpThinkingDelta('reasoning'));
      });

      test('returns null when content is missing', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_thought_chunk',
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when content is not an object', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_thought_chunk',
            'content': 'bare string',
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null for non-text content type', () {
        // ACP ContentBlock is a union — only text is meaningful for thought
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_thought_chunk',
            'content': {'type': 'image', 'data': 'abc='},
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when text field is missing', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_thought_chunk',
            'content': {'type': 'text'},
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when text is not a string', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'agent_thought_chunk',
            'content': {'type': 'text', 'text': 42},
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('AcpThinkingDelta equality works', () {
        const a = AcpThinkingDelta('thinking');
        const b = AcpThinkingDelta('thinking');
        const c = AcpThinkingDelta('other');
        expect(a, equals(b));
        expect(a, isNot(equals(c)));
      });

      test('AcpThinkingDelta is distinct from AcpTextDelta', () {
        // Same text content, different update kind — must be distinguishable
        const thinking = AcpThinkingDelta('hello');
        const text = AcpTextDelta('hello');
        expect(thinking, isNot(equals(text)));
        expect(thinking.runtimeType, isNot(text.runtimeType));
      });
    });

    // -------------------------------------------------------------------------
    // available_commands_update — emitted on session/new and on changes
    // -------------------------------------------------------------------------

    group('available_commands_update', () {
      test('returns AcpNonContentUpdate', () {
        // Spec: emitted when slash command list changes.
        // Payload confirmed against OpenClaw (sent immediately after session/new).
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'available_commands_update',
            'availableCommands': [
              {'name': 'help', 'description': 'Show help and common commands.'},
              {'name': 'stop', 'description': 'Stop the current run.'},
              {'name': 'new', 'description': 'Reset the session.'},
              {
                'name': 'model',
                'description': 'Select a model.',
                'input': {'hint': 'list | <name>'},
              },
              {'name': 'think', 'description': 'Set thinking level.'},
            ],
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpNonContentUpdate('available_commands_update'),
        );
      });
    });

    // -------------------------------------------------------------------------
    // plan — emitted when agent creates/updates a task plan
    // -------------------------------------------------------------------------

    group('plan', () {
      test('returns AcpNonContentUpdate', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'plan',
            'plan': {
              'tasks': [
                {
                  'id': 'task_1',
                  'title': 'Understand the request',
                  'status': 'completed',
                },
                {
                  'id': 'task_2',
                  'title': 'Write the implementation',
                  'status': 'in_progress',
                },
                {
                  'id': 'task_3',
                  'title': 'Run tests',
                  'status': 'pending',
                },
              ],
            },
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpNonContentUpdate('plan'),
        );
      });
    });

    // -------------------------------------------------------------------------
    // tool_call — emitted when agent invokes a tool (verbose mode)
    // -------------------------------------------------------------------------

    group('tool_call', () {
      test('returns AcpToolCallUpdate with id and title (status: null)', () {
        // Verbose mode: tool_call emitted when agent invokes a tool.
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call',
            'id': 'tc_123',
            'title': 'memory_search',
            'input': '{"query": "user preferences"}',
          },
        };
        final result = AcpUpdateParser.parse(params);
        expect(result, isA<AcpToolCallUpdate>());
        final update = result! as AcpToolCallUpdate;
        expect(update.id, 'tc_123');
        expect(update.title, 'memory_search');
        expect(update.status, isNull);
        expect(update.input, '{"query": "user preferences"}');
      });

      test('extracts kind field when present', () {
        // ACP tool_call events include a kind discriminator for the operation type.
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call',
            'id': 'tc_read_1',
            'kind': 'read',
            'title': 'Reading src/main.dart',
            'input': '{"path": "src/main.dart"}',
          },
        };
        final result = AcpUpdateParser.parse(params);
        expect(result, isA<AcpToolCallUpdate>());
        final update = result! as AcpToolCallUpdate;
        expect(update.id, 'tc_read_1');
        expect(update.kind, 'read');
        expect(update.title, 'Reading src/main.dart');
        expect(update.status, isNull);
      });

      test('kind is null when not present (older ACP implementations)', () {
        // tool_call events from agents that do not emit kind should still parse.
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call',
            'id': 'tc_456',
            'title': 'memory_search',
            // no 'kind' field
          },
        };
        final result = AcpUpdateParser.parse(params);
        expect(result, isA<AcpToolCallUpdate>());
        expect((result! as AcpToolCallUpdate).kind, isNull);
      });

      test('all ACP kind values parse correctly', () {
        // Verify each expected kind value round-trips through the parser.
        final kinds = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'other'];
        for (final k in kinds) {
          final params = {
            'update': {
              'sessionUpdate': 'tool_call',
              'id': 'tc_$k',
              'kind': k,
              'title': 'Performing $k',
            },
          };
          final result = AcpUpdateParser.parse(params);
          expect(result, isA<AcpToolCallUpdate>(), reason: 'kind=$k should parse');
          expect((result! as AcpToolCallUpdate).kind, k);
        }
      });

      test('returns null when id is missing', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call',
            // 'id' is absent — malformed
            'title': 'memory_search',
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when id is not a string', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call',
            'id': 42, // not a string
            'title': 'memory_search',
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('title is null when not present (optional field)', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call',
            'id': 'tc_456',
            // no title
          },
        };
        final result = AcpUpdateParser.parse(params);
        expect(result, isA<AcpToolCallUpdate>());
        expect((result! as AcpToolCallUpdate).title, isNull);
      });

      test('input is null when not a string (e.g. object format)', () {
        // input may be a JSON object on the wire; only capture if it is a string
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call',
            'id': 'tc_789',
            'title': 'read_file',
            'input': {'path': '/home/user/main.dart'}, // object, not string
          },
        };
        final result = AcpUpdateParser.parse(params);
        expect(result, isA<AcpToolCallUpdate>());
        expect((result! as AcpToolCallUpdate).input, isNull);
      });

      test('AcpToolCallUpdate equality includes kind', () {
        const a = AcpToolCallUpdate(id: 'tc_1', kind: 'read', title: 'Reading file', status: null);
        const b = AcpToolCallUpdate(id: 'tc_1', kind: 'read', title: 'Reading file', status: null);
        const c = AcpToolCallUpdate(id: 'tc_1', kind: 'edit', title: 'Reading file', status: null);
        expect(a, equals(b));
        expect(a, isNot(equals(c)));
      });

      test('AcpToolCallUpdate equality works without kind (backward compat)', () {
        const a = AcpToolCallUpdate(id: 'tc_1', title: 'search', status: null);
        const b = AcpToolCallUpdate(id: 'tc_1', title: 'search', status: null);
        const c = AcpToolCallUpdate(id: 'tc_2', title: 'search', status: null);
        expect(a, equals(b));
        expect(a, isNot(equals(c)));
      });
    });

    // -------------------------------------------------------------------------
    // tool_call_update — emitted as tool execution progresses (verbose mode)
    // -------------------------------------------------------------------------

    group('tool_call_update', () {
      test('returns AcpToolCallUpdate with id and status', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call_update',
            'id': 'tc_123',
            'status': 'completed',
            'content': [
              {'type': 'text', 'text': 'File contents: void main() {}'},
            ],
          },
        };
        final result = AcpUpdateParser.parse(params);
        expect(result, isA<AcpToolCallUpdate>());
        final update = result! as AcpToolCallUpdate;
        expect(update.id, 'tc_123');
        expect(update.status, 'completed');
        expect(update.title, isNull); // tool_call_update does not carry title
      });

      test('returns AcpToolCallUpdate for error status', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call_update',
            'id': 'tc_456',
            'status': 'error',
          },
        };
        final result = AcpUpdateParser.parse(params);
        expect(result, isA<AcpToolCallUpdate>());
        expect((result! as AcpToolCallUpdate).status, 'error');
      });

      test('returns null when id is missing', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call_update',
            // 'id' is absent — malformed
            'status': 'completed',
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when id is not a string', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call_update',
            'id': 99, // not a string
            'status': 'completed',
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });
    });

    // -------------------------------------------------------------------------
    // usage_update — token consumption from OpenClaw session store
    // -------------------------------------------------------------------------

    group('usage_update', () {
      test('returns AcpUsageUpdate for valid used and size', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'usage_update',
            'used': 35224,
            'size': 1048576,
            '_meta': {'source': 'gateway-session-store', 'approximate': true},
          },
        };
        final result = AcpUpdateParser.parse(params);
        expect(result, isA<AcpUsageUpdate>());
        final update = result! as AcpUsageUpdate;
        expect(update.used, 35224);
        expect(update.size, 1048576);
      });

      test('AcpUsageUpdate equality is based on used and size', () {
        const a = AcpUsageUpdate(used: 1000, size: 100000);
        const b = AcpUsageUpdate(used: 1000, size: 100000);
        const c = AcpUsageUpdate(used: 2000, size: 100000);
        expect(a, equals(b));
        expect(a, isNot(equals(c)));
      });

      test('percentage is correct for normal values', () {
        const update = AcpUsageUpdate(used: 500, size: 1000);
        expect(update.percentage, 0.5);
      });

      test('percentage is 0.0 when size is 0 (avoids division by zero)', () {
        const update = AcpUsageUpdate(used: 100, size: 0);
        expect(update.percentage, 0.0);
      });

      test('returns null when used field is missing', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'usage_update',
            // 'used' is absent
            'size': 1048576,
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when used is not an int', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'usage_update',
            'used': '35224', // string, not int
            'size': 1048576,
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when size is missing', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'usage_update',
            'used': 35224,
            // 'size' is absent
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when size is not an int', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'usage_update',
            'used': 35224,
            'size': 1048576.0, // double, not int
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });
    });

    // -------------------------------------------------------------------------
    // unknown / future kinds — forward compatibility
    // -------------------------------------------------------------------------

    group('unknown and future kinds', () {
      test('returns AcpNonContentUpdate for unrecognized sessionUpdate', () {
        // Per ACP spec, implementations SHOULD ignore unrecognized notifications.
        // We return a typed value so callers can log if they want.
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'some_future_update_kind_v2',
            'data': {'foo': 'bar', 'baz': 42},
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpNonContentUpdate('some_future_update_kind_v2'),
        );
      });

      test('preserves the exact kind string for unknown updates', () {
        final params = {
          'update': {
            'sessionUpdate': 'weird/slashes/in/kind',
          },
        };
        final result = AcpUpdateParser.parse(params);
        expect(result, isA<AcpNonContentUpdate>());
        expect((result! as AcpNonContentUpdate).kind, 'weird/slashes/in/kind');
      });
    });

    // -------------------------------------------------------------------------
    // Malformed / missing fields
    // -------------------------------------------------------------------------

    group('malformed input', () {
      test('returns null when update field is absent', () {
        final params = {
          'sessionId': 'sess_abc123',
          // no update field
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when update is null', () {
        final params = <String, dynamic>{
          'sessionId': 'sess_abc123',
          'update': null,
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when update is a string (not an object)', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': 'not an object',
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when update is a list (not an object)', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': ['agent_message_chunk'],
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when sessionUpdate discriminator is absent', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            // missing sessionUpdate — unknown intent
            'content': {'type': 'text', 'text': 'Hello'},
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null when sessionUpdate is not a string', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 42,
            'content': {'type': 'text', 'text': 'Hello'},
          },
        };
        expect(AcpUpdateParser.parse(params), isNull);
      });

      test('returns null for empty params map', () {
        expect(AcpUpdateParser.parse({}), isNull);
      });

      test('handles missing sessionId gracefully', () {
        // sessionId is routing metadata — parser should not require it
        final params = {
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {'type': 'text', 'text': 'Works without sessionId'},
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpTextDelta('Works without sessionId'),
        );
      });
    });
  });
}
