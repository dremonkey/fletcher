import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:fletcher/services/agent_dispatch_service.dart';

void main() {
  group('AgentDispatchService', () {
    late AgentDispatchService service;

    group('successful dispatch', () {
      setUp(() {
        final mockClient = MockClient((request) async {
          expect(request.url.path, '/dispatch-agent');
          expect(request.headers['Content-Type'], 'application/json');

          final body = jsonDecode(request.body) as Map<String, dynamic>;
          expect(body['room_name'], 'test-room');

          return http.Response(
            jsonEncode({
              'status': 'dispatched',
              'agent_name': 'fletcher-agent',
              'dispatch_id': 'disp_123',
            }),
            200,
          );
        });

        service = AgentDispatchService(
          baseUrl: 'http://localhost:8080',
          client: mockClient,
        );
      });

      test('parses dispatched response correctly', () async {
        final result = await service.dispatchAgent(roomName: 'test-room');

        expect(result.status, 'dispatched');
        expect(result.isDispatched, isTrue);
        expect(result.isAlreadyPresent, isFalse);
        expect(result.isError, isFalse);
        expect(result.agentName, 'fletcher-agent');
        expect(result.dispatchId, 'disp_123');
      });
    });

    group('already_present response', () {
      setUp(() {
        final mockClient = MockClient((request) async {
          return http.Response(
            jsonEncode({
              'status': 'already_present',
              'agent_name': 'fletcher-agent',
              'message': 'Agent is already in the room',
            }),
            200,
          );
        });

        service = AgentDispatchService(
          baseUrl: 'http://localhost:8080',
          client: mockClient,
        );
      });

      test('parses already_present response correctly', () async {
        final result = await service.dispatchAgent(roomName: 'test-room');

        expect(result.status, 'already_present');
        expect(result.isAlreadyPresent, isTrue);
        expect(result.isDispatched, isFalse);
        expect(result.isError, isFalse);
        expect(result.agentName, 'fletcher-agent');
        expect(result.message, 'Agent is already in the room');
      });
    });

    group('error response', () {
      setUp(() {
        final mockClient = MockClient((request) async {
          return http.Response(
            jsonEncode({
              'status': 'error',
              'message': 'Room not found',
            }),
            404,
          );
        });

        service = AgentDispatchService(
          baseUrl: 'http://localhost:8080',
          client: mockClient,
        );
      });

      test('parses error response correctly', () async {
        final result = await service.dispatchAgent(roomName: 'nonexistent');

        expect(result.status, 'error');
        expect(result.isError, isTrue);
        expect(result.isDispatched, isFalse);
        expect(result.message, 'Room not found');
      });
    });

    group('network error', () {
      setUp(() {
        final mockClient = MockClient((request) async {
          throw Exception('Connection refused');
        });

        service = AgentDispatchService(
          baseUrl: 'http://localhost:8080',
          client: mockClient,
        );
      });

      test('returns error result on network failure', () async {
        final result = await service.dispatchAgent(roomName: 'test-room');

        expect(result.isError, isTrue);
        expect(result.status, 'error');
        expect(result.message, contains('Connection refused'));
      });
    });

    group('request body', () {
      test('includes metadata when provided', () async {
        Map<String, dynamic>? capturedBody;

        final mockClient = MockClient((request) async {
          capturedBody = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            jsonEncode({'status': 'dispatched'}),
            200,
          );
        });

        service = AgentDispatchService(
          baseUrl: 'http://localhost:8080',
          client: mockClient,
        );

        await service.dispatchAgent(
          roomName: 'test-room',
          metadata: {'source': 'vad', 'priority': 'high'},
        );

        expect(capturedBody!['room_name'], 'test-room');
        expect(capturedBody!['metadata'], {
          'source': 'vad',
          'priority': 'high',
        });
      });

      test('omits metadata when not provided', () async {
        Map<String, dynamic>? capturedBody;

        final mockClient = MockClient((request) async {
          capturedBody = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            jsonEncode({'status': 'dispatched'}),
            200,
          );
        });

        service = AgentDispatchService(
          baseUrl: 'http://localhost:8080',
          client: mockClient,
        );

        await service.dispatchAgent(roomName: 'test-room');

        expect(capturedBody!['room_name'], 'test-room');
        expect(capturedBody!.containsKey('metadata'), isFalse);
      });
    });

    group('DispatchResult', () {
      test('defaults to error when status is missing from response', () async {
        final mockClient = MockClient((request) async {
          return http.Response(
            jsonEncode({}),
            200,
          );
        });

        service = AgentDispatchService(
          baseUrl: 'http://localhost:8080',
          client: mockClient,
        );

        final result = await service.dispatchAgent(roomName: 'test-room');
        expect(result.status, 'error');
        expect(result.isError, isTrue);
      });
    });
  });
}
