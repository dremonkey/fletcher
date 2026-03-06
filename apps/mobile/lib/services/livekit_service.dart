import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/conversation_state.dart';
import 'connectivity_service.dart';
import 'disconnect_reason.dart' as dr;
import 'health_service.dart';
import 'reconnect_scheduler.dart';
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

  bool _isMuted = false;
  bool get isMuted => _isMuted;

  Timer? _audioLevelTimer;
  Timer? _statusClearTimer;
  Timer? _userSubtitleClearTimer;
  Timer? _agentSubtitleClearTimer;

  // Background session timeout (task 019)
  static const _backgroundTimeout = Duration(minutes: 10);
  Timer? _backgroundTimeoutTimer;
  Timer? _backgroundCountdownTimer;
  int _backgroundMinutesRemaining = 0;

  // Credential cache for reconnects
  String? _url;
  String? _token;
  String? _tailscaleUrl;

  // Audio device change handling
  StreamSubscription<List<MediaDevice>>? _deviceChangeSub;
  Timer? _deviceChangeDebounce;
  bool _isRefreshingAudio = false;

  // Network connectivity subscription
  StreamSubscription<bool>? _connectivitySub;

  final HealthService healthService = HealthService();
  final ConnectivityService connectivityService = ConnectivityService();
  // Reconnection audio buffer — captures mic during SDK reconnect (BUG-027)
  PreConnectAudioBuffer? _reconnectBuffer;

  // Room reconnection state (sleep/disconnect recovery)
  bool _reconnecting = false;
  final ReconnectScheduler _reconnectScheduler = ReconnectScheduler();

  // Connectivity-driven reconnect: waits for network restore when offline
  StreamSubscription<bool>? _networkRestoreSub;

  // Buffer for reassembling chunked messages
  final Map<String, List<String?>> _chunks = {};

  // Rolling waveform buffers
  final List<double> _userWaveformBuffer = [];
  final List<double> _aiWaveformBuffer = [];

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

  Future<void> connect({
    required String url,
    required String token,
    String? tailscaleUrl,
  }) async {
    // Cache credentials for reconnect
    _url = url;
    _token = token;
    if (tailscaleUrl != null) _tailscaleUrl = tailscaleUrl;

    // Resolve the correct URL based on network state (LAN vs Tailscale)
    final resolved = await resolveLivekitUrl(
      lanUrl: url,
      tailscaleUrl: _tailscaleUrl,
    );
    final resolvedUrl = resolved.url;

    // Run local config validation checks immediately
    healthService.validateConfig(livekitUrl: resolvedUrl, livekitToken: token);

    // Surface Tailscale warning through health panel if present
    if (resolved.warning != null) {
      healthService.updateNetworkStatus(
        online: true,
        detail: 'Connected (Tailscale mismatch)',
        warning: resolved.warning,
      );
    }

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

      debugPrint('[Fletcher] Connecting to $resolvedUrl');
      await _room!.connect(resolvedUrl, token);

      debugPrint('[Fletcher] Connected to room');
      _localParticipant = _room!.localParticipant;

      _reconnectScheduler.reset();
      _reconnecting = false;
      healthService.updateRoomConnected(connected: true);

      // Check if agent is already in the room
      final hasAgent = _room!.remoteParticipants.isNotEmpty;
      debugPrint('[Fletcher] Room joined: participants=${_room!.remoteParticipants.length} agent=$hasAgent');
      healthService.updateAgentPresent(present: hasAgent);

      // Enable microphone — respect mute state across reconnects
      await _localParticipant!.setMicrophoneEnabled(!_isMuted);
      debugPrint('[Fletcher] Audio config: AEC=on NS=on AGC=on voiceIsolation=on highPass=on bitrate=speech(24k) dtx=on');

      _startAudioLevelMonitoring();
      _subscribeToDeviceChanges();
      _subscribeToConnectivity();

      // Start foreground service to prevent Android from silencing
      // the microphone when the app goes to background (BUG-022)
      await _startForegroundService();

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
      _updateState(status: ConversationStatus.reconnecting);
      healthService.updateRoomReconnecting();
      // Buffer mic audio during reconnection (BUG-027)
      _reconnectBuffer?.reset();
      _reconnectBuffer = PreConnectAudioBuffer(_room!);
      _reconnectBuffer!.startRecording(timeout: const Duration(seconds: 60));
    });

    _listener?.on<RoomAttemptReconnectEvent>((event) {
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
      // Restore status: respect mute state, otherwise go idle
      _updateState(
        status: _isMuted ? ConversationStatus.muted : ConversationStatus.idle,
      );

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
    });

    _listener?.on<ParticipantDisconnectedEvent>((event) {
      final remaining = _room?.remoteParticipants.length ?? 0;
      debugPrint('[Fletcher] Remote participant disconnected: ${event.participant.identity} (remaining=$remaining)');
      healthService.updateAgentPresent(present: remaining > 0);
    });

    _listener?.on<TrackSubscribedEvent>((event) {
      debugPrint('[Fletcher] Track subscribed: ${event.track.kind} from ${event.participant.identity}');
    });

    _listener?.on<TrackUnsubscribedEvent>((event) {
      debugPrint('[Fletcher] Track unsubscribed: ${event.track.kind} from ${event.participant.identity}');
      // If the agent's audio track is unsubscribed during a network transition,
      // keep the reconnecting state visible until re-subscribed. Without this,
      // the UI briefly shows "idle" during the 55s publish gap. (BUG-021)
      if (event.track.kind == TrackType.AUDIO) {
        _updateState(status: ConversationStatus.reconnecting);
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
      final newArtifacts = [..._state.artifacts, artifactEvent];
      // Keep only last 10 artifacts
      if (newArtifacts.length > 10) {
        newArtifacts.removeAt(0);
      }
      _updateState(artifacts: newArtifacts);
      debugPrint('[Ganglia] Artifact: ${artifactEvent.displayTitle}');
    } else if (eventType == 'agent_transcript') {
      // Agent transcript forwarded directly from Ganglia LLM content stream.
      // Bypasses the SDK's lk.transcription pipeline which breaks when the
      // speech handle is interrupted before text forwarding is created.
      final segmentId = json['segmentId'] as String? ?? 'unknown';
      final text = json['text'] as String? ?? '';
      final isFinal = json['final'] == true;
      if (text.isNotEmpty) {
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
    } else if (userLevel > 0.05) {
      newStatus = ConversationStatus.userSpeaking;
    } else if (_state.status == ConversationStatus.userSpeaking ||
        _state.status == ConversationStatus.aiSpeaking) {
      // Brief processing state after speaking stops
      newStatus = ConversationStatus.processing;
      // Return to idle after short delay
      Future.delayed(const Duration(milliseconds: 500), () {
        if (_state.status == ConversationStatus.processing) {
          _updateState(status: ConversationStatus.idle);
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

  void toggleMute() {
    _isMuted = !_isMuted;
    debugPrint('[Fletcher] Mute toggled: muted=$_isMuted');
    _localParticipant?.setMicrophoneEnabled(!_isMuted);

    if (_isMuted) {
      _updateState(status: ConversationStatus.muted);
    } else {
      _updateState(status: ConversationStatus.idle);
    }
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
    );
    notifyListeners();
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
        debugPrint('[Fletcher] Reconnect budget exhausted (${action.elapsed.inSeconds}s) — giving up');
        _reconnecting = false;
        _reconnectScheduler.reset();
        _updateState(
          status: ConversationStatus.error,
          errorMessage: 'Failed to reconnect — session expired',
        );
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

    // Attempt fresh connect (re-resolves URL for network changes)
    await connect(url: _url!, token: _token!, tailscaleUrl: _tailscaleUrl);

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

    if (!preserveTranscripts) {
      _url = null;
      _token = null;
      _tailscaleUrl = null;
    }
  }

  @override
  void dispose() {
    disconnect();
    connectivityService.dispose();
    super.dispose();
  }
}
