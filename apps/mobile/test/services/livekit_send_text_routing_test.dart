/// Tests verifying T30.03: mobile routes typed text via relay in both modes.
///
/// Background: Before T30.03, voice mode sent 'text_message' on ganglia-events
/// and only text mode used the relay.  After T30.03, sendTextMessage() always
/// calls _sendViaRelay() regardless of TextInputMode.
///
/// LiveKitService cannot be instantiated in unit tests (requires LiveKit SDK
/// and a real room).  These tests verify:
///
/// 1. The relay path (RelayChatService.sendPrompt) produces a correct
///    session/prompt RPC — which is what both modes now use.
///
/// 2. RelayChatService is initialized unconditionally at room connect and is
///    available regardless of the current TextInputMode.
///
/// Source-level verification that voice mode no longer sends 'text_message'
/// on ganglia-events is provided in the voice agent spec:
///   apps/voice-agent/src/agent-ganglia-events.spec.ts
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/relay/relay_chat_service.dart';

void main() {
  late List<Uint8List> published;
  late RelayChatService relay;

  setUp(() {
    published = [];
    relay = RelayChatService(
      publish: (data) async => published.add(data),
    );
  });

  tearDown(() {
    relay.dispose();
  });

  // ---------------------------------------------------------------------------
  // session/prompt routing — the output path for both text and voice mode
  // ---------------------------------------------------------------------------

  group('relay send path (T30.03 — both modes route here)', () {
    test('sendPrompt publishes session/prompt on relay topic', () {
      relay.sendPrompt('Hello from voice mode');

      expect(published, hasLength(1));
      final json =
          jsonDecode(utf8.decode(published.first)) as Map<String, dynamic>;
      expect(json['method'], 'session/prompt');
      expect(json['jsonrpc'], '2.0');
    });

    test('session/prompt carries the user text as a text content block', () {
      relay.sendPrompt('What is the weather?');

      final json =
          jsonDecode(utf8.decode(published.first)) as Map<String, dynamic>;
      final prompt = json['params']['prompt'] as List<dynamic>;
      expect(prompt, hasLength(1));
      expect(prompt[0]['type'], 'text');
      expect(prompt[0]['text'], 'What is the weather?');
    });

    test('text message does NOT produce a text_message event', () {
      // Before T30.03, voice mode sent {type: text_message, text: ...} via
      // ganglia-events (_sendEvent).  This test asserts the relay path never
      // produces that shape — only session/prompt is sent.
      relay.sendPrompt('Hello');

      final json =
          jsonDecode(utf8.decode(published.first)) as Map<String, dynamic>;
      expect(json.containsKey('type'), isFalse,
          reason: 'Relay publishes RPC, not event-bus events');
      expect(json['method'], 'session/prompt');
    });
  });

  // ---------------------------------------------------------------------------
  // RelayChatService initialization — always available, mode-independent
  // ---------------------------------------------------------------------------

  group('RelayChatService availability (T30.03)', () {
    test('service is ready immediately after construction (no mode gate)', () {
      // _initRelayChatService() is called unconditionally at room connect.
      // Verify the service is operational without any TextInputMode check.
      expect(relay.isBusy, isFalse);
      relay.sendPrompt('test');
      expect(relay.isBusy, isTrue);
    });

    test('service handles ACP updates in both modes (relay topic active)', () async {
      // Simulate a session/update arriving from the relay — this is what
      // voice mode responses look like after T30.01/T30.03: relay publishes
      // ACP updates on the relay topic, mobile parses them via RelayChatService.
      final events = <RelayChatEvent>[];
      final stream = relay.sendPrompt('Hi');
      stream.listen(events.add);

      relay.handleMessage(_encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'sessionId': 'sess_test',
          'update': {
            'sessionUpdate': 'agent_message_chunk',
            'content': {'type': 'text', 'text': 'Voice mode reply'},
          },
        },
      }));
      relay.handleMessage(_encode({
        'jsonrpc': '2.0',
        'id': 1,
        'result': {'stopReason': 'end_turn'},
      }));

      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(2));
      expect(events[0], isA<RelayContentDelta>());
      expect((events[0] as RelayContentDelta).text, 'Voice mode reply');
      expect(events[1], isA<RelayPromptComplete>());
    });
  });
}

Uint8List _encode(Map<String, dynamic> json) =>
    Uint8List.fromList(utf8.encode(jsonEncode(json)));
