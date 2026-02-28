import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/models/health_state.dart';
import 'package:fletcher/services/health_service.dart';

void main() {
  late HealthService service;

  setUp(() {
    service = HealthService();
    // Initialize with valid config so health checks exist
    service.validateConfig(
      livekitUrl: 'wss://example.com',
      livekitToken:
          // Minimal valid JWT with exp far in the future (year 2099)
          'eyJhbGciOiJIUzI1NiJ9.'
          'eyJleHAiOjQwODYxNzYwMDB9.'
          'signature',
    );
  });

  HealthCheck _findCheck(String id) =>
      service.state.checks.firstWhere((c) => c.id == id);

  group('validateConfig', () {
    test('creates network health check', () {
      final check = _findCheck('network');
      expect(check.status, HealthCheckStatus.ok);
    });

    test('creates all expected health checks', () {
      final ids = service.state.checks.map((c) => c.id).toSet();
      expect(ids, containsAll([
        'livekit_url',
        'livekit_token',
        'network',
        'mic_permission',
        'room_joined',
        'agent_present',
      ]));
    });
  });

  group('updateNetworkStatus', () {
    test('sets ok when online', () {
      service.updateNetworkStatus(online: true, detail: 'WiFi');
      final check = _findCheck('network');
      expect(check.status, HealthCheckStatus.ok);
      expect(check.detail, 'WiFi');
    });

    test('sets error when offline', () {
      service.updateNetworkStatus(online: false);
      final check = _findCheck('network');
      expect(check.status, HealthCheckStatus.error);
      expect(check.detail, 'No network connection');
      expect(check.suggestion, isNotNull);
    });

    test('uses default detail when online and no detail provided', () {
      service.updateNetworkStatus(online: true);
      final check = _findCheck('network');
      expect(check.detail, 'Connected');
    });
  });

  group('updateRoomReconnecting', () {
    test('sets room_joined to warning', () {
      service.updateRoomReconnecting();
      final check = _findCheck('room_joined');
      expect(check.status, HealthCheckStatus.warning);
      expect(check.detail, 'Reconnecting...');
    });

    test('overall health is degraded (not unhealthy)', () {
      // First set room as connected
      service.updateRoomConnected(connected: true);
      service.updateMicPermission(granted: true);
      service.updateAgentPresent(present: true);
      service.updateNetworkStatus(online: true);

      // Now set reconnecting
      service.updateRoomReconnecting();
      expect(service.state.overall, OverallHealth.degraded);
    });
  });

  group('updateRoomConnected', () {
    test('sets ok when connected', () {
      service.updateRoomConnected(connected: true);
      final check = _findCheck('room_joined');
      expect(check.status, HealthCheckStatus.ok);
    });

    test('sets error when disconnected', () {
      service.updateRoomConnected(
          connected: false, errorDetail: 'Timed out');
      final check = _findCheck('room_joined');
      expect(check.status, HealthCheckStatus.error);
      expect(check.detail, 'Timed out');
    });
  });

  group('overall health', () {
    test('unhealthy when any check is error', () {
      service.updateNetworkStatus(online: false);
      expect(service.state.overall, OverallHealth.unhealthy);
    });

    test('degraded when warning but no error', () {
      service.updateNetworkStatus(online: true);
      service.updateMicPermission(granted: true);
      service.updateRoomConnected(connected: true);
      service.updateRoomReconnecting(); // sets warning
      service.updateAgentPresent(present: true);

      // The only non-ok check should be room_joined (warning)
      final roomCheck = _findCheck('room_joined');
      expect(roomCheck.status, HealthCheckStatus.warning);

      expect(service.state.overall, OverallHealth.degraded);
    });
  });

  group('refresh', () {
    test('preserves network check state across refresh', () {
      service.updateNetworkStatus(online: false);
      service.refresh();
      final check = _findCheck('network');
      expect(check.status, HealthCheckStatus.error);
    });
  });

  group('notifyListeners', () {
    test('fires on updateNetworkStatus', () {
      var notified = false;
      service.addListener(() => notified = true);
      service.updateNetworkStatus(online: false);
      expect(notified, isTrue);
    });

    test('fires on updateRoomReconnecting', () {
      var notified = false;
      service.addListener(() => notified = true);
      service.updateRoomReconnecting();
      expect(notified, isTrue);
    });
  });
}
