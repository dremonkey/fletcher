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
}
