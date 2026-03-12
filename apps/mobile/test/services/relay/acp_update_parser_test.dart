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
    // tool_call — emitted when agent invokes a tool
    // -------------------------------------------------------------------------

    group('tool_call', () {
      test('returns AcpNonContentUpdate on tool invocation', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call',
            'id': 'tool_abc123',
            'title': 'Read file',
            'input': {'path': '/home/user/project/main.dart'},
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpNonContentUpdate('tool_call'),
        );
      });
    });

    // -------------------------------------------------------------------------
    // tool_call_update — emitted as tool execution progresses
    // -------------------------------------------------------------------------

    group('tool_call_update', () {
      test('returns AcpNonContentUpdate for in_progress status', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call_update',
            'id': 'tool_abc123',
            'status': 'in_progress',
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpNonContentUpdate('tool_call_update'),
        );
      });

      test('returns AcpNonContentUpdate for completed status with content', () {
        final params = {
          'sessionId': 'sess_abc123',
          'update': {
            'sessionUpdate': 'tool_call_update',
            'id': 'tool_abc123',
            'status': 'completed',
            'content': [
              {'type': 'text', 'text': 'File contents: void main() {}'},
            ],
          },
        };
        expect(
          AcpUpdateParser.parse(params),
          AcpNonContentUpdate('tool_call_update'),
        );
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
