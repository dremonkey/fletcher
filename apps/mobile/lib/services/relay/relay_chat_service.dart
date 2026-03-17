import 'dart:async';

import 'package:flutter/foundation.dart';

import 'acp_update_parser.dart';
import 'json_rpc.dart';

// ---------------------------------------------------------------------------
// Events emitted by RelayChatService
// ---------------------------------------------------------------------------

/// Events yielded by [RelayChatService.sendPrompt].
sealed class RelayChatEvent {}

/// A text delta from a `session/update` notification (`content_chunk`).
class RelayContentDelta extends RelayChatEvent {
  final String text;
  RelayContentDelta(this.text);
}

/// A thinking/reasoning delta from an `agent_thought_chunk` ACP event.
///
/// ACP spec: https://agentclientprotocol.com/protocol/schema#param-agent-thought-chunk
///
/// **Status (2026-03):** OpenClaw's ACP bridge does not yet emit
/// `agent_thought_chunk`. This event type is implemented per the ACP spec
/// for forward compatibility.
class RelayThinkingDelta extends RelayChatEvent {
  final String text;
  RelayThinkingDelta(this.text);
}

/// The `session/prompt` completed successfully.
class RelayPromptComplete extends RelayChatEvent {
  final String stopReason;
  RelayPromptComplete(this.stopReason);
}

/// The `session/prompt` returned a JSON-RPC error.
class RelayPromptError extends RelayChatEvent {
  final int code;
  final String message;
  RelayPromptError(this.code, this.message);
}

/// Token usage data from a `usage_update` ACP event.
///
/// These can arrive at any point during a session/prompt stream.
/// [used] tokens consumed; [size] is the context window size.
class RelayUsageUpdate extends RelayChatEvent {
  final int used;
  final int size;
  RelayUsageUpdate(this.used, this.size);
}

/// A user message replayed during `session/load`.
class RelayUserMessage extends RelayChatEvent {
  final String text;
  RelayUserMessage(this.text);
}

/// The `session/load` replay completed successfully.
class RelayLoadComplete extends RelayChatEvent {}

/// A tool call event from a `tool_call` or `tool_call_update` ACP event.
///
/// Emitted only when verbose mode is active (`verbose: true` in `session/new`).
/// [status] is null when the tool call starts; non-null ("completed", "error")
/// when it finishes.
class RelayToolCallEvent extends RelayChatEvent {
  final String id;
  final String? title;
  final String? status;
  RelayToolCallEvent({required this.id, this.title, this.status});
}

// ---------------------------------------------------------------------------
// ACP error codes from the relay
// ---------------------------------------------------------------------------

/// Relay rejected because voice mode is active.
const relayErrorVoiceModeActive = -32003;

/// Relay lost its ACP connection to OpenClaw.
const relayErrorAcpLost = -32010;

/// Relay ACP session not yet initialized.
const relayErrorSessionNotReady = -32011;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/// ACP client that speaks JSON-RPC 2.0 over the LiveKit data channel
/// (`"relay"` topic) for chat-mode text conversations.
///
/// Lifecycle:
///   1. [LiveKitService] creates this with a [publish] callback.
///   2. User types text → [sendPrompt] sends `session/prompt`.
///   3. Relay forwards to ACP → streams `session/update` notifications.
///   4. [handleMessage] routes inbound messages to the active stream.
///   5. Prompt result closes the stream.
///
/// Only one prompt can be in-flight at a time. Call [cancelPrompt] to
/// abort, then wait for the stream to close before sending another.
class RelayChatService {
  /// Callback to publish a raw payload on the `"relay"` data channel topic.
  final Future<void> Function(Uint8List data) publish;

  /// Timeout for a prompt response. If no response arrives within this
  /// duration, the stream is closed with an error event (BUG-045).
  final Duration promptTimeout;

  final JsonRpcIdGenerator _idGen = JsonRpcIdGenerator();
  StreamController<RelayChatEvent>? _activeStream;
  int? _activeRequestId;
  Timer? _promptTimer;

  RelayChatService({
    required this.publish,
    this.promptTimeout = const Duration(seconds: 30),
  });

  /// Whether a prompt is currently in-flight.
  bool get isBusy => _activeStream != null;

  /// Send user text to the ACP agent via the relay.
  ///
  /// Returns a stream of [RelayChatEvent]s:
  /// - [RelayContentDelta] for each text chunk
  /// - [RelayPromptComplete] when the agent finishes
  /// - [RelayPromptError] if something goes wrong
  ///
  /// The stream closes after the final event. Do not call again until
  /// the previous stream is closed.
  Stream<RelayChatEvent> sendPrompt(String text) {
    if (_activeStream != null) {
      // Shouldn't happen — caller should check isBusy or await previous.
      // Fail loudly in debug, silently return error stream in release.
      assert(false, 'sendPrompt called while a prompt is already in-flight');
      return Stream.value(
        RelayPromptError(-1, 'A prompt is already in-flight'),
      );
    }

    final id = _idGen.next();
    _activeRequestId = id;
    _activeStream = StreamController<RelayChatEvent>();

    final request = JsonRpcRequest(
      id: id,
      method: 'session/prompt',
      params: {
        'prompt': [
          {'type': 'text', 'text': text},
        ],
      },
    );
    publish(request.encode());

    // Start prompt timeout (BUG-045). If no response arrives within the
    // timeout, close the stream with an error so the UI isn't stuck forever.
    _promptTimer?.cancel();
    _promptTimer = Timer(promptTimeout, () {
      if (_activeStream != null && _activeRequestId == id) {
        debugPrint('[RelayChatService] Prompt timed out after $promptTimeout');
        _activeStream?.add(RelayPromptError(-32000, 'Prompt timed out'));
        _activeStream?.close();
        _activeStream = null;
        _activeRequestId = null;
      }
    });

    return _activeStream!.stream;
  }

  /// Whether a session/load replay is in progress.
  bool _isLoading = false;

  /// Whether the service is currently replaying session history.
  bool get isLoading => _isLoading;

  /// Request session history replay from the relay via `session/load`.
  ///
  /// Returns a stream of [RelayChatEvent]s containing replayed user and
  /// agent messages. The stream closes with [RelayLoadComplete] when done.
  ///
  /// Must not be called while a prompt is in-flight.
  Stream<RelayChatEvent> sendSessionLoad() {
    if (_activeStream != null) {
      assert(false, 'sendSessionLoad called while a stream is active');
      return Stream.value(
        RelayPromptError(-1, 'A stream is already active'),
      );
    }

    final id = _idGen.next();
    _activeRequestId = id;
    _activeStream = StreamController<RelayChatEvent>();
    _isLoading = true;

    final request = JsonRpcRequest(
      id: id,
      method: 'session/load',
      params: {},
    );
    publish(request.encode());

    return _activeStream!.stream;
  }

  /// Cancel the in-flight prompt. The relay will resolve the pending
  /// `session/prompt` with `stopReason: "cancelled"`.
  void cancelPrompt() {
    if (_activeRequestId == null) return;
    final notification = JsonRpcNotification(
      method: 'session/cancel',
      params: {},
    );
    publish(notification.encode());
  }

  /// Feed an inbound data channel message (from the `"relay"` topic) into
  /// this service. Called by [LiveKitService._handleDataReceived].
  ///
  /// Accepts [List<int>] (what LiveKit data channel provides) — converts
  /// internally to [Uint8List] for the JSON-RPC codec.
  void handleMessage(List<int> data) {
    final msg = decodeJsonRpc(Uint8List.fromList(data));
    if (msg == null) {
      debugPrint('[RelayChatService] Dropped malformed JSON-RPC message '
          '(${data.length} bytes)');
      return;
    }

    if (msg is JsonRpcServerNotification && msg.method == 'session/update') {
      _handleSessionUpdate(msg.params);
    } else if (msg is JsonRpcResponse && msg.id == _activeRequestId) {
      _handlePromptResult(msg);
    } else if (msg is JsonRpcResponse) {
      debugPrint('[RelayChatService] Dropped response with mismatched id: '
          'got=${msg.id} expected=$_activeRequestId');
    } else {
      debugPrint('[RelayChatService] Dropped unhandled message: '
          '${msg.runtimeType}');
    }
  }

  /// Clean up on dispose (e.g., room disconnect).
  void dispose() {
    _promptTimer?.cancel();
    _promptTimer = null;
    _activeStream?.close();
    _activeStream = null;
    _activeRequestId = null;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  void _handleSessionUpdate(Map<String, dynamic> params) {
    // Handle relay error notifications (BUG-045).
    // When the ACP subprocess dies, the relay sends:
    //   { "error": { "code": -32010, "message": "ACP connection lost" } }
    final error = params['error'];
    if (error is Map<String, dynamic>) {
      final code = error['code'] as int? ?? -32000;
      final message = error['message'] as String? ?? 'Unknown relay error';
      debugPrint('[RelayChatService] Relay error notification: $code $message');
      _activeStream?.add(RelayPromptError(code, message));
      _activeStream?.close();
      _promptTimer?.cancel();
      _promptTimer = null;
      _activeStream = null;
      _activeRequestId = null;
      return;
    }

    final update = AcpUpdateParser.parse(params);

    if (update is AcpTextDelta && update.text.isNotEmpty) {
      _activeStream?.add(RelayContentDelta(update.text));
    } else if (update is AcpThinkingDelta && update.text.isNotEmpty) {
      _activeStream?.add(RelayThinkingDelta(update.text));
    } else if (update is AcpUserMessage) {
      _activeStream?.add(RelayUserMessage(update.text));
    } else if (update is AcpUsageUpdate) {
      _activeStream?.add(RelayUsageUpdate(update.used, update.size));
    } else if (update is AcpToolCallUpdate) {
      _activeStream?.add(RelayToolCallEvent(
        id: update.id,
        title: update.title,
        status: update.status,
      ));
    } else if (update is AcpNonContentUpdate && _isLoading) {
      // BUG-047: Log unrecognized update kinds during session/load replay
      // so future parsing mismatches are visible instead of silent.
      debugPrint('[RelayChatService] Dropped non-content update during '
          'session/load: ${update.kind}');
    }
  }

  void _handlePromptResult(JsonRpcResponse response) {
    _promptTimer?.cancel();
    _promptTimer = null;
    final wasLoading = _isLoading;
    _isLoading = false;

    if (response.isError) {
      final err = response.error!;
      _activeStream?.add(RelayPromptError(err.code, err.message));
    } else if (wasLoading) {
      _activeStream?.add(RelayLoadComplete());
    } else {
      final result = response.result as Map<String, dynamic>? ?? {};
      final stopReason = result['stopReason'] as String? ?? 'completed';
      _activeStream?.add(RelayPromptComplete(stopReason));
    }
    _activeStream?.close();
    _activeStream = null;
    _activeRequestId = null;
  }
}
