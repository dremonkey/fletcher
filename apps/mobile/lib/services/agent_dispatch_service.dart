import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter/foundation.dart';

/// Service to dispatch the Fletcher agent to a LiveKit room on demand.
///
/// Called when local VAD detects speech while the agent is disconnected.
class AgentDispatchService {
  final String baseUrl;
  final http.Client _client;

  AgentDispatchService({
    required this.baseUrl,
    http.Client? client,
  }) : _client = client ?? http.Client();

  /// Dispatch the agent to join the specified room.
  ///
  /// Returns the dispatch status ('dispatched', 'already_present', or 'error').
  /// Throws on network errors.
  Future<DispatchResult> dispatchAgent({
    required String roomName,
    Map<String, dynamic>? metadata,
  }) async {
    final url = Uri.parse('$baseUrl/dispatch-agent');

    try {
      final response = await _client.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'room_name': roomName,
          if (metadata != null) 'metadata': metadata,
        }),
      );

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final status = data['status'] as String? ?? 'error';

      debugPrint('[AgentDispatch] Response: $status (${response.statusCode})');

      return DispatchResult(
        status: status,
        agentName: data['agent_name'] as String?,
        dispatchId: data['dispatch_id'] as String?,
        message: data['message'] as String?,
      );
    } catch (e) {
      debugPrint('[AgentDispatch] Error: $e');
      return DispatchResult(status: 'error', message: e.toString());
    }
  }

  /// Close the underlying HTTP client.
  void dispose() {
    _client.close();
  }
}

class DispatchResult {
  final String status;
  final String? agentName;
  final String? dispatchId;
  final String? message;

  const DispatchResult({
    required this.status,
    this.agentName,
    this.dispatchId,
    this.message,
  });

  bool get isDispatched => status == 'dispatched';
  bool get isAlreadyPresent => status == 'already_present';
  bool get isError => status == 'error';
}
