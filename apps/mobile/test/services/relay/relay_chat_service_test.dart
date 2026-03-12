import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/relay/relay_chat_service.dart';

void main() {
  /// Encode a JSON-RPC message as a Uint8List (simulates data channel payload).
  Uint8List encode(Map<String, dynamic> json) {
    return Uint8List.fromList(utf8.encode(jsonEncode(json)));
  }

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
      // First prompt — send and complete
      final stream1 = service.sendPrompt('First');
      // Complete it so we can send another
      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'id': 1,
        'result': {'stopReason': 'completed'},
      }));
      // Drain the stream
      stream1.drain<void>();

      // Second prompt
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

      // Complete the prompt
      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'id': 1,
        'result': {'stopReason': 'completed'},
      }));

      // Give the stream controller time to close
      expectLater(
        Future.delayed(Duration.zero, () => service.isBusy),
        completion(isFalse),
      );
    });
  });

  group('streaming response', () {
    test('emits content deltas from session/update', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      // Simulate streamed chunks
      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'updates': [
            {
              'kind': 'content_chunk',
              'content': {'type': 'text', 'text': 'Hello'},
            },
          ],
        },
      }));

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'updates': [
            {
              'kind': 'content_chunk',
              'content': {'type': 'text', 'text': ' world'},
            },
          ],
        },
      }));

      // Complete
      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'id': 1,
        'result': {'stopReason': 'completed'},
      }));

      // Wait for stream to close
      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(3));
      expect(events[0], isA<RelayContentDelta>());
      expect((events[0] as RelayContentDelta).text, 'Hello');
      expect(events[1], isA<RelayContentDelta>());
      expect((events[1] as RelayContentDelta).text, ' world');
      expect(events[2], isA<RelayPromptComplete>());
      expect((events[2] as RelayPromptComplete).stopReason, 'completed');
    });

    test('emits multiple updates from a single notification', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'updates': [
            {
              'kind': 'content_chunk',
              'content': {'type': 'text', 'text': 'A'},
            },
            {
              'kind': 'content_chunk',
              'content': {'type': 'text', 'text': 'B'},
            },
          ],
        },
      }));

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'id': 1,
        'result': {'stopReason': 'completed'},
      }));

      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(3));
      expect((events[0] as RelayContentDelta).text, 'A');
      expect((events[1] as RelayContentDelta).text, 'B');
    });

    test('ignores unknown update kinds gracefully', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'updates': [
            {'kind': 'future_feature', 'data': 'something'},
            {
              'kind': 'content_chunk',
              'content': {'type': 'text', 'text': 'kept'},
            },
          ],
        },
      }));

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'id': 1,
        'result': {'stopReason': 'completed'},
      }));

      await Future<void>.delayed(Duration.zero);

      // Only content_chunk + complete — unknown kind skipped
      expect(events, hasLength(2));
      expect((events[0] as RelayContentDelta).text, 'kept');
    });

    test('ignores empty text in content_chunk', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'updates': [
            {
              'kind': 'content_chunk',
              'content': {'type': 'text', 'text': ''},
            },
          ],
        },
      }));

      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'id': 1,
        'result': {'stopReason': 'completed'},
      }));

      await Future<void>.delayed(Duration.zero);

      // Only complete — empty chunk skipped
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

      // Send response with wrong ID
      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'id': 999,
        'result': {'stopReason': 'completed'},
      }));

      // Stream should still be open (no events)
      await Future<void>.delayed(Duration.zero);
      expect(events, isEmpty);
      expect(service.isBusy, isTrue);

      // Correct response closes it
      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'id': 1,
        'result': {'stopReason': 'completed'},
      }));

      await Future<void>.delayed(Duration.zero);
      expect(events, hasLength(1));
    });

    test('ignores malformed messages', () async {
      final events = <RelayChatEvent>[];
      final stream = service.sendPrompt('Hi');
      stream.listen(events.add);

      // Various malformed inputs — none should crash
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
      published.clear(); // clear the prompt

      service.cancelPrompt();

      expect(published, hasLength(1));
      final json = jsonDecode(utf8.decode(published.first));
      expect(json['jsonrpc'], '2.0');
      expect(json['method'], 'session/cancel');
      expect(json.containsKey('id'), isFalse); // notification, no ID
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

      // Relay responds with cancelled
      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'id': 1,
        'result': {'stopReason': 'cancelled'},
      }));

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
      service.handleMessage(encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'updates': [
            {
              'kind': 'content_chunk',
              'content': {'type': 'text', 'text': 'orphan'},
            },
          ],
        },
      }));
      // No assertion — just verifying it doesn't throw
    });
  });
}
