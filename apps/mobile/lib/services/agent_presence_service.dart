import 'dart:async';
import 'package:flutter/foundation.dart';
import 'local_vad_service.dart';
import 'agent_dispatch_service.dart';

enum AgentPresenceState {
  agentAbsent, // Local VAD active, waiting for speech
  dispatching, // Speech detected, dispatch in progress
  agentPresent, // Agent connected, normal conversation
  idleWarning, // Agent about to disconnect (warning received)
}

/// Manages agent presence lifecycle for on-demand dispatch.
///
/// When the agent is absent, runs local VAD to detect speech.
/// On speech detection, dispatches the agent via HTTP.
/// When the agent goes idle, handles the warning and disconnect.
///
/// State machine:
/// ```
/// AGENT_ABSENT → (speech detected) → DISPATCHING → (agent connected) → AGENT_PRESENT
/// AGENT_PRESENT → (idle warning) → IDLE_WARNING → (timeout) → AGENT_ABSENT
/// IDLE_WARNING → (user speaks) → AGENT_PRESENT (timer reset)
/// DISPATCHING → (dispatch failed) → AGENT_ABSENT
/// AGENT_PRESENT → (agent crashed/left) → AGENT_ABSENT
/// ```
class AgentPresenceService extends ChangeNotifier {
  AgentPresenceState _state = AgentPresenceState.agentAbsent;
  final LocalVadService _localVad;
  final AgentDispatchService _dispatchService;

  /// Current room name for dispatch calls.
  String? _roomName;

  /// Idle warning countdown (ms remaining before disconnect).
  int? _idleDisconnectInMs;

  /// Whether the feature is enabled. When disabled, agent is always
  /// dispatched via token (backward compat).
  bool _enabled = false;

  /// Callback for emitting system events to the chat transcript.
  ///
  /// Parameters: (id, category, message).
  /// The category is always 'AGENT' for agent presence events.
  final void Function(String id, String category, String message)?
      onSystemEvent;

  AgentPresenceState get state => _state;
  int? get idleDisconnectInMs => _idleDisconnectInMs;
  bool get enabled => _enabled;

  AgentPresenceService({
    required LocalVadService localVad,
    required AgentDispatchService dispatchService,
    this.onSystemEvent,
  })  : _localVad = localVad,
        _dispatchService = dispatchService;

  /// Enable on-demand dispatch mode for the given room.
  void enable(String roomName) {
    _roomName = roomName;
    _enabled = true;
    // Force entry into agentAbsent even if already in that state,
    // so that local VAD starts and listeners are notified.
    _state = AgentPresenceState.agentAbsent;
    _startLocalVad();
    notifyListeners();
  }

  /// Disable on-demand dispatch (agent always present via token dispatch).
  void disable() {
    _enabled = false;
    _localVad.stopListening();
    _state = AgentPresenceState.agentPresent;
    notifyListeners();
  }

  /// Call when a remote participant (agent) connects to the room.
  void onAgentConnected() {
    if (!_enabled) return;
    _localVad.stopListening();
    _idleDisconnectInMs = null;
    _transitionTo(AgentPresenceState.agentPresent);
  }

  /// Call when the last remote participant (agent) disconnects.
  void onAgentDisconnected() {
    if (!_enabled) return;
    _transitionTo(AgentPresenceState.agentAbsent);
  }

  /// Call when an 'agent-idle-warning' data channel event is received.
  void onIdleWarning(int disconnectInMs) {
    if (!_enabled) return;
    _idleDisconnectInMs = disconnectInMs;
    _transitionTo(AgentPresenceState.idleWarning);
  }

  /// Call when an 'agent-disconnected' data channel event is received.
  void onAgentIdleDisconnect() {
    if (!_enabled) return;
    _idleDisconnectInMs = null;
    _transitionTo(AgentPresenceState.agentAbsent);
  }

  /// Called by LocalVadService when speech is detected.
  void onSpeechDetected() {
    if (!_enabled) return;
    if (_state == AgentPresenceState.agentAbsent) {
      _transitionTo(AgentPresenceState.dispatching);
    }
    // If already dispatching or agent present, ignore
  }

  void _transitionTo(AgentPresenceState newState) {
    if (_state == newState) return;

    final oldState = _state;
    _state = newState;
    debugPrint('[AgentPresence] $oldState → $newState');

    // Emit system events for transcript feedback.
    _emitTransitionEvent(oldState, newState);

    switch (newState) {
      case AgentPresenceState.agentAbsent:
        _startLocalVad();
        break;
      case AgentPresenceState.dispatching:
        _localVad.stopListening();
        _dispatchAgent();
        break;
      case AgentPresenceState.agentPresent:
        _localVad.stopListening();
        _idleDisconnectInMs = null;
        break;
      case AgentPresenceState.idleWarning:
        // Agent is still present, just warning
        break;
    }

    notifyListeners();
  }

  /// Emit a system event based on the state transition.
  void _emitTransitionEvent(
      AgentPresenceState from, AgentPresenceState to) {
    if (onSystemEvent == null) return;

    switch (to) {
      case AgentPresenceState.agentAbsent:
        // Only emit disconnect event when transitioning from present/warning
        // (not on initial enable or dispatch failure).
        if (from == AgentPresenceState.agentPresent ||
            from == AgentPresenceState.idleWarning) {
          onSystemEvent!(
            'agent-idle-disconnect',
            'AGENT',
            'Disconnected \u2014 speak to reconnect',
          );
        }
        break;
      case AgentPresenceState.dispatching:
        onSystemEvent!(
          'agent-dispatching',
          'AGENT',
          'Connecting...',
        );
        break;
      case AgentPresenceState.agentPresent:
        if (from == AgentPresenceState.dispatching) {
          onSystemEvent!(
            'agent-reconnected',
            'AGENT',
            'Connected',
          );
        } else if (from == AgentPresenceState.idleWarning) {
          onSystemEvent!(
            'agent-idle-cancelled',
            'AGENT',
            'Staying connected',
          );
        }
        break;
      case AgentPresenceState.idleWarning:
        onSystemEvent!(
          'agent-idle-warning',
          'AGENT',
          'Going idle in 30s \u2014 speak to stay',
        );
        break;
    }
  }

  void _startLocalVad() {
    _localVad.stopListening(); // ensure clean state
    _localVad.startListening().then((_) {
      debugPrint('[AgentPresence] Local VAD started — listening for speech');
    }).catchError((e) {
      debugPrint('[AgentPresence] Failed to start local VAD: $e');
    });
  }

  Future<void> _dispatchAgent() async {
    if (_roomName == null) {
      debugPrint('[AgentPresence] No room name — cannot dispatch');
      _transitionTo(AgentPresenceState.agentAbsent);
      return;
    }

    try {
      final result = await _dispatchService.dispatchAgent(roomName: _roomName!);

      if (result.isDispatched || result.isAlreadyPresent) {
        // Wait for agent to connect via ParticipantConnected event.
        // If it doesn't arrive within a timeout, fall back.
        debugPrint(
            '[AgentPresence] Dispatch ${result.status} — waiting for agent to connect');
        // Don't transition here — onAgentConnected() will handle it
      } else {
        debugPrint('[AgentPresence] Dispatch failed: ${result.message}');
        _transitionTo(AgentPresenceState.agentAbsent);
      }
    } catch (e) {
      debugPrint('[AgentPresence] Dispatch error: $e');
      _transitionTo(AgentPresenceState.agentAbsent);
    }
  }

  @override
  void dispose() {
    _localVad.stopListening();
    super.dispose();
  }
}
