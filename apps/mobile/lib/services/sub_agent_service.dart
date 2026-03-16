import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../models/sub_agent_info.dart';

/// Service that tracks sub-agent activity from the relay.
///
/// Receives "sub_agent_snapshot" messages via the "sub-agents" data channel
/// topic and exposes them as a list of [SubAgentInfo].
///
/// Follows the [RelayChatService] pattern — [LiveKitService] routes messages
/// to [handleMessage] and the service notifies listeners of changes.
class SubAgentService extends ChangeNotifier {
  List<SubAgentInfo> _agents = const [];

  /// All known sub-agents (running + completed).
  List<SubAgentInfo> get agents => _agents;

  /// Number of currently running sub-agents.
  int get runningCount => _agents.where((a) => a.isRunning).length;

  /// Whether there are any sub-agents at all.
  bool get hasAgents => _agents.isNotEmpty;

  /// Whether any sub-agent is currently running.
  bool get hasRunning => _agents.any((a) => a.isRunning);

  /// Handle a raw data channel message on the "sub-agents" topic.
  void handleMessage(List<int> data) {
    try {
      final jsonStr = utf8.decode(data);
      final json = jsonDecode(jsonStr) as Map<String, dynamic>;

      if (json['type'] != 'sub_agent_snapshot') return;

      final agentsList = json['agents'] as List<dynamic>?;
      if (agentsList == null) return;

      _agents = agentsList
          .whereType<Map<String, dynamic>>()
          .map((a) => SubAgentInfo.fromJson(a))
          .toList();

      notifyListeners();
    } catch (e) {
      debugPrint('[SubAgentService] Failed to parse message: $e');
    }
  }

  /// Clear all agents (e.g. on disconnect).
  void clear() {
    if (_agents.isEmpty) return;
    _agents = const [];
    notifyListeners();
  }
}
