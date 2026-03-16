import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:livekit_client/livekit_client.dart' show Room;
import 'package:fletcher/services/livekit_service.dart';

// ---------------------------------------------------------------------------
// Tests for background disconnect / reconnect logic (TASK-074 / BUG-034)
//
// Strategy: create a test subclass that overrides the three methods with
// heavy platform dependencies (disconnect, connectWithDynamicRoom,
// updateBackgroundNotification) so tests run without a real LiveKit room,
// foreground service, or network stack.
//
// LiveKitService exposes @visibleForTesting members for controlled state
// injection:
//   - backgroundDisconnectedForTest (getter + setter): read/write the flag
//   - voiceModeActiveForTest (setter): control chat vs voice mode
//   - roomForTest (setter): inject a Room? (used in connected-state tests)
//
// NOTE: Tests that require _room != null (i.e. the full onAppBackgrounded
// chat-mode path) need a real Room object, which itself requires LiveKit
// platform channels. Following the project convention (see
// audio_device_recovery_test.dart), those paths are verified via field
// tests. We test here: flag lifecycle, guard conditions, and the
// onAppResumed reconnect branch.
//
// ConnectivityService._init() calls connectivity_plus via a platform
// channel. We register a minimal mock handler so construction succeeds.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test subclass
// ---------------------------------------------------------------------------

class _TestableLiveKitService extends LiveKitService {
  bool disconnectCalled = false;
  bool connectWithDynamicRoomCalled = false;
  bool? lastDisconnectPreserveTranscripts;

  @override
  Future<void> disconnect({bool preserveTranscripts = false}) async {
    disconnectCalled = true;
    lastDisconnectPreserveTranscripts = preserveTranscripts;
    // No-op: avoids LiveKit SDK, FlutterForegroundTask, and other platform deps.
  }

  @override
  Future<void> connectWithDynamicRoom({
    required List<String> urls,
    required int tokenServerPort,
    required int departureTimeoutS,
  }) async {
    connectWithDynamicRoomCalled = true;
    // No-op: avoids network calls and LiveKit SDK.
  }

  @override
  void updateBackgroundNotification() {
    // No-op: avoids FlutterForegroundTask platform channel.
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Register stub method-channel handlers needed to construct LiveKitService
/// without hitting real platform plugins.
///
/// connectivity_plus queries the platform on construction; we stub it to
/// return "wifi" so ConnectivityService._init() completes without error.
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
  // 1. Initial flag state
  // -------------------------------------------------------------------------

  group('_backgroundDisconnected initial state', () {
    test('flag is false on construction', () {
      final svc = _TestableLiveKitService();
      expect(svc.backgroundDisconnectedForTest, isFalse);
      svc.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // 2. onAppBackgrounded — early-return guards (no Room required)
  // -------------------------------------------------------------------------

  group('onAppBackgrounded — early-return guards', () {
    late _TestableLiveKitService svc;

    setUp(() => svc = _TestableLiveKitService());
    tearDown(() => svc.dispose());

    test('does nothing when room is null (disconnected)', () {
      // _room is null by default — onAppBackgrounded returns immediately.
      svc.onAppBackgrounded(isScreenLocked: false);

      expect(svc.backgroundDisconnectedForTest, isFalse,
          reason: 'flag must not be set when there is no active room');
      expect(svc.disconnectCalled, isFalse);
    });

    test('disconnects in chat mode even when screen is locked (BUG-042)', () {
      svc.voiceModeActiveForTest = false; // chat mode
      svc.roomForTest = Room(); // need a non-null room to pass null guard
      // Chat mode always disconnects — screen lock only protects voice mode.
      svc.onAppBackgrounded(isScreenLocked: true);

      expect(svc.backgroundDisconnectedForTest, isTrue,
          reason: 'chat mode must disconnect regardless of screen lock state');
      expect(svc.disconnectCalled, isTrue);
    });

    test('does nothing when screen is locked — voice mode', () {
      svc.voiceModeActiveForTest = true; // voice mode
      svc.roomForTest = Room(); // need a non-null room to pass null guard
      svc.onAppBackgrounded(isScreenLocked: true);

      expect(svc.backgroundDisconnectedForTest, isFalse);
      expect(svc.disconnectCalled, isFalse);
    });
  });

  // -------------------------------------------------------------------------
  // 3. onAppResumed — reconnect-after-background-disconnect path
  //
  // We drive _backgroundDisconnected directly via the @visibleForTesting
  // setter, bypassing the need to call onAppBackgrounded with a real Room.
  // This tests the flag-lifecycle contract independently.
  // -------------------------------------------------------------------------

  group('onAppResumed — reconnect after background disconnect', () {
    late _TestableLiveKitService svc;

    setUp(() => svc = _TestableLiveKitService());
    tearDown(() => svc.dispose());

    test('clears flag when _backgroundDisconnected is true', () {
      svc.backgroundDisconnectedForTest = true;

      svc.onAppResumed();

      expect(svc.backgroundDisconnectedForTest, isFalse,
          reason: 'flag must be cleared on resume so a second resume is a no-op');
    });

    test('calls connectWithDynamicRoom when _backgroundDisconnected is true', () {
      svc.backgroundDisconnectedForTest = true;

      svc.onAppResumed();

      expect(svc.connectWithDynamicRoomCalled, isTrue,
          reason: 'app must reconnect automatically after a background disconnect');
    });

    test('does NOT call connectWithDynamicRoom when flag is false', () {
      // Default state: no background disconnect occurred.
      svc.onAppResumed();

      expect(svc.connectWithDynamicRoomCalled, isFalse);
    });

    test('does NOT call disconnect on resume (flag path is reconnect only)', () {
      svc.backgroundDisconnectedForTest = true;

      svc.onAppResumed();

      expect(svc.disconnectCalled, isFalse);
    });

    test('flag lifecycle: set then cleared on resume', () {
      // Simulate the full lifecycle:
      //   1. Background disconnect sets the flag (via @visibleForTesting setter)
      //   2. Resume clears it
      //   3. A second resume call is a no-op (flag already false)

      svc.backgroundDisconnectedForTest = true;
      expect(svc.backgroundDisconnectedForTest, isTrue);

      svc.onAppResumed();
      expect(svc.backgroundDisconnectedForTest, isFalse);
      expect(svc.connectWithDynamicRoomCalled, isTrue);

      // Second resume: flag already false → no reconnect
      svc.connectWithDynamicRoomCalled = false; // reset tracker
      svc.onAppResumed();
      expect(svc.connectWithDynamicRoomCalled, isFalse,
          reason: 'second resume must not trigger a second reconnect');
    });
  });

  // -------------------------------------------------------------------------
  // 4. @visibleForTesting setter contract
  // -------------------------------------------------------------------------

  group('@visibleForTesting setters', () {
    late _TestableLiveKitService svc;

    setUp(() => svc = _TestableLiveKitService());
    tearDown(() => svc.dispose());

    test('voiceModeActiveForTest setter correctly controls voice mode', () {
      expect(svc.isVoiceModeActive, isFalse,
          reason: 'default mode is chat (voiceModeActive == false)');

      svc.voiceModeActiveForTest = true;
      expect(svc.isVoiceModeActive, isTrue);

      svc.voiceModeActiveForTest = false;
      expect(svc.isVoiceModeActive, isFalse);
    });

    test('backgroundDisconnectedForTest setter round-trips correctly', () {
      svc.backgroundDisconnectedForTest = true;
      expect(svc.backgroundDisconnectedForTest, isTrue);

      svc.backgroundDisconnectedForTest = false;
      expect(svc.backgroundDisconnectedForTest, isFalse);
    });
  });
}
