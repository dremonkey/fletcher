import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/relay/json_rpc.dart';

void main() {
  group('JsonRpcRequest', () {
    test('encodes request with params', () {
      final request = JsonRpcRequest(
        id: 1,
        method: 'session/prompt',
        params: {
          'prompt': [
            {'type': 'text', 'text': 'Hello'}
          ],
        },
      );

      final json = jsonDecode(utf8.decode(request.encode()));
      expect(json['jsonrpc'], '2.0');
      expect(json['id'], 1);
      expect(json['method'], 'session/prompt');
      expect(json['params']['prompt'][0]['text'], 'Hello');
    });

    test('encodes request without params', () {
      final request = JsonRpcRequest(id: 5, method: 'test/method');

      final json = jsonDecode(utf8.decode(request.encode()));
      expect(json['jsonrpc'], '2.0');
      expect(json['id'], 5);
      expect(json['method'], 'test/method');
      expect(json.containsKey('params'), isFalse);
    });
  });

  group('JsonRpcNotification', () {
    test('encodes notification with params', () {
      final notification = JsonRpcNotification(
        method: 'session/cancel',
        params: {},
      );

      final json = jsonDecode(utf8.decode(notification.encode()));
      expect(json['jsonrpc'], '2.0');
      expect(json['method'], 'session/cancel');
      expect(json.containsKey('id'), isFalse);
    });

    test('encodes notification without params', () {
      final notification = JsonRpcNotification(method: 'session/cancel');

      final json = jsonDecode(utf8.decode(notification.encode()));
      expect(json.containsKey('params'), isFalse);
    });
  });

  group('decodeJsonRpc', () {
    Uint8List _encode(Map<String, dynamic> json) {
      return Uint8List.fromList(utf8.encode(jsonEncode(json)));
    }

    test('decodes success response', () {
      final data = _encode({
        'jsonrpc': '2.0',
        'id': 1,
        'result': {'stopReason': 'completed'},
      });

      final msg = decodeJsonRpc(data);
      expect(msg, isA<JsonRpcResponse>());
      final resp = msg as JsonRpcResponse;
      expect(resp.id, 1);
      expect(resp.isError, isFalse);
      expect((resp.result as Map)['stopReason'], 'completed');
    });

    test('decodes error response', () {
      final data = _encode({
        'jsonrpc': '2.0',
        'id': 3,
        'error': {
          'code': -32010,
          'message': 'ACP connection lost',
          'data': {'detail': 'subprocess exited'},
        },
      });

      final msg = decodeJsonRpc(data);
      expect(msg, isA<JsonRpcResponse>());
      final resp = msg as JsonRpcResponse;
      expect(resp.id, 3);
      expect(resp.isError, isTrue);
      expect(resp.error!.code, -32010);
      expect(resp.error!.message, 'ACP connection lost');
      expect(resp.error!.data, isA<Map>());
    });

    test('decodes server notification', () {
      final data = _encode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'updates': [
            {
              'kind': 'content_chunk',
              'content': {'type': 'text', 'text': 'Hello'},
            }
          ],
        },
      });

      final msg = decodeJsonRpc(data);
      expect(msg, isA<JsonRpcServerNotification>());
      final notif = msg as JsonRpcServerNotification;
      expect(notif.method, 'session/update');
      expect(notif.params['updates'], isA<List>());
    });

    test('decodes notification without params', () {
      final data = _encode({
        'jsonrpc': '2.0',
        'method': 'some/event',
      });

      final msg = decodeJsonRpc(data);
      expect(msg, isA<JsonRpcServerNotification>());
      final notif = msg as JsonRpcServerNotification;
      expect(notif.params, isEmpty);
    });

    test('returns null for invalid JSON', () {
      final data = Uint8List.fromList(utf8.encode('not json'));
      expect(decodeJsonRpc(data), isNull);
    });

    test('returns null for non-2.0 version', () {
      final data = _encode({'jsonrpc': '1.0', 'id': 1, 'result': {}});
      expect(decodeJsonRpc(data), isNull);
    });

    test('returns null for ambiguous message', () {
      // Has method AND id but no result/error — not a valid response or notification
      final data = _encode({'jsonrpc': '2.0', 'id': 1, 'method': 'test'});
      // This has id + method but no result/error, so it's not a response.
      // It has an id, so it's not a notification either.
      expect(decodeJsonRpc(data), isNull);
    });

    test('returns null for empty object', () {
      final data = _encode({});
      expect(decodeJsonRpc(data), isNull);
    });
  });

  group('JsonRpcIdGenerator', () {
    test('generates incrementing IDs', () {
      final gen = JsonRpcIdGenerator();
      expect(gen.next(), 1);
      expect(gen.next(), 2);
      expect(gen.next(), 3);
    });
  });

  group('JsonRpcError', () {
    test('toString includes code and message', () {
      const error = JsonRpcError(code: -32603, message: 'Internal error');
      expect(error.toString(), 'JsonRpcError(-32603: Internal error)');
    });
  });
}
