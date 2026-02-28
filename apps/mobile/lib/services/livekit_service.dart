import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/conversation_state.dart';
import 'connectivity_service.dart';
import 'disconnect_reason.dart' as dr;
import 'health_service.dart';

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

  // Credential cache for reconnects
  String? _url;
  String? _token;

  // Audio device change handling
  StreamSubscription<List<MediaDevice>>? _deviceChangeSub;
  Timer? _deviceChangeDebounce;
  bool _isReconnecting = false;

  // Network connectivity subscription
  StreamSubscription<bool>? _connectivitySub;

  final HealthService healthService = HealthService();
  final ConnectivityService connectivityService = ConnectivityService();

  // Room reconnection state (sleep/disconnect recovery)
  bool _reconnecting = false;
  int _reconnectAttempt = 0;
  static const _maxReconnectAttempts = 5;

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
    await Permission.bluetoothConnect.request();
    return status.isGranted;
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

      _room = Room();

      _listener = _room!.createListener();
      _setupRoomListeners();

      debugPrint('[Fletcher] Connecting to $url');
      await _room!.connect(
        url,
        token,
        roomOptions: const RoomOptions(
          adaptiveStream: true,
          dynacast: true,
          defaultAudioPublishOptions: AudioPublishOptions(
            // audioBitrate: AudioPresets.music,
          ),
        ),
      );

      debugPrint('[Fletcher] Connected to room');
      _localParticipant = _room!.localParticipant;
      _reconnectAttempt = 0;
      _reconnecting = false;
      healthService.updateRoomConnected(connected: true);

      // Check if agent is already in the room
      final hasAgent = _room!.remoteParticipants.isNotEmpty;
      healthService.updateAgentPresent(present: hasAgent);

      // Enable microphone — respect mute state across reconnects
      await _localParticipant!.setMicrophoneEnabled(!_isMuted);

      _startAudioLevelMonitoring();
      _subscribeToDeviceChanges();
      _subscribeToConnectivity();
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
    });

    _listener?.on<RoomAttemptReconnectEvent>((event) {
      debugPrint(
        '[Fletcher] SDK reconnect attempt ${event.attempt}/${event.maxAttemptsRetry} '
        '(next retry in ${event.nextRetryDelaysInMs}ms)',
      );
    });

    _listener?.on<RoomReconnectedEvent>((_) {
      debugPrint('[Fletcher] SDK reconnected successfully');
      _reconnectAttempt = 0;
      _reconnecting = false;
      healthService.updateRoomConnected(connected: true);
      // Restore status: respect mute state, otherwise go idle
      _updateState(
        status: _isMuted ? ConversationStatus.muted : ConversationStatus.idle,
      );
    });

    _listener?.on<RoomDisconnectedEvent>((event) {
      final reason = event.reason ?? DisconnectReason.unknown;
      debugPrint('[Fletcher] Disconnected: $reason');
      healthService.updateAgentPresent(present: false);

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
      // Remote participant joined (the AI agent)
      debugPrint('Participant connected: ${event.participant.identity}');
      healthService.updateAgentPresent(present: true);
    });

    _listener?.on<ParticipantDisconnectedEvent>((event) {
      debugPrint('Participant disconnected: ${event.participant.identity}');
      final hasAgent = _room?.remoteParticipants.isNotEmpty ?? false;
      healthService.updateAgentPresent(present: hasAgent);
    });

    _listener?.on<TrackSubscribedEvent>((event) {
      // Subscribed to remote track (AI audio)
      if (event.track is AudioTrack) {
        debugPrint('Subscribed to audio track');
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
    healthService.updateNetworkStatus(online: connectivityService.isOnline);
    _connectivitySub =
        connectivityService.onConnectivityChanged.listen((online) {
      healthService.updateNetworkStatus(online: online);
    });
  }

  // ---------------------------------------------------------------------------
  // Audio device change → auto-reconnect
  // ---------------------------------------------------------------------------

  void _subscribeToDeviceChanges() {
    _deviceChangeSub?.cancel();
    _deviceChangeSub = Hardware.instance.onDeviceChange.stream.listen((_) {
      _onDeviceChange();
    });
  }

  void _onDeviceChange() {
    // Skip if already reconnecting or fully disconnected
    if (_isReconnecting || _reconnecting || _room == null) return;

    // Debounce: audio route changes can fire multiple events rapidly
    _deviceChangeDebounce?.cancel();
    _deviceChangeDebounce = Timer(const Duration(seconds: 1), () {
      _reconnectAudioDevice();
    });
  }

  Future<void> _reconnectAudioDevice() async {
    if (_isReconnecting || _url == null || _token == null) return;
    _isReconnecting = true;

    debugPrint('[Fletcher] Audio device changed — reconnecting');
    _updateState(status: ConversationStatus.reconnecting);

    // Tear down connection but keep transcript history
    await disconnect(preserveTranscripts: true);

    // Brief pause to let the OS settle the new audio route
    await Future.delayed(const Duration(milliseconds: 500));

    _isReconnecting = false;

    // Reconnect with cached credentials
    await connect(url: _url!, token: _token!);
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
  /// Network-aware strategy:
  /// - If offline, show "Waiting for network..." and subscribe to
  ///   connectivity changes. Retries start when the network returns.
  /// - If online, retry with exponential backoff (1s, 2s, 4s, 8s, 16s)
  ///   for up to [_maxReconnectAttempts] attempts.
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
        // Reset attempt counter since this is a fresh network
        _reconnectAttempt = 0;
        _doReconnectAttempt();
      }
    });
  }

  /// Execute a single reconnect attempt with exponential backoff.
  Future<void> _doReconnectAttempt() async {
    _reconnectAttempt++;

    if (_reconnectAttempt > _maxReconnectAttempts) {
      _reconnecting = false;
      _reconnectAttempt = 0;
      _updateState(
        status: ConversationStatus.error,
        errorMessage: 'Failed to reconnect after $_maxReconnectAttempts attempts',
      );
      return;
    }

    debugPrint('[Fletcher] Reconnect attempt $_reconnectAttempt/$_maxReconnectAttempts');
    _updateState(status: ConversationStatus.reconnecting);

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    final delay = Duration(seconds: 1 << (_reconnectAttempt - 1));
    await Future.delayed(delay);

    // Bail out if we went offline during the wait
    if (!connectivityService.isOnline) {
      debugPrint('[Fletcher] Went offline during backoff — waiting for network');
      _waitForNetworkRestore();
      return;
    }

    // Clean up old room/listeners but keep credentials
    await disconnect(preserveTranscripts: true);

    // Attempt fresh connect
    await connect(url: _url!, token: _token!);

    // If connect failed (status is error), try again
    if (_state.status == ConversationStatus.error) {
      _reconnecting = false;
      _reconnectRoom();
    }
  }

  /// Trigger a reconnect from outside (e.g., app lifecycle resume).
  Future<void> tryReconnect() async {
    if (_state.status != ConversationStatus.error &&
        _state.status != ConversationStatus.reconnecting) {
      return;
    }
    if (!connectivityService.isOnline) {
      debugPrint('[Fletcher] tryReconnect skipped — offline');
      return;
    }
    _reconnectAttempt = 0;
    _reconnecting = false;
    await _reconnectRoom();
  }

  Future<void> disconnect({bool preserveTranscripts = false}) async {
    _audioLevelTimer?.cancel();
    _statusClearTimer?.cancel();
    _userSubtitleClearTimer?.cancel();
    _agentSubtitleClearTimer?.cancel();
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
    }
  }

  @override
  void dispose() {
    disconnect();
    connectivityService.dispose();
    super.dispose();
  }
}
