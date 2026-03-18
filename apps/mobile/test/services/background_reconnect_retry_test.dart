import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/models/conversation_state.dart';
import 'package:fletcher/services/livekit_service.dart';

// ---------------------------------------------------------------------------
// Tests for background reconnect retry logic (BUG-044)
//
// Verifies that _reconnectAfterBackground():
// - Retries up to 3 times with exponential backoff
// - Stops retrying on success (non-error state)
// - Can be cancelled by setting _backgroundReconnecting = false
// - Engages tryReconnect() after all retries are exhausted
//
// Uses a test subclass with configurable failure count. The subclass uses
// stateStatusForTest to simulate error/success state transitions, mirroring
// what the real connectWithDynamicRoom does in its catch block.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test subclass with configurable failure behavior
// ---------------------------------------------------------------------------

class _TestableLiveKitService extends LiveKitService {
  int connectCallCount = 0;
  bool disconnectCalled = false;
  bool tryReconnectCalled = false;

  /// Number of connectWithDynamicRoom calls that should fail (set error state)
  /// before succeeding. Set to a high number (e.g. 99) to always fail.
  int failuresBeforeSuccess;

  _TestableLiveKitService({this.failuresBeforeSuccess = 0});

  @override
  Future<void> disconnect({bool preserveTranscripts = false}) async {
    disconnectCalled = true;
  }

  @override
  Future<void> connectWithDynamicRoom({
    required List<String> urls,
    required int tokenServerPort,
    required int departureTimeoutS,
  }) async {
    connectCallCount++;
    if (connectCallCount <= failuresBeforeSuccess) {
      // Simulate failure: set error state via the @visibleForTesting setter.
      // This mirrors the real catch block in connectWithDynamicRoom which
      // calls _updateState(status: ConversationStatus.error, ...).
      stateStatusForTest = ConversationStatus.error;
    } else {
      // Simulate success: set idle state.
      stateStatusForTest = ConversationStatus.idle;
    }
  }

  @override
  Future<void> tryReconnect() async {
    tryReconnectCalled = true;
    // No-op: avoids network calls.
  }

  @override
  void updateBackgroundNotification() {
    // No-op: avoids FlutterForegroundTask platform channel.
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

void _stubConnectivityChannel() {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(
    const MethodChannel('dev.fluttercommunity.plus/connectivity'),
    (MethodCall call) async {
      if (call.method == 'check') return ['wifi'];
      return null;
    },
  );
}

void _clearConnectivityStub() {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(
    const MethodChannel('dev.fluttercommunity.plus/connectivity'),
    null,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(_stubConnectivityChannel);
  tearDown(_clearConnectivityStub);

  // -------------------------------------------------------------------------
  // 1. Immediate success — no retries needed
  // -------------------------------------------------------------------------

  group('_reconnectAfterBackground — immediate success', () {
    late _TestableLiveKitService svc;

    setUp(() => svc = _TestableLiveKitService(failuresBeforeSuccess: 0));
    tearDown(() => svc.dispose());

    test('calls connectWithDynamicRoom once and stops', () async {
      await svc.reconnectAfterBackground();

      expect(svc.connectCallCount, equals(1),
          reason: 'should call connectWithDynamicRoom exactly once when first attempt succeeds');
      expect(svc.backgroundReconnectingForTest, isFalse,
          reason: 'flag must be cleared after successful reconnect');
      expect(svc.tryReconnectCalled, isFalse,
          reason: 'tryReconnect should not be engaged on success');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Success on second attempt — one retry
  // -------------------------------------------------------------------------

  group('_reconnectAfterBackground — success after one retry', () {
    late _TestableLiveKitService svc;

    setUp(() => svc = _TestableLiveKitService(failuresBeforeSuccess: 1));
    tearDown(() => svc.dispose());

    test('retries and succeeds on second attempt', () async {
      await svc.reconnectAfterBackground();

      expect(svc.connectCallCount, equals(2),
          reason: 'first attempt fails, second succeeds');
      expect(svc.backgroundReconnectingForTest, isFalse);
      expect(svc.tryReconnectCalled, isFalse,
          reason: 'tryReconnect should not be engaged when a retry succeeds');
    });
  });

  // -------------------------------------------------------------------------
  // 3. All retries exhausted — engages tryReconnect
  // -------------------------------------------------------------------------

  group('_reconnectAfterBackground — all retries exhausted', () {
    late _TestableLiveKitService svc;

    setUp(() => svc = _TestableLiveKitService(failuresBeforeSuccess: 99));
    tearDown(() => svc.dispose());

    test('makes 3 attempts then engages tryReconnect', () async {
      await svc.reconnectAfterBackground();

      expect(svc.connectCallCount, equals(3),
          reason: 'should attempt exactly 3 times (maxAttempts)');
      expect(svc.backgroundReconnectingForTest, isFalse,
          reason: 'flag must be cleared after exhaustion');
      expect(svc.tryReconnectCalled, isTrue,
          reason: 'should engage tryReconnect as fallback when all retries fail');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Success on third (last) attempt
  // -------------------------------------------------------------------------

  group('_reconnectAfterBackground — success on last attempt', () {
    late _TestableLiveKitService svc;

    setUp(() => svc = _TestableLiveKitService(failuresBeforeSuccess: 2));
    tearDown(() => svc.dispose());

    test('succeeds on the final attempt without engaging tryReconnect', () async {
      await svc.reconnectAfterBackground();

      expect(svc.connectCallCount, equals(3),
          reason: 'attempts 1 and 2 fail, attempt 3 succeeds');
      expect(svc.backgroundReconnectingForTest, isFalse);
      expect(svc.tryReconnectCalled, isFalse,
          reason: 'tryReconnect should not be called when the last attempt succeeds');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Cancellation — backgroundReconnecting cleared mid-loop
  // -------------------------------------------------------------------------

  group('_reconnectAfterBackground — cancellation', () {
    late _TestableLiveKitService svc;

    setUp(() => svc = _TestableLiveKitService(failuresBeforeSuccess: 99));
    tearDown(() => svc.dispose());

    test('stops retrying when backgroundReconnecting is set to false', () async {
      // Start the retry loop in the background (it has delays between attempts)
      final future = svc.reconnectAfterBackground();

      // Let the first attempt complete
      await Future.delayed(const Duration(milliseconds: 50));
      expect(svc.connectCallCount, equals(1),
          reason: 'first attempt should have completed');

      // Cancel by clearing the flag (simulates onAppBackgrounded)
      svc.backgroundReconnectingForTest = false;

      // Wait for the future to complete (it should exit early)
      await future;

      expect(svc.connectCallCount, equals(1),
          reason: 'should not have made additional attempts after cancellation');
      expect(svc.tryReconnectCalled, isFalse,
          reason: 'tryReconnect should not be called on cancellation');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Flag lifecycle
  // -------------------------------------------------------------------------

  group('_backgroundReconnecting flag', () {
    late _TestableLiveKitService svc;

    setUp(() => svc = _TestableLiveKitService());
    tearDown(() => svc.dispose());

    test('is false on construction', () {
      expect(svc.backgroundReconnectingForTest, isFalse);
    });

    test('setter round-trips correctly', () {
      svc.backgroundReconnectingForTest = true;
      expect(svc.backgroundReconnectingForTest, isTrue);
      svc.backgroundReconnectingForTest = false;
      expect(svc.backgroundReconnectingForTest, isFalse);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Integration: onAppResumed triggers _reconnectAfterBackground
  // -------------------------------------------------------------------------

  group('onAppResumed — uses retry method', () {
    late _TestableLiveKitService svc;

    setUp(() => svc = _TestableLiveKitService(failuresBeforeSuccess: 0));
    tearDown(() => svc.dispose());

    test('fires _reconnectAfterBackground on background disconnect', () async {
      svc.backgroundDisconnectedForTest = true;
      svc.onAppResumed();

      // Let the async reconnect complete
      await Future.delayed(const Duration(milliseconds: 100));

      expect(svc.connectCallCount, equals(1),
          reason: 'onAppResumed should trigger reconnect via _reconnectAfterBackground');
      expect(svc.backgroundDisconnectedForTest, isFalse,
          reason: 'flag should be cleared on resume');
    });

    test('double resume does not start two retry loops', () async {
      svc.backgroundDisconnectedForTest = true;
      svc.onAppResumed(); // clears flag, starts retry
      svc.onAppResumed(); // flag already false — no-op

      await Future.delayed(const Duration(milliseconds: 100));

      expect(svc.connectCallCount, equals(1),
          reason: 'second resume must not trigger a second reconnect');
    });
  });
}
