import 'dart:async';
import 'package:flutter/foundation.dart';
import 'local_vad_service.dart';
import 'agent_dispatch_service.dart';

enum AgentPresenceState {
  agentAbsent, // Local VAD active, waiting for speech
  dispatching, // Speech detected, dispatch in progress
  agentPresent, // Agent connected, normal conversation
}

/// Manages agent presence lifecycle for on-demand dispatch.
///
/// When the agent is absent, runs local VAD to detect speech.
/// On speech detection, dispatches the agent via HTTP.
///
/// State machine:
/// ```
/// AGENT_ABSENT → (speech detected) → DISPATCHING → (agent connected) → AGENT_PRESENT
/// DISPATCHING → (dispatch failed) → AGENT_ABSENT
/// AGENT_PRESENT → (agent crashed/left) → AGENT_ABSENT
/// ```
class AgentPresenceService extends ChangeNotifier {
  AgentPresenceState _state = AgentPresenceState.agentAbsent;
  final LocalVadService _localVad;
  final AgentDispatchService _dispatchService;

  /// Current room name for dispatch calls.
  String? _roomName;

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
    _transitionTo(AgentPresenceState.agentPresent);
  }

  /// Whether the current disconnect is a hold-mode disconnect (idle timeout).
  bool _holdMode = false;

  /// Call when the last remote participant (agent) disconnects.
  /// Set [holdMode] to true when the agent disconnected due to idle timeout
  /// (session_hold event) — shows "on hold" UX instead of generic disconnect.
  void onAgentDisconnected({bool holdMode = false}) {
    if (!_enabled) return;
    _holdMode = holdMode;
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

  /// Called when the user sends a text message.
  /// Triggers dispatch if the agent is absent.
  void onTextMessageSent() {
    if (!_enabled) return;
    if (_state == AgentPresenceState.agentAbsent) {
      _transitionTo(AgentPresenceState.dispatching);
    }
  }

  /// Update the dispatch service base URL (e.g. after URL resolution).
  void updateDispatchBaseUrl(String baseUrl) {
    _dispatchService.baseUrl = baseUrl;
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
        // Only emit disconnect event when transitioning from present
        // (not on initial enable or dispatch failure).
        if (from == AgentPresenceState.agentPresent) {
          onSystemEvent!(
            'agent-disconnected',
            'AGENT',
            _holdMode
                ? 'On hold \u2014 tap or speak to resume'
                : 'Disconnected \u2014 speak to reconnect',
          );
          _holdMode = false;
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
        }
        break;
    }
  }

  void _startLocalVad() {
    // Local VAD mic capture is disabled — speech detection is handled by
    // LiveKitService._updateAudioLevels() using the existing LiveKit audio
    // session to avoid mic capture conflicts on Android.
    debugPrint('[AgentPresence] Waiting for speech (via audio level monitoring)');
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
