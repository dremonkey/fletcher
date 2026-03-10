import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/conversation_state.dart';
import '../models/system_event.dart';
import 'agent_dispatch_service.dart';
import 'agent_presence_service.dart';
import 'connectivity_service.dart';
import 'disconnect_reason.dart' as dr;
import 'health_service.dart';
import 'local_vad_service.dart';
import 'reconnect_scheduler.dart';
import 'session_storage.dart';
import 'token_service.dart';
import 'url_resolver.dart';

/// Max waveform samples (~30 samples at 100ms = 3s history)
const _maxWaveformSamples = 30;

/// Max transcript entries to keep in history
const _maxTranscriptEntries = 100;

class LiveKitService extends ChangeNotifier {
  Room? _room;
  LocalParticipant? _localParticipant;
  EventsListener<RoomEvent>? _listener;

  ConversationState _state = const ConversationState();
  ConversationState get state => _state;

  bool _isMuted = true;
  bool get isMuted => _isMuted;

  bool _textOnlyMode = false;
  bool get textOnlyMode => _textOnlyMode;
  bool get voiceOutEnabled => !_textOnlyMode;

  Timer? _audioLevelTimer;
  Timer? _statusClearTimer;
  Timer? _userSubtitleClearTimer;
  Timer? _agentSubtitleClearTimer;

  /// Tracks the most recent agent transcript segment ID so that artifacts
  /// arriving via the data channel can be associated with the agent message
  /// that produced them (BUG-012 / TASK-023).
  String? _lastAgentSegmentId;

  // Background session timeout (task 019)
  static const _backgroundTimeout = Duration(minutes: 10);
  Timer? _backgroundTimeoutTimer;
  Timer? _backgroundCountdownTimer;
  int _backgroundMinutesRemaining = 0;

  // Credential cache for reconnects
  String? _url;
  String? _token;
  List<String> _allUrls = [];

  // Dynamic room config — overwritten by connectWithDynamicRoom() from env.
  // Defaults here are fallbacks only; real values come from DEPARTURE_TIMEOUT_S
  // and TOKEN_SERVER_PORT in .env (which must match server-side config).
  int _tokenServerPort = 7882;
  int _departureTimeoutS = 120;
  String? _currentRoomName;

  // Audio device change handling
  StreamSubscription<List<MediaDevice>>? _deviceChangeSub;
  Timer? _deviceChangeDebounce;
  bool _isRefreshingAudio = false;

  // Network connectivity subscription
  StreamSubscription<bool>? _connectivitySub;

  final HealthService healthService = HealthService();
  final ConnectivityService connectivityService = ConnectivityService();

  /// Agent presence lifecycle for on-demand dispatch (Epic 20).
  late final AgentPresenceService agentPresenceService = _createAgentPresenceService();
  // Reconnection audio buffer — captures mic during SDK reconnect (BUG-027)
  PreConnectAudioBuffer? _reconnectBuffer;

  // Room reconnection state (sleep/disconnect recovery)
  bool _reconnecting = false;
  ReconnectScheduler _reconnectScheduler = ReconnectScheduler();

  // Connectivity-driven reconnect: waits for network restore when offline
  StreamSubscription<bool>? _networkRestoreSub;

  // Diagnostics: round-trip latency measurement
  // Tracks when user stopped speaking so we can measure RT when agent starts
  DateTime? _userSpeechEndTime;

  /// Callback for agent idle warning from data channel (Epic 20).
  void Function(int disconnectInMs)? onAgentIdleWarning;

  /// Callback for agent disconnect from data channel (Epic 20).
  void Function(String reason)? onAgentDisconnected;

  /// Callback for agent warm-down from data channel (Epic 20 / Task 006).
  void Function()? onAgentWarmDown;

  /// Callback for agent warm-down cancelled from data channel (Epic 20 / Task 006).
  void Function()? onAgentWarmDownCancelled;

  // Buffer for reassembling chunked messages
  final Map<String, List<String?>> _chunks = {};

  // Rolling waveform buffers
  final List<double> _userWaveformBuffer = [];
  final List<double> _aiWaveformBuffer = [];

  // Queued text messages sent while agent was absent (Epic 20).
  // Flushed when the agent connects.
  final List<String> _pendingTextMessages = [];

  // Speech detection via audio levels when agent is absent (Epic 20).
  // Counts consecutive frames above threshold to confirm speech.
  static const _speechThreshold = 0.05;
  static const _speechFramesRequired = 3; // 300ms at 100ms polling
  int _speechFrameCount = 0;

  Future<bool> requestPermissions() async {
    final status = await Permission.microphone.request();
    // Bluetooth permission is needed so audio routing survives headphone
    // connect/disconnect on Android 12+.  We request it but don't gate
    // the connection on it — the user can still use the speaker.
    final btStatus = await Permission.bluetoothConnect.request();
    // Android 13+ requires POST_NOTIFICATIONS for foreground service notification (BUG-022)
    final notifStatus = await Permission.notification.request();
    debugPrint('[Fletcher] Permissions: mic=${status.name} bt=${btStatus.name} notif=${notifStatus.name}');
    return status.isGranted;
  }

  /// High-level connection flow with dynamic room names.
  ///
  /// 1. Check SessionStorage for a recent room (< departure_timeout)
  /// 2. If recent: reuse that room name; if stale/none: generate new name
  /// 3. Resolve LiveKit URL (race LAN vs Tailscale)
  /// 4. Fetch token from token endpoint (using resolved host)
  /// 5. Connect to LiveKit
  /// 6. Save session to SessionStorage
  Future<void> connectWithDynamicRoom({
    required List<String> urls,
    required int tokenServerPort,
    required int departureTimeoutS,
  }) async {
    _tokenServerPort = tokenServerPort;
    _departureTimeoutS = departureTimeoutS;
    _allUrls = urls;
    _reconnectScheduler = ReconnectScheduler.fromDepartureTimeout(departureTimeoutS);

    // Load persisted text-only mode preference (TASK-030)
    _textOnlyMode = await SessionStorage.getTextOnlyMode();

    _updateState(status: ConversationStatus.connecting);

    // Emit boot sequence system events (task 020)
    _emitSystemEvent(SystemEvent(
      id: 'network-boot',
      type: SystemEventType.network,
      status: SystemEventStatus.pending,
      message: 'resolving...',
      timestamp: DateTime.now(),
      prefix: '\u25B8',
    ));

    try {
      // Determine room name: reuse recent session or generate new
      final stalenessThreshold = Duration(seconds: departureTimeoutS);
      final recentRoom = await SessionStorage.getRecentRoom(
        stalenessThreshold: stalenessThreshold,
      );
      final roomName = recentRoom ?? _generateRoomName();
      _currentRoomName = roomName;

      debugPrint('[Fletcher] Room: $roomName (${recentRoom != null ? "reused" : "new"})');

      // Resolve URL (race all candidates)
      final resolved = await resolveLivekitUrl(urls: urls);

      // Update network event to success
      _emitSystemEvent(SystemEvent(
        id: 'network-boot',
        type: SystemEventType.network,
        status: SystemEventStatus.success,
        message: _describeTransport(resolved.url),
        timestamp: DateTime.now(),
        prefix: '\u25B8',
      ));

      // Extract all candidate hosts for token endpoint racing
      final tokenHosts = urls
          .map((u) => Uri.parse(u).host)
          .where((h) => h.isNotEmpty)
          .toList();

      // Fetch token (races all hosts, same as URL resolver)
      final identity = await SessionStorage.getDeviceId();
      final result = await fetchToken(
        hosts: tokenHosts,
        port: tokenServerPort,
        roomName: roomName,
        identity: identity,
      );

      // Emit AGENT waiting event before connect (agent arrives after room join)
      _emitSystemEvent(SystemEvent(
        id: 'agent-boot',
        type: SystemEventType.agent,
        status: SystemEventStatus.pending,
        message: 'waiting...',
        timestamp: DateTime.now(),
        prefix: '\u25B8',
      ));

      // Connect using the low-level connect method
      await connect(
        url: resolved.url,
        token: result.token,
      );

      // Save session on successful connect
      if (_state.status != ConversationStatus.error) {
        await SessionStorage.saveSession(roomName);
      }
    } catch (e) {
      debugPrint('[Fletcher] Dynamic room connection failed: $e');
      _emitSystemEvent(SystemEvent(
        id: 'network-boot',
        type: SystemEventType.network,
        status: SystemEventStatus.error,
        message: 'failed: $e',
        timestamp: DateTime.now(),
        prefix: '\u2715',
      ));
      _updateState(
        status: ConversationStatus.error,
        errorMessage: 'Connection failed: $e',
      );
    }
  }

  /// Generate a unique room name: fletcher-<unix-millis>.
  /// When E2E_TEST_MODE=true in .env, uses e2e-fletcher- prefix so the voice
  /// agent detects automated tests and uses a minimal system prompt,
  /// reducing token consumption. (TASK-022)
  String _generateRoomName() {
    final isE2e = dotenv.env['E2E_TEST_MODE']?.toLowerCase() == 'true';
    final prefix = isE2e ? 'e2e-fletcher' : 'fletcher';
    return '$prefix-${DateTime.now().millisecondsSinceEpoch}';
  }

  /// Create a new room and connect to it (used for recovery after budget exhaustion).
  Future<void> _connectToNewRoom() async {
    final roomName = _generateRoomName();
    _currentRoomName = roomName;

    debugPrint('[Fletcher] Creating new room for recovery: $roomName');

    // Emit room recovery system event (task 020)
    _emitSystemEvent(SystemEvent(
      id: 'room-recovery-${DateTime.now().millisecondsSinceEpoch}',
      type: SystemEventType.room,
      status: SystemEventStatus.pending,
      message: 'departed \u00B7 creating new room...',
      timestamp: DateTime.now(),
      prefix: '\u2715',
    ));

    try {
      // Resolve URL
      final resolved = await resolveLivekitUrl(urls: _allUrls);

      final tokenHosts = _allUrls
          .map((u) => Uri.parse(u).host)
          .where((h) => h.isNotEmpty)
          .toList();

      final identity = await SessionStorage.getDeviceId();
      final result = await fetchToken(
        hosts: tokenHosts,
        port: _tokenServerPort,
        roomName: roomName,
        identity: identity,
      );

      await connect(
        url: resolved.url,
        token: result.token,
      );

      if (_state.status != ConversationStatus.error) {
        await SessionStorage.saveSession(roomName);
      }
    } catch (e) {
      debugPrint('[Fletcher] New room connection failed: $e');
      _updateState(
        status: ConversationStatus.error,
        errorMessage: 'Recovery failed: $e',
      );
    }
  }

  Future<void> connect({
    required String url,
    required String token,
  }) async {
    // Cache credentials for reconnect
    _url = url;
    _token = token;

    // Run local config validation checks immediately
    healthService.validateConfig(livekitUrl: url, livekitToken: token);

    try {
      _updateState(status: ConversationStatus.connecting);

      final hasPermission = await requestPermissions();
      healthService.updateMicPermission(granted: hasPermission);
      if (!hasPermission) {
        _updateState(
          status: ConversationStatus.error,
          errorMessage: 'Microphone permission denied',
        );
        return;
      }

      _room = Room(
        roomOptions: const RoomOptions(
          adaptiveStream: true,
          dynacast: true,
          defaultAudioCaptureOptions: AudioCaptureOptions(
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            voiceIsolation: true,
            highPassFilter: true,
            typingNoiseDetection: true,
          ),
          defaultAudioPublishOptions: AudioPublishOptions(
            audioBitrate: AudioPreset.speech,
            dtx: true,
          ),
        ),
      );

      _listener = _room!.createListener();
      _setupRoomListeners();

      // Emit pending ROOM event (task 020)
      _emitSystemEvent(SystemEvent(
        id: 'room-boot',
        type: SystemEventType.room,
        status: SystemEventStatus.pending,
        message: 'connecting...',
        timestamp: DateTime.now(),
        prefix: '\u25B8',
      ));

      debugPrint('[Fletcher] Connecting to $url');
      await _room!.connect(url, token);

      debugPrint('[Fletcher] Connected to room');
      _localParticipant = _room!.localParticipant;

      // Update ROOM event to success with room name (task 020)
      final roomDisplayName = _currentRoomName ?? 'room';
      _emitSystemEvent(SystemEvent(
        id: 'room-boot',
        type: SystemEventType.room,
        status: SystemEventStatus.success,
        message: '$roomDisplayName \u00B7 joined',
        timestamp: DateTime.now(),
        prefix: '\u25B8',
      ));

      _reconnectScheduler.reset();
      _reconnecting = false;
      healthService.updateRoomConnected(connected: true);

      // Check if agent is already in the room
      final hasAgent = _room!.remoteParticipants.isNotEmpty;
      debugPrint('[Fletcher] Room joined: participants=${_room!.remoteParticipants.length} agent=$hasAgent');
      healthService.updateAgentPresent(present: hasAgent);

      // Populate diagnostics with session info
      final agentId = hasAgent
          ? _room!.remoteParticipants.values.first.identity
          : null;
      _updateState(
        diagnostics: _state.diagnostics.copyWith(
          connectedAt: DateTime.now(),
          sessionName: _currentRoomName,
          agentIdentity: agentId,
        ),
      );

      // BUG-001: Only publish the mic track if the user is NOT muted.
      // Publishing creates an RtpSender in the PeerConnection, which causes
      // WebRTC's native layer to hold the AudioRecord open — blocking
      // Android keyboard STT. When muted, skip publishing entirely.
      if (!_isMuted) {
        await _localParticipant!.setMicrophoneEnabled(true);
      }
      debugPrint('[Fletcher] Audio config: AEC=on NS=on AGC=on voiceIsolation=on highPass=on bitrate=speech(24k) dtx=on');

      _startAudioLevelMonitoring();
      _subscribeToDeviceChanges();
      _subscribeToConnectivity();

      // Start foreground service to prevent Android from silencing
      // the microphone when the app goes to background (BUG-022)
      await _startForegroundService();

      // Enable agent presence service for on-demand dispatch (Epic 20).
      // Derive dispatch URL from the LiveKit URL (same host, token server port).
      if (_currentRoomName != null) {
        final uri = Uri.parse(url);
        final dispatchBaseUrl = 'http://${uri.host}:$_tokenServerPort';
        agentPresenceService.updateDispatchBaseUrl(dispatchBaseUrl);
        agentPresenceService.enable(_currentRoomName!);
      }

      // Send text-only mode state to agent on connect (TASK-030)
      if (_textOnlyMode) {
        await _sendTtsMode();
      }

      _updateState(
        status: _isMuted ? ConversationStatus.muted : ConversationStatus.idle,
      );
    } catch (e) {
      debugPrint('[Fletcher] Connection failed: $e');
      healthService.updateRoomConnected(connected: false, errorDetail: e.toString());
      _updateState(
        status: ConversationStatus.error,
        errorMessage: e.toString(),
      );
    }
  }

  void _setupRoomListeners() {
    // SDK reconnection events — the SDK tries up to 10 reconnects (~40s)
    // before firing RoomDisconnectedEvent. Show feedback during that window.
    _listener?.on<RoomReconnectingEvent>((_) {
      debugPrint('[Fletcher] SDK reconnecting...');
      // Start the budget clock NOW — not when the SDK gives up. The server's
      // departure_timeout counts from the first disconnect, so the app's
      // budget must too. begin() is idempotent (won't reset if already started).
      _reconnectScheduler.begin();
      _updateState(status: ConversationStatus.reconnecting);
      healthService.updateRoomReconnecting();
      // Emit room reconnecting system event (task 020)
      _emitSystemEvent(SystemEvent(
        id: 'room-reconnect-${DateTime.now().millisecondsSinceEpoch}',
        type: SystemEventType.room,
        status: SystemEventStatus.error,
        message: 'disconnected \u00B7 reconnecting...',
        timestamp: DateTime.now(),
        prefix: '\u2715',
      ));
      // Buffer mic audio during reconnection (BUG-027)
      _reconnectBuffer?.reset();
      _reconnectBuffer = PreConnectAudioBuffer(_room!);
      _reconnectBuffer!.startRecording(timeout: const Duration(seconds: 60));
    });

    _listener?.on<RoomAttemptReconnectEvent>((event) {
      // Start the budget clock on the FIRST SDK reconnect attempt — not when
      // the SDK gives up. The server's departure_timeout counts from the first
      // disconnect, so the app's budget must too. begin() is idempotent (won't
      // reset if already started). We use this event rather than
      // RoomReconnectingEvent because the SDK doesn't always fire that event.
      _reconnectScheduler.begin();
      debugPrint(
        '[Fletcher] SDK reconnect attempt ${event.attempt}/${event.maxAttemptsRetry} '
        '(next retry in ${event.nextRetryDelaysInMs}ms)',
      );
    });

    _listener?.on<RoomReconnectedEvent>((_) async {
      debugPrint('[Fletcher] SDK reconnected successfully');
      _reconnectScheduler.reset();
      _reconnecting = false;
      healthService.updateRoomConnected(connected: true);
      // Emit room reconnected system event (task 020)
      final roomName = _currentRoomName ?? 'room';
      _emitSystemEvent(SystemEvent(
        id: 'room-reconnected-${DateTime.now().millisecondsSinceEpoch}',
        type: SystemEventType.room,
        status: SystemEventStatus.success,
        message: '$roomName \u00B7 reconnected',
        timestamp: DateTime.now(),
        prefix: '\u25B8',
      ));
      // Restore status: respect mute state, otherwise go idle
      _updateState(
        status: _isMuted ? ConversationStatus.muted : ConversationStatus.idle,
      );

      // Resend text-only mode state after reconnect (TASK-030)
      if (_textOnlyMode) {
        await _sendTtsMode();
      }

      // Flush buffered audio to agent(s) after reconnection (BUG-027)
      if (_reconnectBuffer != null) {
        final agents = _room!.remoteParticipants.values
            .where((p) => p.kind == ParticipantKind.AGENT)
            .map((p) => p.identity)
            .toList();
        if (agents.isNotEmpty) {
          try {
            await _reconnectBuffer!.sendAudioData(agents: agents);
          } catch (e) {
            debugPrint('[Fletcher] Failed to send reconnect audio buffer: $e');
          }
        }
        await _reconnectBuffer!.reset();
        _reconnectBuffer = null;
      }

      // After reconnection, refresh audio track to restore BT routing.
      // Network transitions (WiFi→cellular) tear down the old audio session,
      // causing Android to fall back to speaker. restartTrack() re-establishes
      // the correct audio route (BT SCO if headset is connected). (BUG-021)
      _refreshAudioTrack();
    });

    _listener?.on<RoomDisconnectedEvent>((event) async {
      final reason = event.reason ?? DisconnectReason.unknown;
      debugPrint('[Fletcher] Disconnected: $reason');
      healthService.updateAgentPresent(present: false);
      // Emit room disconnected system event (task 020)
      _emitSystemEvent(SystemEvent(
        id: 'room-disconnect-${DateTime.now().millisecondsSinceEpoch}',
        type: SystemEventType.room,
        status: SystemEventStatus.error,
        message: 'disconnected \u00B7 $reason',
        timestamp: DateTime.now(),
        prefix: '\u2715',
      ));
      // Clean up reconnect buffer — room is disconnecting, can't send via it
      await _reconnectBuffer?.reset();
      _reconnectBuffer = null;

      if (dr.shouldReconnect(reason)) {
        healthService.updateRoomConnected(
          connected: false,
          errorDetail: 'Disconnected ($reason)',
        );
        _reconnectRoom();
      } else {
        healthService.updateRoomConnected(
          connected: false,
          errorDetail: dr.disconnectMessage(reason),
        );
        _updateState(
          status: ConversationStatus.error,
          errorMessage: dr.disconnectMessage(reason),
        );
      }
    });

    _listener?.on<ParticipantConnectedEvent>((event) {
      debugPrint('[Fletcher] Remote participant connected: ${event.participant.identity}');
      healthService.updateAgentPresent(present: true);
      // Update diagnostics with agent identity
      _updateState(
        diagnostics: _state.diagnostics.copyWith(
          agentIdentity: event.participant.identity,
        ),
      );
      // Notify agent presence service (Epic 20)
      agentPresenceService.onAgentConnected();
      // Flush any text messages queued while agent was absent
      _flushPendingTextMessages();
      // Re-sync TTS mode with new agent after idle disconnect (BUG-004)
      if (_textOnlyMode) {
        _sendTtsMode();
      }
      // Emit/update agent connected system event (task 020)
      _emitSystemEvent(SystemEvent(
        id: 'agent-boot',
        type: SystemEventType.agent,
        status: SystemEventStatus.success,
        message: 'connected \u00B7 ready',
        timestamp: DateTime.now(),
        prefix: '\u25B8',
      ));
    });

    _listener?.on<ParticipantDisconnectedEvent>((event) {
      final remaining = _room?.remoteParticipants.length ?? 0;
      debugPrint('[Fletcher] Remote participant disconnected: ${event.participant.identity} (remaining=$remaining)');
      healthService.updateAgentPresent(present: remaining > 0);
      // Clear agent identity if no agents remain
      if (remaining == 0) {
        _updateState(
          diagnostics: _state.diagnostics.copyWith(clearAgentIdentity: true),
        );
        // Notify agent presence service (Epic 20)
        agentPresenceService.onAgentDisconnected();
        // Reset segment ID so artifacts from the new session are not stamped
        // with the stale ID from the previous session. (BUG-004)
        _lastAgentSegmentId = null;
      }
      // Emit agent disconnected system event (task 020)
      _emitSystemEvent(SystemEvent(
        id: 'agent-disconnect-${DateTime.now().millisecondsSinceEpoch}',
        type: SystemEventType.agent,
        status: SystemEventStatus.error,
        message: 'disconnected',
        timestamp: DateTime.now(),
        prefix: '\u2715',
      ));
    });

    _listener?.on<TrackSubscribedEvent>((event) {
      debugPrint('[Fletcher] Track subscribed: ${event.track.kind} from ${event.participant.identity}');
    });

    _listener?.on<TrackUnsubscribedEvent>((event) {
      debugPrint('[Fletcher] Track unsubscribed: ${event.track.kind} from ${event.participant.identity}');
      // If the agent's audio track is unsubscribed during a network transition,
      // keep the reconnecting state visible until re-subscribed. Without this,
      // the UI briefly shows "idle" during the 55s publish gap. (BUG-021)
      //
      // Guard: do not show the reconnecting banner when the agent is
      // disconnecting intentionally (idle timeout, on-demand dispatch
      // lifecycle). The agent presence UX (Task 007 system events) already
      // communicates what happened. (Epic 20, Task 009)
      if (event.track.kind == TrackType.AUDIO) {
        final isIntentionalDisconnect = agentPresenceService.enabled &&
            (agentPresenceService.state == AgentPresenceState.idleWarning ||
                agentPresenceService.state == AgentPresenceState.agentAbsent);
        if (!isIntentionalDisconnect) {
          _updateState(status: ConversationStatus.reconnecting);
        }
      }
    });

    // Subscribe to ganglia events via data channel
    _listener?.on<DataReceivedEvent>((event) {
      _handleDataReceived(event);
    });

    // Subscribe to transcription text streams from the voice agent (livekit-agents >= 1.0)
    _room!.registerTextStreamHandler(
      'lk.transcription',
      _handleTranscriptionStream,
    );
  }

  // ---------------------------------------------------------------------------
  // Transcription handling (text stream protocol)
  // ---------------------------------------------------------------------------

  /// Segment state tracked per (segmentId, participantIdentity) pair.
  final Map<String, String> _segmentContent = {};

  void _handleTranscriptionStream(
      TextStreamReader reader, String participantIdentity) {
    final info = reader.info;
    if (info == null) return;

    final attributes = info.attributes;
    final segmentId = attributes['lk.segment_id'] ?? info.id;
    final isLocal = participantIdentity == _localParticipant?.identity;
    final role = isLocal ? TranscriptRole.user : TranscriptRole.agent;
    // Agent transcripts are delta-streamed (append chunks); user transcripts
    // are full-replacement (each chunk is the complete text so far).
    final isDelta = !isLocal;

    reader.listen(
      (chunk) {
        final text = utf8.decode(chunk.content);
        if (text.isEmpty) return;

        if (isDelta) {
          _segmentContent[segmentId] =
              (_segmentContent[segmentId] ?? '') + text;
        } else {
          _segmentContent[segmentId] = text;
        }

        _upsertTranscript(
          segmentId: segmentId,
          role: role,
          text: _segmentContent[segmentId]!,
          isFinal: false,
        );
      },
      onDone: () {
        final isFinal =
            (attributes['lk.transcription_final'] ?? '').toLowerCase() ==
                'true';
        final text = _segmentContent.remove(segmentId) ?? '';

        _upsertTranscript(
          segmentId: segmentId,
          role: role,
          text: text,
          isFinal: isFinal,
        );
      },
    );
  }

  void _upsertTranscript({
    required String segmentId,
    required TranscriptRole role,
    required String text,
    required bool isFinal,
  }) {
    final entry = TranscriptEntry(
      id: segmentId,
      role: role,
      text: text,
      isFinal: isFinal,
      timestamp: DateTime.now(),
    );

    final transcript = List<TranscriptEntry>.from(_state.transcript);
    final existingIdx = transcript.indexWhere((e) => e.id == segmentId);
    if (existingIdx >= 0) {
      transcript[existingIdx] = entry;
    } else {
      transcript.add(entry);
    }

    while (transcript.length > _maxTranscriptEntries) {
      transcript.removeAt(0);
    }

    if (role == TranscriptRole.user) {
      _userSubtitleClearTimer?.cancel();
      _updateState(
        transcript: transcript,
        currentUserTranscript: entry,
      );
      if (isFinal) {
        _userSubtitleClearTimer = Timer(const Duration(seconds: 3), () {
          _updateState(clearCurrentUserTranscript: true);
        });
      }
    } else {
      _agentSubtitleClearTimer?.cancel();
      _updateState(
        transcript: transcript,
        currentAgentTranscript: entry,
      );
      if (isFinal) {
        _agentSubtitleClearTimer = Timer(const Duration(seconds: 3), () {
          _updateState(clearCurrentAgentTranscript: true);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Ganglia data channel handling
  // ---------------------------------------------------------------------------

  /// Handles data received from the voice agent via data channel
  void _handleDataReceived(DataReceivedEvent event) {
    // Only process ganglia-events topic
    if (event.topic != 'ganglia-events') return;

    try {
      final jsonStr = utf8.decode(event.data);
      final json = jsonDecode(jsonStr) as Map<String, dynamic>;
      final eventType = json['type'] as String?;

      if (eventType == 'chunk') {
        _handleChunk(json);
        return;
      }

      _processGangliaEvent(json);
    } catch (e) {
      debugPrint('[Ganglia] Failed to parse event: $e');
    }
  }

  void _handleChunk(Map<String, dynamic> chunk) {
    final transferId = chunk['transfer_id'] as String;
    final chunkIndex = chunk['chunk_index'] as int;
    final totalChunks = chunk['total_chunks'] as int;
    final data = chunk['data'] as String; // Base64 encoded

    // Initialize buffer if needed
    if (!_chunks.containsKey(transferId)) {
      _chunks[transferId] = List<String?>.filled(totalChunks, null);
    }

    // Store chunk
    _chunks[transferId]![chunkIndex] = data;

    // Check if complete
    if (_chunks[transferId]!.every((c) => c != null)) {
      debugPrint('[Ganglia] Reassembling chunked message $transferId');

      try {
        final allBytes = <int>[];
        for (final part in _chunks[transferId]!) {
          allBytes.addAll(base64Decode(part!));
        }

        final reassembledJsonStr = utf8.decode(allBytes);
        final reassembledJson = jsonDecode(reassembledJsonStr) as Map<String, dynamic>;

        _processGangliaEvent(reassembledJson);
      } catch (e) {
        debugPrint('[Ganglia] Failed to reassemble chunks: $e');
      } finally {
        // Cleanup
        _chunks.remove(transferId);
      }
    }
  }

  void _processGangliaEvent(Map<String, dynamic> json) {
    final eventType = json['type'] as String?;

    if (eventType == 'status') {
      final statusEvent = StatusEvent.fromJson(json);
      _updateState(currentStatus: statusEvent);
      debugPrint('[Ganglia] Status: ${statusEvent.displayText}');

      // Clear status after 5 seconds of inactivity
      _statusClearTimer?.cancel();
      _statusClearTimer = Timer(const Duration(seconds: 5), () {
        _updateState(clearStatus: true);
      });
    } else if (eventType == 'artifact') {
      final artifactEvent = ArtifactEvent.fromJson(json);
      // Associate artifact with the most recent agent message (TASK-023).
      // If no agent message exists yet, messageId stays null and the
      // ChatTranscript will use the fallback (nearest prior agent message).
      final stamped = _lastAgentSegmentId != null
          ? artifactEvent.withMessageId(_lastAgentSegmentId)
          : artifactEvent;
      final newArtifacts = [..._state.artifacts, stamped];
      // Keep only last 10 artifacts
      if (newArtifacts.length > 10) {
        newArtifacts.removeAt(0);
      }
      _updateState(artifacts: newArtifacts);
      debugPrint('[Ganglia] Artifact: ${stamped.displayTitle} (msg=${stamped.messageId})');
    } else if (eventType == 'agent_transcript') {
      // Agent transcript forwarded directly from Ganglia LLM content stream.
      // Bypasses the SDK's lk.transcription pipeline which breaks when the
      // speech handle is interrupted before text forwarding is created.
      final segmentId = json['segmentId'] as String? ?? 'unknown';
      final text = json['text'] as String? ?? '';
      final isFinal = json['final'] == true;
      if (text.isNotEmpty) {
        // Track the latest agent segment ID for artifact association (TASK-023)
        _lastAgentSegmentId = segmentId;

        // Stop thinking spinner once agent text starts streaming
        if (_state.isAgentThinking) {
          _updateState(isAgentThinking: false);
        }
        _upsertTranscript(
          segmentId: segmentId,
          role: TranscriptRole.agent,
          text: text,
          isFinal: isFinal,
        );
      }
    } else if (eventType == 'user_transcript') {
      // User STT transcript forwarded from voice agent (BUG-012 fix).
      // The SDK's lk.transcription forwarding is disabled alongside agent
      // transcription (outputOptions.transcriptionEnabled = false), so we
      // publish user transcripts via the data channel instead.
      final segmentId = json['segmentId'] as String? ?? 'unknown';
      final text = json['text'] as String? ?? '';
      final isFinal = json['final'] == true;
      if (text.isNotEmpty) {
        _upsertTranscript(
          segmentId: segmentId,
          role: TranscriptRole.user,
          text: text,
          isFinal: isFinal,
        );
      }
    } else if (eventType == 'pipeline_info') {
      // Pipeline provider info sent by the voice agent (BUG-013).
      // Expected shape: { type: "pipeline_info", stt: "deepgram", tts: "google", llm: "openclaw" }
      _updateState(
        diagnostics: _state.diagnostics.copyWith(
          sttProvider: json['stt'] as String?,
          ttsProvider: json['tts'] as String?,
          llmProvider: json['llm'] as String?,
        ),
      );
    } else if (eventType == 'agent-idle-warning') {
      // Agent is about to disconnect due to idle timeout (Epic 20).
      // Expected shape: { type: "agent-idle-warning", disconnectInMs: 30000 }
      final disconnectInMs = json['disconnectInMs'] as int? ?? 30000;
      debugPrint(
          '[Ganglia] Agent idle warning — disconnect in ${disconnectInMs}ms');
      onAgentIdleWarning?.call(disconnectInMs);
    } else if (eventType == 'agent-disconnected') {
      // Agent has disconnected due to idle timeout (Epic 20).
      // Expected shape: { type: "agent-disconnected", reason: "idle_timeout" }
      final reason = json['reason'] as String? ?? 'unknown';
      debugPrint('[Ganglia] Agent disconnected — reason: $reason');
      onAgentDisconnected?.call(reason);
    } else if (eventType == 'agent-warm-down') {
      // Agent entering warm-down period before disconnect (Epic 20 / Task 006).
      debugPrint('[Ganglia] Agent entering warm-down');
      onAgentWarmDown?.call();
    } else if (eventType == 'agent-warm-down-cancelled') {
      // Agent warm-down cancelled (user spoke) (Epic 20 / Task 006).
      debugPrint('[Ganglia] Agent warm-down cancelled');
      onAgentWarmDownCancelled?.call();
    }
  }

  /// Clears all artifacts from the state
  void clearArtifacts() {
    _updateState(artifacts: []);
  }

  // ---------------------------------------------------------------------------
  // Audio level monitoring (using Participant.audioLevel)
  // ---------------------------------------------------------------------------

  void _startAudioLevelMonitoring() {
    _audioLevelTimer?.cancel();
    _audioLevelTimer = Timer.periodic(
      const Duration(milliseconds: 100),
      (_) => _updateAudioLevels(),
    );
  }

  // ---------------------------------------------------------------------------
  // Network connectivity monitoring
  // ---------------------------------------------------------------------------

  void _subscribeToConnectivity() {
    _connectivitySub?.cancel();
    // Sync initial state to health service
    final initialOnline = connectivityService.isOnline;
    debugPrint('[Fletcher] Network status: online=$initialOnline');
    healthService.updateNetworkStatus(online: initialOnline);
    _connectivitySub =
        connectivityService.onConnectivityChanged.listen((online) {
      debugPrint('[Fletcher] Network changed: online=$online');
      healthService.updateNetworkStatus(online: online);
      // Emit inline network status event (task 020)
      final ts = DateTime.now().millisecondsSinceEpoch;
      if (online) {
        _emitSystemEvent(SystemEvent(
          id: 'network-$ts',
          type: SystemEventType.network,
          status: SystemEventStatus.pending,
          message: 'switching...',
          timestamp: DateTime.now(),
          prefix: '\u26A1',
        ));
      } else {
        _emitSystemEvent(SystemEvent(
          id: 'network-$ts',
          type: SystemEventType.network,
          status: SystemEventStatus.error,
          message: 'offline',
          timestamp: DateTime.now(),
          prefix: '\u2715',
        ));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Audio device change → refresh audio track
  // ---------------------------------------------------------------------------

  void _subscribeToDeviceChanges() {
    _deviceChangeSub?.cancel();
    _deviceChangeSub = Hardware.instance.onDeviceChange.stream.listen((_) {
      _onDeviceChange();
    });
  }

  void _onDeviceChange() {
    // Skip if already refreshing audio or fully disconnected
    if (_isRefreshingAudio || _reconnecting || _room == null) {
      debugPrint('[Fletcher] Device change ignored: refreshing=$_isRefreshingAudio reconnecting=$_reconnecting room=${_room != null}');
      return;
    }

    debugPrint('[Fletcher] Device change detected — debouncing (2s)');
    // Debounce: Bluetooth transitions fire multiple rapid events and need
    // more settling time than wired headphones
    _deviceChangeDebounce?.cancel();
    _deviceChangeDebounce = Timer(const Duration(seconds: 2), () {
      _refreshAudioTrack();
    });
  }

  Future<void> _refreshAudioTrack() async {
    if (_isRefreshingAudio || _localParticipant == null) return;
    _isRefreshingAudio = true;

    debugPrint('[Fletcher] Audio device changed — refreshing audio track');

    try {
      // Wait for the OS to settle the new Bluetooth audio route
      await Future.delayed(const Duration(seconds: 1));

      // Use restartTrack() to swap the audio capture source via WebRTC's
      // replaceTrack(). This picks up the new active device WITHOUT
      // unpublishing — the agent session stays alive.
      final publication = _localParticipant!.audioTrackPublications.firstOrNull;
      final track = publication?.track;
      if (track != null && !_isMuted) {
        await track.restartTrack();
        debugPrint('[Fletcher] Audio track restarted successfully');
      }
    } catch (e) {
      debugPrint('[Fletcher] Audio track refresh failed: $e');
    } finally {
      _isRefreshingAudio = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Foreground service — keeps microphone active in background (BUG-022)
  // ---------------------------------------------------------------------------

  /// Start foreground service to maintain microphone access in background.
  /// Must be called while the app is in foreground (Android 14+ restriction).
  Future<void> _startForegroundService() async {
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'fletcher_voice',
        channelName: 'Voice Session',
        channelDescription: 'Keeps microphone active during voice conversations',
        channelImportance: NotificationChannelImportance.LOW,
        priority: NotificationPriority.LOW,
      ),
      iosNotificationOptions: const IOSNotificationOptions(
        showNotification: false,
      ),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.nothing(),
        autoRunOnBoot: false,
        allowWifiLock: true,
      ),
    );
    await FlutterForegroundTask.startService(
      notificationTitle: 'Fletcher',
      notificationText: 'Voice session active',
    );
    debugPrint('[Fletcher] Foreground service started');
  }

  Future<void> _stopForegroundService() async {
    await FlutterForegroundTask.stopService();
    debugPrint('[Fletcher] Foreground service stopped');
  }

  void _updateAudioLevels() {
    if (_room == null) return;

    // Get local (user) audio level from Participant.audioLevel (server-computed, 0.0-1.0)
    final userLevel = _localParticipant?.audioLevel ?? 0.0;

    // Get remote (AI) audio level
    double aiLevel = 0.0;
    for (final participant in _room!.remoteParticipants.values) {
      if (participant.audioLevel > aiLevel) {
        aiLevel = participant.audioLevel;
      }
    }

    // Detect speech via audio levels when agent is absent (Epic 20).
    // Uses consecutive frame counting instead of a separate VAD mic capture
    // to avoid mic conflicts with LiveKit's audio session.
    if (agentPresenceService.enabled &&
        agentPresenceService.state == AgentPresenceState.agentAbsent &&
        !_isMuted) {
      if (userLevel > _speechThreshold) {
        _speechFrameCount++;
        if (_speechFrameCount >= _speechFramesRequired) {
          debugPrint('[Fletcher] Speech detected via audio levels — triggering dispatch');
          _speechFrameCount = 0;
          agentPresenceService.onSpeechDetected();
        }
      } else {
        _speechFrameCount = 0;
      }
    }

    // Update waveform buffers
    _userWaveformBuffer.add(userLevel);
    if (_userWaveformBuffer.length > _maxWaveformSamples) {
      _userWaveformBuffer.removeAt(0);
    }
    _aiWaveformBuffer.add(aiLevel);
    if (_aiWaveformBuffer.length > _maxWaveformSamples) {
      _aiWaveformBuffer.removeAt(0);
    }

    // Update state based on audio levels
    ConversationStatus newStatus = _state.status;

    if (_isMuted) {
      newStatus = ConversationStatus.muted;
    } else if (_state.status == ConversationStatus.error ||
        _state.status == ConversationStatus.reconnecting) {
      // Keep error/reconnecting state
    } else if (aiLevel > 0.05) {
      newStatus = ConversationStatus.aiSpeaking;
      // Agent is speaking — stop thinking spinner
      if (_state.isAgentThinking) {
        _updateState(isAgentThinking: false);
      }
      // Measure round-trip latency: user speech end → agent speech start
      if (_state.status != ConversationStatus.aiSpeaking &&
          _userSpeechEndTime != null) {
        final rtMs = DateTime.now()
            .difference(_userSpeechEndTime!)
            .inMilliseconds;
        _userSpeechEndTime = null;
        _updateState(
          diagnostics: _state.diagnostics.copyWith(roundTripMs: rtMs),
        );
      }
    } else if (userLevel > 0.05) {
      newStatus = ConversationStatus.userSpeaking;
      // Clear previous speech end time while user is still speaking
      _userSpeechEndTime = null;
    } else if (_state.status == ConversationStatus.userSpeaking ||
        _state.status == ConversationStatus.aiSpeaking) {
      // Brief processing state after speaking stops
      newStatus = ConversationStatus.processing;
      // Record when user stopped speaking for RT measurement
      if (_state.status == ConversationStatus.userSpeaking) {
        _userSpeechEndTime = DateTime.now();
        _updateState(isAgentThinking: true);
      }
      // Return to idle after short delay
      Future.delayed(const Duration(milliseconds: 500), () {
        if (_state.status == ConversationStatus.processing) {
          _updateState(
            status: ConversationStatus.idle,
            isAgentThinking: false,
          );
        }
      });
    } else if (_state.status != ConversationStatus.processing) {
      newStatus = ConversationStatus.idle;
    }

    _updateState(
      status: newStatus,
      userAudioLevel: userLevel,
      aiAudioLevel: aiLevel,
      userWaveform: List<double>.from(_userWaveformBuffer),
      aiWaveform: List<double>.from(_aiWaveformBuffer),
    );
  }

  Future<void> toggleMute() async {
    _isMuted = !_isMuted;
    debugPrint('[Fletcher] Mute toggled: muted=$_isMuted');

    if (_isMuted) {
      _updateState(status: ConversationStatus.muted);
      // BUG-001: setMicrophoneEnabled(false) only mutes the track — the
      // RtpSender stays in the PeerConnection and WebRTC's native layer
      // keeps the AudioRecord open. We must fully unpublish the track
      // (removePublishedTrack) which calls pc.removeTrack(sender) +
      // SDP renegotiation, causing the native layer to release AudioRecord
      // so Android keyboard STT can access the mic.
      final pub = _localParticipant?.getTrackPublicationBySource(TrackSource.microphone);
      if (pub != null) {
        await _localParticipant!.removePublishedTrack(pub.sid);
        debugPrint('[Fletcher] Audio track unpublished (mic released for OS)');
      } else {
        // Fallback: no publication found, just disable
        await _localParticipant?.setMicrophoneEnabled(false);
      }
    } else {
      _updateState(status: ConversationStatus.idle);
      // Unmuting while the agent is absent is a strong intent signal —
      // dispatch immediately for a ~300-500ms head start before audio-level
      // speech detection kicks in. (Epic 20, Task 010)
      if (agentPresenceService.enabled &&
          agentPresenceService.state == AgentPresenceState.agentAbsent) {
        debugPrint('[Fletcher] Unmute while agent absent — triggering dispatch');
        agentPresenceService.onSpeechDetected();
      }
      // Republish a fresh audio track — setMicrophoneEnabled(true) creates
      // a new LocalAudioTrack and publishes it to the PeerConnection.
      await _localParticipant?.setMicrophoneEnabled(true);
    }
    debugPrint('[Fletcher] Mic ${_isMuted ? "stopped" : "started"}');
  }

  // ---------------------------------------------------------------------------
  // Text-only mode — toggle TTS on/off via data channel (TASK-030)
  // ---------------------------------------------------------------------------

  /// Send a JSON event to the agent via the ganglia-events data channel.
  Future<void> _sendEvent(Map<String, dynamic> event) async {
    final participant = _localParticipant;
    if (participant == null) return;
    final data = utf8.encode(jsonEncode(event));
    await participant.publishData(data, reliable: true, topic: 'ganglia-events');
  }

  /// Toggle text-only mode (TTS off). Persists preference and notifies agent.
  Future<void> toggleTextOnlyMode() async {
    _textOnlyMode = !_textOnlyMode;
    debugPrint('[Fletcher] Text-only mode toggled: $_textOnlyMode');
    await SessionStorage.saveTextOnlyMode(_textOnlyMode);
    await _sendTtsMode();
    notifyListeners();
  }

  /// Send current TTS mode state to the agent.
  Future<void> _sendTtsMode() async {
    await _sendEvent({
      'type': 'tts-mode',
      'value': _textOnlyMode ? 'off' : 'on',
    });
  }

  // ---------------------------------------------------------------------------
  // Text input mode — safety hatch for noisy/quiet environments (Epic 17)
  // ---------------------------------------------------------------------------

  /// Toggle between voice-first and text-input modes.
  ///
  /// When entering text-input mode, any active mute state is preserved.
  /// When reverting to voice-first mode, the text input cleanup happens
  /// at the widget layer (clearing text, dismissing keyboard).
  Future<void> toggleInputMode() async {
    final current = _state.inputMode;
    final next = current == TextInputMode.voiceFirst
        ? TextInputMode.textInput
        : TextInputMode.voiceFirst;
    debugPrint('[Fletcher] Input mode toggled: $current → $next');
    _state = _state.copyWith(inputMode: next);

    // Auto-mute mic when entering text mode, unmute when reverting to voice.
    // Await so the OS mic resource is fully released before the keyboard
    // appears — this lets Android STT use the mic without conflict.
    if (next == TextInputMode.textInput && !_isMuted) {
      await toggleMute();
    } else if (next == TextInputMode.voiceFirst && _isMuted) {
      await toggleMute();
    }

    notifyListeners();
  }

  /// Send a text message through the LiveKit data channel.
  ///
  /// The message is sent as a `text_message` event on the `ganglia-events`
  /// topic, keeping it within the existing voice session. The user's message
  /// is also added to the local transcript immediately (optimistic update).
  Future<void> sendTextMessage(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;

    debugPrint('[Fletcher] Sending text message: ${trimmed.length} chars');

    // Trigger agent dispatch if agent is absent (Epic 20)
    agentPresenceService.onTextMessageSent();

    // Optimistic: add to local transcript immediately
    final entry = TranscriptEntry(
      id: 'text-${DateTime.now().millisecondsSinceEpoch}',
      role: TranscriptRole.user,
      text: trimmed,
      isFinal: true,
      timestamp: DateTime.now(),
      origin: MessageOrigin.text,
    );

    final updatedTranscript = List<TranscriptEntry>.from(_state.transcript)
      ..add(entry);
    // Trim to max entries
    if (updatedTranscript.length > _maxTranscriptEntries) {
      updatedTranscript.removeRange(
        0,
        updatedTranscript.length - _maxTranscriptEntries,
      );
    }
    _updateState(transcript: updatedTranscript);

    // If agent is absent/dispatching, queue the message for delivery
    // once the agent connects. Otherwise send immediately.
    final agentState = agentPresenceService.state;
    if (agentPresenceService.enabled &&
        (agentState == AgentPresenceState.agentAbsent ||
         agentState == AgentPresenceState.dispatching)) {
      debugPrint('[Fletcher] Agent absent — queuing text message for delivery');
      _pendingTextMessages.add(trimmed);
    } else {
      await _sendEvent({
        'type': 'text_message',
        'text': trimmed,
      });
    }
  }

  /// Send any text messages that were queued while the agent was absent.
  Future<void> _flushPendingTextMessages() async {
    if (_pendingTextMessages.isEmpty) return;
    debugPrint('[Fletcher] Flushing ${_pendingTextMessages.length} queued text message(s)');
    for (final text in _pendingTextMessages) {
      await _sendEvent({
        'type': 'text_message',
        'text': text,
      });
    }
    _pendingTextMessages.clear();
  }

  void _updateState({
    ConversationStatus? status,
    double? userAudioLevel,
    double? aiAudioLevel,
    String? errorMessage,
    List<TranscriptEntry>? transcript,
    StatusEvent? currentStatus,
    bool clearStatus = false,
    List<ArtifactEvent>? artifacts,
    List<double>? userWaveform,
    List<double>? aiWaveform,
    TranscriptEntry? currentUserTranscript,
    bool clearCurrentUserTranscript = false,
    TranscriptEntry? currentAgentTranscript,
    bool clearCurrentAgentTranscript = false,
    List<SystemEvent>? systemEvents,
    bool? isAgentThinking,
    DiagnosticsInfo? diagnostics,
  }) {
    _state = _state.copyWith(
      status: status,
      userAudioLevel: userAudioLevel,
      aiAudioLevel: aiAudioLevel,
      errorMessage: errorMessage,
      transcript: transcript,
      currentStatus: currentStatus,
      clearStatus: clearStatus,
      artifacts: artifacts,
      userWaveform: userWaveform,
      aiWaveform: aiWaveform,
      currentUserTranscript: currentUserTranscript,
      clearCurrentUserTranscript: clearCurrentUserTranscript,
      currentAgentTranscript: currentAgentTranscript,
      clearCurrentAgentTranscript: clearCurrentAgentTranscript,
      systemEvents: systemEvents,
      isAgentThinking: isAgentThinking,
      diagnostics: diagnostics,
    );
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Agent presence service (Epic 20)
  // ---------------------------------------------------------------------------

  AgentPresenceService _createAgentPresenceService() {
    final localVad = LocalVadService(onSpeechDetected: () {
      agentPresenceService.onSpeechDetected();
    });

    // Token server base URL derived from the first configured URL.
    // Dispatch service is created eagerly; the actual URL is only used when
    // dispatchAgent() is called, by which point we have a valid URL.
    final dispatchService = AgentDispatchService(
      baseUrl: 'http://localhost:$_tokenServerPort',
    );

    final service = AgentPresenceService(
      localVad: localVad,
      dispatchService: dispatchService,
      onSystemEvent: (id, category, message) {
        // Map the presence event to a SystemEvent status:
        // - "Connecting..." / "Going idle..." = pending
        // - "Connected" / "Staying connected" = success
        // - "Disconnected..." = error (visual distinction)
        final SystemEventStatus status;
        final String prefix;
        if (id == 'agent-dispatching' || id == 'agent-idle-warning') {
          status = SystemEventStatus.pending;
          prefix = '\u25B8'; // ▸
        } else if (id == 'agent-idle-disconnect') {
          status = SystemEventStatus.error;
          prefix = '\u2715'; // ✕
        } else {
          status = SystemEventStatus.success;
          prefix = '\u25B8'; // ▸
        }
        _emitSystemEvent(SystemEvent(
          id: 'agent-presence-$id',
          type: SystemEventType.agent,
          status: status,
          message: message,
          timestamp: DateTime.now(),
          prefix: prefix,
        ));
      },
    );

    // Wire data channel callbacks to presence service
    onAgentIdleWarning = (disconnectInMs) {
      service.onIdleWarning(disconnectInMs);
    };
    onAgentDisconnected = (reason) {
      service.onAgentIdleDisconnect();
    };

    return service;
  }

  // ---------------------------------------------------------------------------
  // Inline system events (task 020)
  // ---------------------------------------------------------------------------

  /// Emit or update a system event in the conversation state.
  ///
  /// Events with the same [SystemEvent.id] are updated in place (status
  /// transitions), not duplicated.
  void _emitSystemEvent(SystemEvent event) {
    final events = List<SystemEvent>.from(_state.systemEvents);
    final idx = events.indexWhere((e) => e.id == event.id);
    if (idx >= 0) {
      events[idx] = event;
    } else {
      events.add(event);
    }
    _updateState(systemEvents: events);
  }

  /// Describe the transport type from a resolved URL.
  ///
  /// Parses the host to determine tailscale (100.x.x.x), emulator
  /// (10.0.2.2), or LAN.
  static String _describeTransport(String url) {
    try {
      final uri = Uri.parse(url);
      final host = uri.host;
      if (host.startsWith('100.')) return 'tailscale $host';
      if (host == '10.0.2.2') return 'emulator $host';
      return 'lan $host';
    } catch (_) {
      return url;
    }
  }

  // ---------------------------------------------------------------------------
  // Room reconnection logic (sleep/disconnect recovery)
  // ---------------------------------------------------------------------------

  /// Whether a room reconnection attempt is currently in progress.
  bool get isReconnecting => _reconnecting;

  /// Attempt to reconnect to the room using stored credentials.
  ///
  /// Two-phase network-aware strategy:
  /// - If offline, show "Waiting for network..." and subscribe to
  ///   connectivity changes. Retries start when the network returns.
  /// - Phase 1 (fast): 5 attempts with exponential backoff (1s, 2s, 4s, 8s, 16s)
  /// - Phase 2 (slow): poll every 10s until budget expires (130s)
  ///
  /// The budget matches the server's departure_timeout (120s) + margin,
  /// ensuring the client keeps trying as long as the server-side session is alive.
  /// See [ReconnectScheduler] for the pure scheduling logic. (BUG-028)
  Future<void> _reconnectRoom() async {
    if (_reconnecting) return;
    if (_url == null || _token == null) {
      _updateState(
        status: ConversationStatus.error,
        errorMessage: 'Disconnected from room',
      );
      return;
    }

    _reconnecting = true;
    _reconnectScheduler.begin();
    _updateState(status: ConversationStatus.reconnecting);

    // If offline, wait for network to come back before burning retries
    if (!connectivityService.isOnline) {
      debugPrint('[Fletcher] Offline — waiting for network restore');
      _updateState(
        status: ConversationStatus.reconnecting,
        errorMessage: 'Waiting for network...',
      );
      _waitForNetworkRestore();
      return;
    }

    await _doReconnectAttempt();
  }

  /// Subscribe to connectivity changes and retry when network returns.
  void _waitForNetworkRestore() {
    _networkRestoreSub?.cancel();
    _networkRestoreSub =
        connectivityService.onConnectivityChanged.listen((online) {
      if (online) {
        debugPrint('[Fletcher] Network restored — starting reconnect');
        _networkRestoreSub?.cancel();
        _networkRestoreSub = null;
        _doReconnectAttempt();
      }
    });
  }

  /// Execute a single reconnect attempt using [_reconnectScheduler].
  ///
  /// The scheduler decides the phase (fast/slow/exhausted) and delay.
  /// This method handles the actual disconnect/connect and offline checks.
  Future<void> _doReconnectAttempt() async {
    final action = _reconnectScheduler.nextAttempt();

    switch (action.phase) {
      case ReconnectPhase.exhausted:
        debugPrint('[Fletcher] Reconnect budget exhausted (${action.elapsed.inSeconds}s) — creating new room');
        _reconnecting = false;
        _reconnectScheduler.reset();
        // Instead of showing an error, create a new room for seamless recovery.
        // The old room's departure_timeout has expired, so a new room gets
        // a fresh agent dispatch from LiveKit.
        await disconnect(preserveTranscripts: true);
        await _connectToNewRoom();
        return;

      case ReconnectPhase.fast:
        debugPrint('[Fletcher] Fast reconnect ${action.attempt}/${_reconnectScheduler.fastRetryCount}');
        _updateState(status: ConversationStatus.reconnecting);
        await Future.delayed(action.delay);

      case ReconnectPhase.slow:
        final slowAttempt = action.attempt - _reconnectScheduler.fastRetryCount;
        debugPrint('[Fletcher] Slow reconnect poll #$slowAttempt (${action.elapsed.inSeconds}s/${_reconnectScheduler.budget.inSeconds}s)');
        _updateState(
          status: ConversationStatus.reconnecting,
          errorMessage: 'Reconnecting (${action.elapsed.inSeconds}s)...',
        );
        await Future.delayed(action.delay);
    }

    // Bail out if we went offline during the wait
    if (!connectivityService.isOnline) {
      debugPrint('[Fletcher] Went offline during backoff — waiting for network');
      _waitForNetworkRestore();
      return;
    }

    // Clean up old room/listeners but keep credentials
    await disconnect(preserveTranscripts: true);

    // Re-resolve URL (network may have changed, e.g. WiFi→cellular)
    final resolved = await resolveLivekitUrl(urls: _allUrls);
    // Update any pending network switch event with resolved transport (task 020)
    _emitSystemEvent(SystemEvent(
      id: 'network-reconnect-${DateTime.now().millisecondsSinceEpoch}',
      type: SystemEventType.network,
      status: SystemEventStatus.success,
      message: _describeTransport(resolved.url),
      timestamp: DateTime.now(),
      prefix: '\u26A1',
    ));
    await connect(url: resolved.url, token: _token!);

    // If connect succeeded, refresh session timestamp
    if (_state.status != ConversationStatus.error && _currentRoomName != null) {
      await SessionStorage.saveSession(_currentRoomName!);
    }

    // If connect failed (status is error), try again
    if (_state.status == ConversationStatus.error) {
      _reconnecting = false;
      _reconnectRoom();
    }
  }

  /// Trigger a reconnect from outside (e.g., app lifecycle resume).
  /// Starts a fresh time budget since the user explicitly wants to reconnect.
  Future<void> tryReconnect() async {
    if (_state.status != ConversationStatus.error &&
        _state.status != ConversationStatus.reconnecting) {
      return;
    }
    if (!connectivityService.isOnline) {
      debugPrint('[Fletcher] tryReconnect skipped — offline');
      return;
    }
    _reconnectScheduler.reset();
    _reconnecting = false;
    await _reconnectRoom();
  }

  // ---------------------------------------------------------------------------
  // Background session timeout (task 019)
  // ---------------------------------------------------------------------------

  /// Called when the app is backgrounded (AppLifecycleState.paused).
  /// If the screen is not locked, starts a 10-minute countdown that
  /// disconnects the session on expiry. Screen-locked means the user may
  /// be talking via earbuds, so we skip the timeout.
  void onAppBackgrounded({required bool isScreenLocked}) {
    debugPrint('[Fletcher] onAppBackgrounded called — room=${_room != null ? 'connected' : 'NULL'}, isScreenLocked=$isScreenLocked');
    if (_room == null) return;
    if (isScreenLocked) {
      debugPrint('[Fletcher] Screen locked — skipping background timeout');
      return;
    }

    debugPrint('[Fletcher] App backgrounded — starting ${_backgroundTimeout.inMinutes}min timeout');
    _backgroundMinutesRemaining = _backgroundTimeout.inMinutes;

    _updateBackgroundNotification();

    _backgroundCountdownTimer?.cancel();
    _backgroundCountdownTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      _backgroundMinutesRemaining--;
      if (_backgroundMinutesRemaining > 0) {
        _updateBackgroundNotification();
      }
    });

    _backgroundTimeoutTimer?.cancel();
    _backgroundTimeoutTimer = Timer(_backgroundTimeout, () {
      debugPrint('[Fletcher] Background timeout expired — disconnecting');
      _backgroundCountdownTimer?.cancel();
      _backgroundCountdownTimer = null;
      disconnect();
    });
  }

  /// Called when the app is resumed (AppLifecycleState.resumed).
  /// Cancels any active background timeout and resets the notification.
  void onAppResumed() {
    if (_backgroundTimeoutTimer == null) return;

    debugPrint('[Fletcher] App resumed — cancelling background timeout');
    _backgroundTimeoutTimer?.cancel();
    _backgroundTimeoutTimer = null;
    _backgroundCountdownTimer?.cancel();
    _backgroundCountdownTimer = null;

    // Reset notification text
    if (_room != null) {
      FlutterForegroundTask.updateService(
        notificationTitle: 'Fletcher',
        notificationText: 'Voice session active',
      );
    }
  }

  void _updateBackgroundNotification() {
    FlutterForegroundTask.updateService(
      notificationTitle: 'Fletcher',
      notificationText: 'Disconnecting in $_backgroundMinutesRemaining min',
    );
  }

  Future<void> disconnect({bool preserveTranscripts = false}) async {
    debugPrint('[Fletcher] Disconnecting (preserveTranscripts=$preserveTranscripts)');
    agentPresenceService.disable();
    await _stopForegroundService();
    await _reconnectBuffer?.reset();
    _reconnectBuffer = null;
    _audioLevelTimer?.cancel();
    _statusClearTimer?.cancel();
    _userSubtitleClearTimer?.cancel();
    _agentSubtitleClearTimer?.cancel();
    _backgroundTimeoutTimer?.cancel();
    _backgroundTimeoutTimer = null;
    _backgroundCountdownTimer?.cancel();
    _backgroundCountdownTimer = null;
    _deviceChangeDebounce?.cancel();
    _deviceChangeSub?.cancel();
    _deviceChangeSub = null;
    _connectivitySub?.cancel();
    _connectivitySub = null;
    _networkRestoreSub?.cancel();
    _networkRestoreSub = null;
    _room?.unregisterTextStreamHandler('lk.transcription');
    _listener?.dispose();
    await _room?.disconnect();
    _room = null;
    _localParticipant = null;

    // Finalize in-flight transcript segments before clearing —
    // text already received shouldn't be silently dropped.
    for (final entry in _segmentContent.entries) {
      _upsertTranscript(
        segmentId: entry.key,
        role: TranscriptRole.agent, // best guess for orphaned segments
        text: entry.value,
        isFinal: true,
      );
    }
    _segmentContent.clear();

    // Clear stale ganglia chunk buffers — partial messages from the
    // old connection can't be reassembled.
    _chunks.clear();

    // Clear waveform buffers — old audio levels are meaningless
    _userWaveformBuffer.clear();
    _aiWaveformBuffer.clear();

    // Clear RT measurement state
    _userSpeechEndTime = null;

    if (!preserveTranscripts) {
      _url = null;
      _token = null;
      _allUrls = [];
    }
  }

  @override
  void dispose() {
    disconnect();
    agentPresenceService.dispose();
    connectivityService.dispose();
    super.dispose();
  }
}
