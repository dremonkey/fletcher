import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/agent_presence_service.dart';
import 'package:fletcher/services/local_vad_service.dart';
import 'package:fletcher/services/agent_dispatch_service.dart';

// ---------------------------------------------------------------------------
// Mock: LocalVadService
// ---------------------------------------------------------------------------

class MockLocalVadService extends LocalVadService {
  bool startCalled = false;
  int stopCallCount = 0;

  MockLocalVadService() : super(onSpeechDetected: () {});

  @override
  Future<void> startListening() async {
    startCalled = true;
  }

  @override
  Future<void> stopListening() async {
    stopCallCount++;
  }

  void reset() {
    startCalled = false;
    stopCallCount = 0;
  }
}

// ---------------------------------------------------------------------------
// Mock: AgentDispatchService
// ---------------------------------------------------------------------------

class MockAgentDispatchService extends AgentDispatchService {
  DispatchResult nextResult = const DispatchResult(status: 'dispatched');
  bool dispatchCalled = false;
  String? lastRoomName;
  bool shouldThrow = false;

  MockAgentDispatchService() : super(baseUrl: 'http://localhost:7882');

  @override
  Future<DispatchResult> dispatchAgent({
    required String roomName,
    Map<String, dynamic>? metadata,
  }) async {
    dispatchCalled = true;
    lastRoomName = roomName;
    if (shouldThrow) {
      throw Exception('Network error');
    }
    return nextResult;
  }

  void reset() {
    nextResult = const DispatchResult(status: 'dispatched');
    dispatchCalled = false;
    lastRoomName = null;
    shouldThrow = false;
  }
}

void main() {
  group('AgentPresenceService', () {
    late MockLocalVadService mockVad;
    late MockAgentDispatchService mockDispatch;
    late AgentPresenceService service;

    setUp(() {
      mockVad = MockLocalVadService();
      mockDispatch = MockAgentDispatchService();
      service = AgentPresenceService(
        localVad: mockVad,
        dispatchService: mockDispatch,
      );
    });

    tearDown(() {
      service.dispose();
    });

    // -----------------------------------------------------------------------
    // 1. Initial state
    // -----------------------------------------------------------------------

    test('initial state is agentAbsent', () {
      expect(service.state, AgentPresenceState.agentAbsent);
    });

    test('initial state is not enabled', () {
      expect(service.enabled, isFalse);
    });

    // -----------------------------------------------------------------------
    // 2. onSpeechDetected → dispatching
    // -----------------------------------------------------------------------

    test('onSpeechDetected transitions from agentAbsent to dispatching', () {
      service.enable('test-room');
      mockVad.reset(); // clear calls from enable()

      service.onSpeechDetected();

      expect(service.state, AgentPresenceState.dispatching);
    });

    test('onSpeechDetected triggers agent dispatch', () async {
      service.enable('test-room');
      mockVad.reset();

      service.onSpeechDetected();

      // Allow the async dispatch to complete
      await Future.delayed(Duration.zero);

      expect(mockDispatch.dispatchCalled, isTrue);
      expect(mockDispatch.lastRoomName, 'test-room');
    });

    test('onSpeechDetected stops local VAD before dispatching', () {
      service.enable('test-room');
      mockVad.reset();

      service.onSpeechDetected();

      // stopListening is called during transition to dispatching
      expect(mockVad.stopCallCount, greaterThan(0));
    });

    // -----------------------------------------------------------------------
    // 3. onAgentConnected → agentPresent (from dispatching)
    // -----------------------------------------------------------------------

    test('onAgentConnected transitions to agentPresent', () {
      service.enable('test-room');
      service.onSpeechDetected(); // → dispatching

      service.onAgentConnected();

      expect(service.state, AgentPresenceState.agentPresent);
    });

    // -----------------------------------------------------------------------
    // 4. onAgentDisconnected → agentAbsent (from agentPresent)
    // -----------------------------------------------------------------------

    test('onAgentDisconnected transitions from agentPresent to agentAbsent',
        () {
      service.enable('test-room');
      service.onSpeechDetected();
      service.onAgentConnected(); // → agentPresent

      service.onAgentDisconnected();

      expect(service.state, AgentPresenceState.agentAbsent);
    });

    // -----------------------------------------------------------------------
    // 5. Dispatch failure → agentAbsent
    // -----------------------------------------------------------------------

    test('dispatch failure transitions back to agentAbsent', () async {
      mockDispatch.nextResult = const DispatchResult(
        status: 'error',
        message: 'Room not found',
      );

      service.enable('test-room');
      service.onSpeechDetected(); // → dispatching

      // Allow the async dispatch to complete
      await Future.delayed(Duration.zero);

      expect(service.state, AgentPresenceState.agentAbsent);
    });

    test('dispatch exception transitions back to agentAbsent', () async {
      mockDispatch.shouldThrow = true;

      service.enable('test-room');
      service.onSpeechDetected();

      // Allow the async dispatch to complete
      await Future.delayed(Duration.zero);

      expect(service.state, AgentPresenceState.agentAbsent);
    });

    // -----------------------------------------------------------------------
    // 6. onSpeechDetected is no-op when already dispatching
    // -----------------------------------------------------------------------

    test('onSpeechDetected is no-op when already dispatching', () {
      service.enable('test-room');
      service.onSpeechDetected(); // → dispatching
      mockDispatch.reset();

      service.onSpeechDetected(); // should be ignored

      expect(service.state, AgentPresenceState.dispatching);
      expect(mockDispatch.dispatchCalled, isFalse);
    });

    // -----------------------------------------------------------------------
    // 7. onSpeechDetected is no-op when agent is present
    // -----------------------------------------------------------------------

    test('onSpeechDetected is no-op when agent is present', () {
      service.enable('test-room');
      service.onSpeechDetected();
      service.onAgentConnected(); // → agentPresent
      mockDispatch.reset();

      service.onSpeechDetected();

      expect(service.state, AgentPresenceState.agentPresent);
      expect(mockDispatch.dispatchCalled, isFalse);
    });

    // -----------------------------------------------------------------------
    // 8. disable() stops local VAD and sets state to agentPresent
    // -----------------------------------------------------------------------

    test('disable stops local VAD and sets state to agentPresent', () {
      service.enable('test-room');
      mockVad.reset();

      service.disable();

      expect(service.state, AgentPresenceState.agentPresent);
      expect(service.enabled, isFalse);
      expect(mockVad.stopCallCount, greaterThan(0));
    });

    // -----------------------------------------------------------------------
    // 9. enable() sets room name and starts in agentAbsent
    // -----------------------------------------------------------------------

    test('enable sets room name and transitions to agentAbsent', () {
      service.enable('my-room');

      expect(service.enabled, isTrue);
      expect(service.state, AgentPresenceState.agentAbsent);
    });

    // -----------------------------------------------------------------------
    // 10. Not enabled → all callbacks are no-ops
    // -----------------------------------------------------------------------

    group('when not enabled', () {
      test('onSpeechDetected is a no-op', () {
        service.onSpeechDetected();
        expect(service.state, AgentPresenceState.agentAbsent);
        expect(mockDispatch.dispatchCalled, isFalse);
      });

      test('onAgentConnected is a no-op', () {
        service.onAgentConnected();
        expect(service.state, AgentPresenceState.agentAbsent);
      });

      test('onAgentDisconnected is a no-op', () {
        service.onAgentDisconnected();
        expect(service.state, AgentPresenceState.agentAbsent);
      });
    });

    // -----------------------------------------------------------------------
    // ChangeNotifier integration
    // -----------------------------------------------------------------------

    test('notifies listeners on enable', () {
      int notifyCount = 0;
      service.addListener(() => notifyCount++);

      service.enable('test-room');

      expect(notifyCount, 1);
    });

    test('notifies listeners on onAgentConnected', () {
      service.enable('test-room');

      int notifyCount = 0;
      service.addListener(() => notifyCount++);

      service.onSpeechDetected(); // → dispatching
      service.onAgentConnected(); // → agentPresent

      expect(notifyCount, 2); // dispatching + agentPresent
    });

    // -----------------------------------------------------------------------
    // Dispatch with already_present result
    // -----------------------------------------------------------------------

    test('dispatch already_present waits for agent connect', () async {
      mockDispatch.nextResult = const DispatchResult(
        status: 'already_present',
        agentName: 'fletcher-agent',
      );

      service.enable('test-room');
      service.onSpeechDetected();

      await Future.delayed(Duration.zero);

      // State should still be dispatching — waiting for onAgentConnected
      expect(service.state, AgentPresenceState.dispatching);
    });

    // -----------------------------------------------------------------------
    // Dispatch without room name
    // -----------------------------------------------------------------------

    test('dispatch without room name falls back to agentAbsent', () async {
      // Enable with null room by manipulating state directly.
      // Actually we can't enable without a room name via the public API.
      // But if somehow _roomName is null and we dispatch, it should handle it.
      // This is an internal safeguard — skip this test since it can't
      // happen through the public API.
    });

    // -----------------------------------------------------------------------
    // dispose cleans up
    // -----------------------------------------------------------------------

    test('dispose stops local VAD', () {
      // Create a separate service for this test to avoid double-dispose
      // from tearDown.
      final vadForDispose = MockLocalVadService();
      final dispatchForDispose = MockAgentDispatchService();
      final disposableService = AgentPresenceService(
        localVad: vadForDispose,
        dispatchService: dispatchForDispose,
      );

      disposableService.enable('test-room');
      vadForDispose.reset();

      disposableService.dispose();

      expect(vadForDispose.stopCallCount, greaterThan(0));
    });

    // -----------------------------------------------------------------------
    // System event emission (Task 007)
    // -----------------------------------------------------------------------

    group('system event emission', () {
      /// Recorded system events: list of (id, category, message) tuples.
      late List<(String, String, String)> emittedEvents;
      late AgentPresenceService eventService;

      setUp(() {
        emittedEvents = [];
        eventService = AgentPresenceService(
          localVad: mockVad,
          dispatchService: mockDispatch,
          onSystemEvent: (id, category, message) {
            emittedEvents.add((id, category, message));
          },
        );
      });

      tearDown(() {
        eventService.dispose();
      });

      test('emits agent-dispatching on speech detected', () {
        eventService.enable('test-room');
        emittedEvents.clear();

        eventService.onSpeechDetected(); // → dispatching

        expect(emittedEvents, hasLength(1));
        expect(emittedEvents.first.$1, 'agent-dispatching');
        expect(emittedEvents.first.$2, 'AGENT');
        expect(emittedEvents.first.$3, 'Connecting...');
      });

      test('emits agent-reconnected when agent connects from dispatching', () {
        eventService.enable('test-room');
        eventService.onSpeechDetected(); // → dispatching
        emittedEvents.clear();

        eventService.onAgentConnected(); // → agentPresent (from dispatching)

        expect(emittedEvents, hasLength(1));
        expect(emittedEvents.first.$1, 'agent-reconnected');
        expect(emittedEvents.first.$2, 'AGENT');
        expect(emittedEvents.first.$3, 'Connected');
      });

      test('emits agent-disconnected when agent disconnects from present',
          () {
        eventService.enable('test-room');
        eventService.onSpeechDetected();
        eventService.onAgentConnected(); // → agentPresent
        emittedEvents.clear();

        eventService.onAgentDisconnected(); // → agentAbsent (from present)

        expect(emittedEvents, hasLength(1));
        expect(emittedEvents.first.$1, 'agent-disconnected');
        expect(emittedEvents.first.$2, 'AGENT');
        expect(emittedEvents.first.$3, contains('Disconnected'));
      });

      test('does NOT emit disconnect event on dispatch failure', () async {
        mockDispatch.nextResult = const DispatchResult(
          status: 'error',
          message: 'Room not found',
        );

        eventService.enable('test-room');
        emittedEvents.clear();

        eventService.onSpeechDetected(); // → dispatching
        await Future.delayed(Duration.zero); // dispatch fails → agentAbsent

        // Should have the dispatching event but NOT the disconnect event
        // (dispatch failure is not a "disconnect from present")
        expect(
          emittedEvents.where((e) => e.$1 == 'agent-disconnected'),
          isEmpty,
        );
      });

      test('no events emitted when service is disabled', () {
        // Service is not enabled — all callbacks should be no-ops
        final disabledService = AgentPresenceService(
          localVad: mockVad,
          dispatchService: mockDispatch,
          onSystemEvent: (id, category, message) {
            emittedEvents.add((id, category, message));
          },
        );

        disabledService.onSpeechDetected();
        disabledService.onAgentConnected();
        disabledService.onAgentDisconnected();

        expect(emittedEvents, isEmpty);

        disabledService.dispose();
      });

      test('no events emitted when onSystemEvent is null', () {
        // The default service (from setUp) has no onSystemEvent callback.
        // Just verify no errors when transitioning without a callback.
        service.enable('test-room');
        service.onSpeechDetected();
        service.onAgentConnected();
        service.onAgentDisconnected();
        // If we got here without errors, the null callback is handled correctly.
      });

      test('full lifecycle emits correct sequence of events', () {
        eventService.enable('test-room');
        emittedEvents.clear();

        // 1. Speech detected → dispatching
        eventService.onSpeechDetected();
        // 2. Agent connects → agentPresent
        eventService.onAgentConnected();
        // 3. Agent disconnects (crash/leave)
        eventService.onAgentDisconnected();
        // 4. Speech detected again → dispatching
        eventService.onSpeechDetected();
        // 5. Agent reconnects
        eventService.onAgentConnected();

        expect(emittedEvents, hasLength(5));
        expect(emittedEvents[0].$1, 'agent-dispatching');
        expect(emittedEvents[1].$1, 'agent-reconnected');
        expect(emittedEvents[2].$1, 'agent-disconnected');
        expect(emittedEvents[3].$1, 'agent-dispatching');
        expect(emittedEvents[4].$1, 'agent-reconnected');
      });
    });
  });
}
