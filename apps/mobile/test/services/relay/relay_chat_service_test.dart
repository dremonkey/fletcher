import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/relay/relay_chat_service.dart';

void main() {
  /// Encode a JSON-RPC message as a Uint8List (simulates data channel payload).
  Uint8List encode(Map<String, dynamic> json) {
    return Uint8List.fromList(utf8.encode(jsonEncode(json)));
  }

  /// A `session/update` notification with an `agent_message_chunk` update.
  /// Uses the real ACP wire format: singular `update` object.
  Map<String, dynamic> contentChunk(String text, {String sessionId = 'sess_abc'}) => {
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'sessionId': sessionId,
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {'type': 'text', 'text': text},
          },
        },
      };

  /// A `session/prompt` result (closes the in-flight request).
  Map<String, dynamic> promptResult(int id, {String stopReason = 'end_turn'}) => {
        'jsonrpc': '2.0',
        'id': id,
        'result': {'stopReason': stopReason},
      };

  late RelayChatService service;
  late List<Uint8List> published;

  setUp(() {
    published = [];
    service = RelayChatService(
      publish: (data) async => published.add(data),
    );
  });

  tearDown(() {
    service.dispose();
  });

  group('sendPrompt', () {
    test('publishes session/prompt with correct shape', () {
      service.sendPrompt('Hello');

      expect(published, hasLength(1));
      final json = jsonDecode(utf8.decode(published.first));
      expect(json['jsonrpc'], '2.0');
      expect(json['id'], 1);
      expect(json['method'], 'session/prompt');
      expect(json['params']['prompt'][0]['type'], 'text');
      expect(json['params']['prompt'][0]['text'], 'Hello');
    });

    test('increments request ID', () {
      final stream1 = service.sendPrompt('First');
      service.handleMessage(encode(promptResult(1)));
      stream1.drain<void>();

      service.sendPrompt('Second');
      expect(published, hasLength(2));

      final json1 = jsonDecode(utf8.decode(published[0]));
      final json2 = jsonDecode(utf8.decode(published[1]));
      expect(json1['id'], 1);
      expect(json2['id'], 2);
    });

    test('marks service as busy while prompt in-flight', () {
      expect(service.isBusy, isFalse);
      service.sendPrompt('Test');
      expect(service.isBusy, isTrue);

      service.handleMessage(encode(promptResult(1)));

      expectLater(
        Future.delayed(Duration.zero, () => service.isBusy),
        completion(isFalse),
      );
    });
  });

  group('streaming response', () {
    test('emits content deltas from session/update (ACP wire format)', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      // ACP sends one notification per chunk — singular update object
      service.handleMessage(encode(contentChunk('Hello')));
      service.handleMessage(encode(contentChunk(' world')));
      service.handleMessage(encode(promptResult(1)));

      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(3));
      expect(events[0], isA<RelayContentDelta>());
      expect((events[0] as RelayContentDelta).text, 'Hello');
      expect(events[1], isA<RelayContentDelta>());
      expect((events[1] as RelayContentDelta).text, ' world');
      expect(events[2], isA<RelayPromptComplete>());
      expect((events[2] as RelayPromptComplete).stopReason, 'end_turn');
    });

    test('ignores available_commands_update (non-content)', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      // OpenClaw emits this immediately after session/new — must be ignored
      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'sessionId': 'sess_abc',
          'update': {
            'sessionUpdate': 'available_commands_update',
            'availableCommands': [
              {'name': 'help', 'description': 'Show help.'},
              {'name': 'stop', 'description': 'Stop the current run.'},
            ],
          },
        },
      }));
      service.handleMessage(encode(contentChunk('actual response')));
      service.handleMessage(encode(promptResult(1)));

      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(2));
      expect((events[0] as RelayContentDelta).text, 'actual response');
      expect(events[1], isA<RelayPromptComplete>());
    });

    test('ignores plan updates (non-content)', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'sessionId': 'sess_abc',
          'update': {
            'sessionUpdate': 'plan',
            'plan': {
              'tasks': [
                {'id': '1', 'title': 'Think', 'status': 'in_progress'},
              ],
            },
          },
        },
      }));
      service.handleMessage(encode(contentChunk('done')));
      service.handleMessage(encode(promptResult(1)));

      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(2));
      expect((events[0] as RelayContentDelta).text, 'done');
    });

    test('emits RelayToolCallEvent for tool_call and tool_call_update (verbose mode)', () async {
      // Task 038: tool_call and tool_call_update now surface as RelayToolCallEvent
      // instead of being silently ignored. This is the verbose mode path.
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'sessionId': 'sess_abc',
          'update': {
            'sessionUpdate': 'tool_call',
            'id': 'tool_1',
            'title': 'Read file',
            'input': '{"path": "/tmp/foo"}',
          },
        },
      }));
      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'sessionId': 'sess_abc',
          'update': {
            'sessionUpdate': 'tool_call_update',
            'id': 'tool_1',
            'status': 'completed',
            'content': [
              {'type': 'text', 'text': 'file contents'},
            ],
          },
        },
      }));
      service.handleMessage(encode(contentChunk('summary')));
      service.handleMessage(encode(promptResult(1)));

      await Future<void>.delayed(Duration.zero);

      // 2 tool call events + 1 content delta + 1 prompt complete = 4 total
      expect(events, hasLength(4));

      // First: tool call started (status null)
      expect(events[0], isA<RelayToolCallEvent>());
      final started = events[0] as RelayToolCallEvent;
      expect(started.id, 'tool_1');
      expect(started.title, 'Read file');
      expect(started.status, isNull);

      // Second: tool call completed
      expect(events[1], isA<RelayToolCallEvent>());
      final completed = events[1] as RelayToolCallEvent;
      expect(completed.id, 'tool_1');
      expect(completed.status, 'completed');
      expect(completed.title, isNull);

      // Third: content delta
      expect(events[2], isA<RelayContentDelta>());
      expect((events[2] as RelayContentDelta).text, 'summary');

      // Fourth: prompt complete
      expect(events[3], isA<RelayPromptComplete>());
    });

    test('tool_call with missing id emits nothing (malformed)', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'sessionId': 'sess_abc',
          'update': {
            'sessionUpdate': 'tool_call',
            // missing 'id' — malformed, parser returns null
            'title': 'broken_tool',
          },
        },
      }));
      service.handleMessage(encode(promptResult(1)));

      await Future<void>.delayed(Duration.zero);

      // Only the prompt complete arrives; malformed tool_call is silently dropped
      expect(events, hasLength(1));
      expect(events[0], isA<RelayPromptComplete>());
    });

    test('ignores unknown future sessionUpdate kinds (forward compat)', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'sessionId': 'sess_abc',
          'update': {
            'sessionUpdate': 'some_future_kind_v2',
            'data': {'foo': 'bar'},
          },
        },
      }));
      service.handleMessage(encode(contentChunk('kept')));
      service.handleMessage(encode(promptResult(1)));

      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(2));
      expect((events[0] as RelayContentDelta).text, 'kept');
    });

    test('ignores empty text in agent_message_chunk', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(encode(contentChunk('')));
      service.handleMessage(encode(promptResult(1)));

      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(1));
      expect(events[0], isA<RelayPromptComplete>());
    });

    test('ignores agent_message_chunk with non-text content', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'sessionId': 'sess_abc',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {'type': 'image', 'mimeType': 'image/png', 'data': 'abc='},
          },
        },
      }));
      service.handleMessage(encode(promptResult(1)));

      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(1));
      expect(events[0], isA<RelayPromptComplete>());
    });
  });

  group('error handling', () {
    test('emits error for JSON-RPC error response', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'id': 1,
        'error': {
          'code': -32010,
          'message': 'ACP connection lost',
        },
      }));

      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(1));
      expect(events[0], isA<RelayPromptError>());
      final err = events[0] as RelayPromptError;
      expect(err.code, -32010);
      expect(err.message, 'ACP connection lost');
    });

    test('ignores responses with wrong request ID', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(encode(promptResult(999)));

      await Future<void>.delayed(Duration.zero);
      expect(events, isEmpty);
      expect(service.isBusy, isTrue);

      service.handleMessage(encode(promptResult(1)));

      await Future<void>.delayed(Duration.zero);
      expect(events, hasLength(1));
    });

    test('ignores malformed messages', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(Uint8List.fromList(utf8.encode('not json')));
      service.handleMessage(Uint8List.fromList(utf8.encode('{}')));
      service.handleMessage(Uint8List.fromList(utf8.encode('[]')));

      await Future<void>.delayed(Duration.zero);
      expect(events, isEmpty);
      expect(service.isBusy, isTrue);
    });
  });

  group('cancelPrompt', () {
    test('sends session/cancel notification', () {
      service.sendPrompt('Hi');
      published.clear();

      service.cancelPrompt();

      expect(published, hasLength(1));
      final json = jsonDecode(utf8.decode(published.first));
      expect(json['jsonrpc'], '2.0');
      expect(json['method'], 'session/cancel');
      expect(json.containsKey('id'), isFalse);
    });

    test('does nothing when no prompt in-flight', () {
      service.cancelPrompt();
      expect(published, isEmpty);
    });

    test('cancelled prompt resolves with cancelled stopReason', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.cancelPrompt();
      service.handleMessage(encode(promptResult(1, stopReason: 'cancelled')));

      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(1));
      expect(events[0], isA<RelayPromptComplete>());
      expect((events[0] as RelayPromptComplete).stopReason, 'cancelled');
    });
  });

  group('dispose', () {
    test('closes active stream', () async {
      final stream = service.sendPrompt('Hi');
      final events = <RelayChatEvent>[];
      stream.listen(events.add);

      service.dispose();

      await Future<void>.delayed(Duration.zero);
      expect(service.isBusy, isFalse);
    });

    test('is safe to call when idle', () {
      service.dispose(); // should not throw
    });
  });

  group('session/update without active stream', () {
    test('ignores updates when no prompt is in-flight', () {
      // Should not crash
      service.handleMessage(encode(contentChunk('orphan')));
    });
  });
}
