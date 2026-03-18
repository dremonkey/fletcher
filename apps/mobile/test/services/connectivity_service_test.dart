import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/connectivity_service.dart';

class MockConnectivityProvider implements ConnectivityProvider {
  final StreamController<List<ConnectivityResult>> _controller =
      StreamController<List<ConnectivityResult>>.broadcast();

  List<ConnectivityResult> _currentResult = [ConnectivityResult.wifi];

  void setResult(List<ConnectivityResult> result) {
    _currentResult = result;
    _controller.add(result);
  }

  @override
  Future<List<ConnectivityResult>> checkConnectivity() async => _currentResult;

  @override
  Stream<List<ConnectivityResult>> get onConnectivityChanged =>
      _controller.stream;

  void dispose() {
    _controller.close();
  }
}

/// A provider whose checkConnectivity() is delayed, simulating the slow
/// platform channel call that occurs on Android cold start (BUG-049).
class SlowConnectivityProvider implements ConnectivityProvider {
  final StreamController<List<ConnectivityResult>> _controller =
      StreamController<List<ConnectivityResult>>.broadcast();
  final Completer<void> _gate = Completer<void>();
  List<ConnectivityResult> _result;

  SlowConnectivityProvider(this._result);

  /// Call this to unblock checkConnectivity().
  void unblock() {
    if (!_gate.isCompleted) _gate.complete();
  }

  void setResult(List<ConnectivityResult> result) {
    _result = result;
    _controller.add(result);
  }

  @override
  Future<List<ConnectivityResult>> checkConnectivity() async {
    await _gate.future;
    return _result;
  }

  @override
  Stream<List<ConnectivityResult>> get onConnectivityChanged =>
      _controller.stream;

  void dispose() {
    _controller.close();
    if (!_gate.isCompleted) _gate.complete();
  }
}

void main() {
  late MockConnectivityProvider mockProvider;
  late ConnectivityService service;

  setUp(() async {
    mockProvider = MockConnectivityProvider();
    service = ConnectivityService(provider: mockProvider);
    // Let _init() complete
    await Future.delayed(Duration.zero);
  });

  tearDown(() {
    service.dispose();
    mockProvider.dispose();
  });

  group('initial state', () {
    test('starts online when WiFi is available', () {
      expect(service.isOnline, isTrue);
    });

    test('reports current results', () {
      expect(service.currentResults, [ConnectivityResult.wifi]);
    });

    test('starts offline when no connectivity', () async {
      final offlineMock = MockConnectivityProvider();
      offlineMock._currentResult = [ConnectivityResult.none];

      final offlineService =
          ConnectivityService(provider: offlineMock);
      await Future.delayed(Duration.zero);

      expect(offlineService.isOnline, isFalse);

      offlineService.dispose();
      offlineMock.dispose();
    });
  });

  group('connectivity changes', () {
    test('goes offline when all results are none', () async {
      final events = <bool>[];
      service.onConnectivityChanged.listen(events.add);

      mockProvider.setResult([ConnectivityResult.none]);
      await Future.delayed(Duration.zero);

      expect(service.isOnline, isFalse);
      expect(events, [false]);
    });

    test('comes back online after going offline', () async {
      final events = <bool>[];
      service.onConnectivityChanged.listen(events.add);

      // Go offline
      mockProvider.setResult([ConnectivityResult.none]);
      await Future.delayed(Duration.zero);

      // Come back on WiFi
      mockProvider.setResult([ConnectivityResult.wifi]);
      await Future.delayed(Duration.zero);

      expect(service.isOnline, isTrue);
      expect(events, [false, true]);
    });

    test('does not emit when state does not change', () async {
      final events = <bool>[];
      service.onConnectivityChanged.listen(events.add);

      // WiFi → Mobile (both online — no state change)
      mockProvider.setResult([ConnectivityResult.mobile]);
      await Future.delayed(Duration.zero);

      expect(service.isOnline, isTrue);
      expect(events, isEmpty);
    });

    test('mixed results with at least one non-none is online', () async {
      mockProvider
          .setResult([ConnectivityResult.wifi, ConnectivityResult.none]);
      await Future.delayed(Duration.zero);

      expect(service.isOnline, isTrue);
    });
  });

  group('notifyListeners', () {
    test('notifies on state change', () async {
      var notified = false;
      service.addListener(() => notified = true);

      mockProvider.setResult([ConnectivityResult.none]);
      await Future.delayed(Duration.zero);

      expect(notified, isTrue);
    });

    test('does not notify when state unchanged', () async {
      var notified = false;
      service.addListener(() => notified = true);

      // WiFi → Mobile (still online)
      mockProvider.setResult([ConnectivityResult.mobile]);
      await Future.delayed(Duration.zero);

      expect(notified, isFalse);
    });
  });

  group('ready future (BUG-049)', () {
    test('completes after _init finishes', () async {
      // The setUp already awaited a microtask, so ready should be done.
      // But let's explicitly test that ready completes without timeout.
      await service.ready; // Should not hang
      expect(service.isOnline, isTrue);
    });

    test('completes before stream subscription starts', () async {
      // Create a fresh service and immediately await ready
      final freshMock = MockConnectivityProvider();
      final freshService = ConnectivityService(provider: freshMock);

      await freshService.ready;
      expect(freshService.isOnline, isTrue);
      expect(freshService.currentResults, [ConnectivityResult.wifi]);

      freshService.dispose();
      freshMock.dispose();
    });

    test('ready blocks until slow checkConnectivity completes', () async {
      final slowMock = SlowConnectivityProvider([ConnectivityResult.wifi]);
      final slowService = ConnectivityService(provider: slowMock);

      var readyCompleted = false;
      slowService.ready.then((_) => readyCompleted = true);

      // Give microtasks a chance to run — ready should NOT be done yet
      await Future.delayed(Duration.zero);
      expect(readyCompleted, isFalse);

      // Unblock the slow provider
      slowMock.unblock();
      await Future.delayed(Duration.zero);
      await Future.delayed(Duration.zero); // extra pump for the completer

      expect(readyCompleted, isTrue);
      expect(slowService.isOnline, isTrue);

      slowService.dispose();
      slowMock.dispose();
    });

    test('ready completes even when checkConnectivity returns offline', () async {
      final offlineMock = MockConnectivityProvider();
      offlineMock._currentResult = [ConnectivityResult.none];
      final offlineService = ConnectivityService(provider: offlineMock);

      await offlineService.ready;
      expect(offlineService.isOnline, isFalse);

      offlineService.dispose();
      offlineMock.dispose();
    });
  });
}
