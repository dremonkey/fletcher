import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../models/health_state.dart';

class HealthService extends ChangeNotifier {
  HealthState _state = const HealthState();
  HealthState get state => _state;

  String? _livekitUrl;
  String? _livekitToken;

  /// Run all local validation checks against the provided env values.
  void validateConfig({required String? livekitUrl, required String? livekitToken}) {
    _livekitUrl = livekitUrl;
    _livekitToken = livekitToken;

    final checks = <HealthCheck>[
      _checkUrl(),
      _checkToken(),
      // Connection-dependent checks start as pending
      const HealthCheck(
        id: 'network',
        label: 'Network',
        status: HealthCheckStatus.ok,
        detail: 'Checking...',
      ),
      const HealthCheck(
        id: 'mic_permission',
        label: 'Microphone permission',
      ),
      const HealthCheck(
        id: 'room_joined',
        label: 'Room joined',
      ),
      const HealthCheck(
        id: 'agent_present',
        label: 'Agent present',
      ),
    ];

    _state = HealthState(checks: checks);
    notifyListeners();
  }

  /// Re-run all checks (local validations + preserve connection state).
  void refresh() {
    if (_livekitUrl == null && _livekitToken == null) return;

    final connectionChecks = <String, HealthCheck>{};
    for (final check in _state.checks) {
      if (['network', 'mic_permission', 'room_joined', 'agent_present'].contains(check.id)) {
        connectionChecks[check.id] = check;
      }
    }

    final checks = <HealthCheck>[
      _checkUrl(),
      _checkToken(),
      connectionChecks['network'] ??
          const HealthCheck(id: 'network', label: 'Network'),
      connectionChecks['mic_permission'] ??
          const HealthCheck(id: 'mic_permission', label: 'Microphone permission'),
      connectionChecks['room_joined'] ??
          const HealthCheck(id: 'room_joined', label: 'Room joined'),
      connectionChecks['agent_present'] ??
          const HealthCheck(id: 'agent_present', label: 'Agent present'),
    ];

    _state = HealthState(checks: checks);
    notifyListeners();
  }

  // --- Connection-dependent updates called by LiveKitService ---

  void updateNetworkStatus({required bool online, String? detail, String? warning}) {
    HealthCheckStatus status;
    String checkDetail;
    String? checkSuggestion;

    if (!online) {
      status = HealthCheckStatus.error;
      checkDetail = 'No network connection';
      checkSuggestion = 'Check WiFi or cellular data settings';
    } else if (warning != null) {
      status = HealthCheckStatus.warning;
      checkDetail = detail ?? 'Connected';
      checkSuggestion = warning;
    } else {
      status = HealthCheckStatus.ok;
      checkDetail = detail ?? 'Connected';
      checkSuggestion = null;
    }

    _updateCheck(
      'network',
      status: status,
      detail: checkDetail,
      suggestion: checkSuggestion,
    );
  }

  void updateMicPermission({required bool granted}) {
    _updateCheck(
      'mic_permission',
      status: granted ? HealthCheckStatus.ok : HealthCheckStatus.error,
      detail: granted ? 'Granted' : 'Denied',
      suggestion: granted ? null : 'Go to Settings > App Permissions and enable microphone',
    );
  }

  void updateRoomReconnecting() {
    _updateCheck(
      'room_joined',
      status: HealthCheckStatus.warning,
      detail: 'Reconnecting...',
      suggestion: 'The SDK is attempting to restore the connection',
    );
  }

  void updateRoomConnected({required bool connected, String? errorDetail}) {
    _updateCheck(
      'room_joined',
      status: connected ? HealthCheckStatus.ok : HealthCheckStatus.error,
      detail: connected ? 'Connected' : (errorDetail ?? 'Not connected'),
      suggestion: connected ? null : 'Check that the LiveKit server is running',
    );
  }

  void updateAgentPresent({required bool present}) {
    _updateCheck(
      'agent_present',
      status: present ? HealthCheckStatus.ok : HealthCheckStatus.warning,
      detail: present ? 'Connected' : 'No agent in room',
      suggestion: present ? null : 'Start the voice agent (livekit-agent)',
    );
  }

  // --- Local validation checks ---

  HealthCheck _checkUrl() {
    if (_livekitUrl == null || _livekitUrl!.isEmpty) {
      return const HealthCheck(
        id: 'livekit_url',
        label: 'LiveKit URL',
        status: HealthCheckStatus.error,
        detail: 'LIVEKIT_URL is empty or missing',
        suggestion: 'Add LIVEKIT_URL to apps/mobile/.env',
      );
    }
    final valid = _livekitUrl!.startsWith('ws://') || _livekitUrl!.startsWith('wss://');
    return HealthCheck(
      id: 'livekit_url',
      label: 'LiveKit URL',
      status: valid ? HealthCheckStatus.ok : HealthCheckStatus.error,
      detail: valid ? _livekitUrl! : 'URL must start with ws:// or wss://',
      suggestion: valid ? null : 'Change LIVEKIT_URL to use ws:// or wss:// scheme',
    );
  }

  HealthCheck _checkToken() {
    if (_livekitToken == null || _livekitToken!.isEmpty) {
      return const HealthCheck(
        id: 'livekit_token',
        label: 'LiveKit token',
        status: HealthCheckStatus.error,
        detail: 'LIVEKIT_TOKEN is empty or missing',
        suggestion: 'Generate a token with livekit-cli or your token server',
      );
    }

    try {
      final parts = _livekitToken!.split('.');
      if (parts.length != 3) {
        return const HealthCheck(
          id: 'livekit_token',
          label: 'LiveKit token',
          status: HealthCheckStatus.error,
          detail: 'Invalid JWT format (expected 3 segments)',
          suggestion: 'Regenerate the token',
        );
      }

      // Base64-decode the payload (middle segment)
      String payload = parts[1];
      // Add padding if needed
      switch (payload.length % 4) {
        case 2:
          payload += '==';
          break;
        case 3:
          payload += '=';
          break;
      }
      final decoded = utf8.decode(base64Url.decode(payload));
      final json = jsonDecode(decoded) as Map<String, dynamic>;

      final exp = json['exp'] as int?;
      if (exp == null) {
        return const HealthCheck(
          id: 'livekit_token',
          label: 'LiveKit token',
          status: HealthCheckStatus.warning,
          detail: 'No exp claim in token (never expires)',
        );
      }

      final expiresAt = DateTime.fromMillisecondsSinceEpoch(exp * 1000);
      final now = DateTime.now();
      final remaining = expiresAt.difference(now);

      if (remaining.isNegative) {
        return HealthCheck(
          id: 'livekit_token',
          label: 'LiveKit token',
          status: HealthCheckStatus.error,
          detail: 'Expired ${_formatDuration(remaining.abs())} ago',
          suggestion: 'Generate a new token',
        );
      }

      if (remaining.inMinutes < 5) {
        return HealthCheck(
          id: 'livekit_token',
          label: 'LiveKit token',
          status: HealthCheckStatus.warning,
          detail: 'Expires in ${_formatDuration(remaining)}',
          suggestion: 'Consider generating a fresh token soon',
        );
      }

      return HealthCheck(
        id: 'livekit_token',
        label: 'LiveKit token',
        status: HealthCheckStatus.ok,
        detail: 'Expires in ${_formatDuration(remaining)}',
      );
    } catch (e) {
      return HealthCheck(
        id: 'livekit_token',
        label: 'LiveKit token',
        status: HealthCheckStatus.error,
        detail: 'Failed to decode token: $e',
        suggestion: 'Regenerate the token',
      );
    }
  }

  // --- Helpers ---

  void _updateCheck(
    String id, {
    required HealthCheckStatus status,
    String? detail,
    String? suggestion,
  }) {
    final checks = _state.checks.map((c) {
      if (c.id == id) {
        return c.copyWith(status: status, detail: detail, suggestion: suggestion);
      }
      return c;
    }).toList();
    _state = HealthState(checks: checks);
    notifyListeners();
  }

  static String _formatDuration(Duration d) {
    if (d.inDays > 0) return '${d.inDays}d ${d.inHours % 24}h';
    if (d.inHours > 0) return '${d.inHours}h ${d.inMinutes % 60}m';
    if (d.inMinutes > 0) return '${d.inMinutes}m';
    return '${d.inSeconds}s';
  }
}
