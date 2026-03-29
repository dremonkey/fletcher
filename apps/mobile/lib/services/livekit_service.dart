import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/command_result.dart';
import '../models/conversation_state.dart';
import '../models/system_event.dart';
import 'agent_dispatch_service.dart';
import 'command_registry.dart';
import 'agent_presence_service.dart';
import 'relay/relay_chat_service.dart';
import 'connectivity_service.dart';
import 'disconnect_reason.dart' as dr;
import 'health_service.dart';
import 'local_vad_service.dart';
import 'reconnect_scheduler.dart';
import 'session_storage.dart';
import 'token_service.dart';
import 'url_resolver.dart';
import '../utils/preamble_stripper.dart';
import '../utils/room_name_generator.dart';

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

  final CommandRegistry _commandRegistry = CommandRegistry();

  bool _isMuted = true;
  bool get isMuted => _isMuted;

  bool _textOnlyMode = false;
  bool get textOnlyMode => _textOnlyMode;
  bool get voiceOutEnabled => !_textOnlyMode;

  /// Voice mode is active when the user has explicitly entered voice-first mode
  /// and the mic is live. Stays true when muted via histogram tap (muteOnly).
  bool _voiceModeActive = false;
  bool get isVoiceModeActive => _voiceModeActive;

  /// Whether session history is being replayed (TASK-077).
  /// UI should suppress auto-scroll and thinking indicators during replay.
  bool get isReplaying => _isReplaying;

  Timer? _audioLevelTimer;
  Timer? _userSubtitleClearTimer;
  Timer? _agentSubtitleClearTimer;

  // Background session timeout (task 019)
  static const _backgroundTimeout = Duration(minutes: 10);
  Timer? _backgroundTimeoutTimer;
  Timer? _backgroundCountdownTimer;
  int _backgroundMinutesRemaining = 0;

  // Background disconnect for chat mode (TASK-074 / BUG-034)
  bool _backgroundDisconnected = false;

  // Background reconnect retry guard (BUG-044)
  bool _backgroundReconnecting = false;

  @visibleForTesting
  bool get backgroundDisconnectedForTest => _backgroundDisconnected;

  @visibleForTesting
  set backgroundDisconnectedForTest(bool value) =>
      _backgroundDisconnected = value;

  @visibleForTesting
  bool get backgroundReconnectingForTest => _backgroundReconnecting;

  @visibleForTesting
  set backgroundReconnectingForTest(bool value) =>
      _backgroundReconnecting = value;

  @visibleForTesting
  // ignore: avoid_setters_without_getters
  set roomForTest(Room? room) => _room = room;

  @visibleForTesting
  // ignore: avoid_setters_without_getters
  set stateStatusForTest(ConversationStatus status) =>
      _state = _state.copyWith(status: status);

  @visibleForTesting
  // ignore: avoid_setters_without_getters
  set voiceModeActiveForTest(bool value) => _voiceModeActive = value;

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
  bool _pendingDeviceChange = false;  // BUG-009: device changed while muted; refresh on unmute

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
  int _lastLoggedReconnectAttempt = 0;
  ReconnectScheduler _reconnectScheduler = ReconnectScheduler();

  // Connectivity-driven reconnect: waits for network restore when offline
  StreamSubscription<bool>? _networkRestoreSub;

  // Hold mode — set when the agent sends a 'session_hold' event before
  // disconnecting (idle timeout).  Passed to AgentPresenceService so it
  // shows "on hold" UX instead of generic disconnect.
  bool _holdModeActive = false;

  // Mode switch active — set during voice→text transition while the agent
  // is self-terminating via end_voice_session.  Suppresses red disconnect
  // UX in favor of neutral "Switched to text mode". (BUG-027c, Epic 26)
  bool _modeSwitchActive = false;

  // Diagnostics: round-trip latency measurement
  // Tracks when user stopped speaking so we can measure RT when agent starts
  DateTime? _userSpeechEndTime;

  // Rolling waveform buffers
  final List<double> _userWaveformBuffer = [];
  final List<double> _aiWaveformBuffer = [];

  // Relay chat service for chat-mode text conversations (Epic 22).
  // Created lazily when room connects; disposed on disconnect.
  RelayChatService? _relayChatService;

  /// Whether session/bind has been acknowledged by the relay.
  bool _sessionBound = false;

  /// Retry timer for session/bind — retries up to [_maxBindAttempts] times
  /// with [_bindRetryInterval] between attempts (BUG-045).
  Timer? _bindRetryTimer;
  int _bindAttempts = 0;
  static const _maxBindAttempts = 3;
  static const _bindRetryInterval = Duration(seconds: 10);

  /// Whether session/load should be sent after the next successful bind.
  /// Set to true when reconnecting to an existing room (app restart with
  /// recent session). NOT set during in-memory reconnects where the
  /// transcript is already populated. (TASK-077)
  bool _needsSessionLoad = false;

  /// Whether a session/load replay is in progress. Used to suppress
  /// auto-scroll and thinking spinners for historical messages. (TASK-077)
  bool _isReplaying = false;

  // Accumulated text for the in-progress agent message from relay (chat mode).
  String _relayAgentMessageText = '';
  // Accumulated thinking/reasoning text from relay (chat mode).
  String _relayThinkingText = '';

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

    // Wait for ConnectivityService to finish its initial platform check (BUG-049).
    // On cold start, connectivity_plus may need 100-200ms to query the OS.
    await connectivityService.ready.timeout(
      const Duration(seconds: 2),
      onTimeout: () {}, // proceed anyway if it takes too long
    );

    // If the device is offline, wait briefly for network to come up.
    // On cold start, WiFi may take 1-3 seconds to become routable.
    if (!connectivityService.isOnline) {
      debugPrint('[Fletcher] Waiting for network before connecting...');
      _updateState(
        status: ConversationStatus.connecting,
        errorMessage: 'Waiting for network...',
      );
      try {
        await connectivityService.onConnectivityChanged
            .firstWhere((online) => online)
            .timeout(const Duration(seconds: 5));
      } on TimeoutException {
        debugPrint('[Fletcher] Network wait timed out — proceeding anyway');
      }
    }

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

    // BUG-049: Retry with backoff on cold start.
    // Android's network stack may not have functional routes for 1-3s after
    // Dart VM boot. Retry up to 3 times with increasing delays.
    const maxAttempts = 3;
    const retryDelays = [Duration(seconds: 2), Duration(seconds: 3)];

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Determine room name: reuse recent session or generate new
        final stalenessThreshold = Duration(seconds: departureTimeoutS);
        final recentRoom = await SessionStorage.getRecentRoom(
          stalenessThreshold: stalenessThreshold,
        );
        final roomName = recentRoom ?? await _generateRoomName();
        _currentRoomName = roomName;

        // BUG-047: Load session history whenever a persisted session key exists,
        // not just when the room is non-stale. Stale rooms (>120s) still have
        // full conversation history in the ACP backend via the session key.
        final hadExistingSession = await SessionStorage.hasSessionKey();
        _needsSessionLoad = hadExistingSession;

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

        // Success — exit the retry loop
        return;
      } catch (e) {
        final isLastAttempt = attempt >= maxAttempts;

        if (isLastAttempt) {
          debugPrint('[Fletcher] Dynamic room connection failed after $maxAttempts attempts: $e');
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
        } else {
          final delay = retryDelays[attempt - 1];
          debugPrint('[Fletcher] Connection attempt $attempt/$maxAttempts failed: $e — retrying in ${delay.inSeconds}s');
          _emitSystemEvent(SystemEvent(
            id: 'network-boot',
            type: SystemEventType.network,
            status: SystemEventStatus.pending,
            message: 'retry ${attempt + 1}/$maxAttempts in ${delay.inSeconds}s...',
            timestamp: DateTime.now(),
            prefix: '\u25B8',
          ));
          await Future.delayed(delay);
        }
      }
    }
  }

  /// Generate a room name that shares the session's word pair.
  ///
  /// Session "amber-elm-20260315" → room "amber-elm-7x2q".
  /// This makes it easy to visually correlate rooms with their session
  /// in logs and dashboards.
  ///
  /// When E2E_TEST_MODE=true in .env, uses e2e- prefix so the voice agent
  /// detects automated tests and uses a minimal system prompt, reducing token
  /// consumption. (TASK-022, TASK-029)
  Future<String> _generateRoomName() async {
    final sessionKey = await SessionStorage.getSessionKey();
    // Session key format: "agent:main:relay:amber-elm-20260315"
    // Extract session name → extract word pair → build room name.
    final sessionName = sessionKey.replaceFirst('agent:main:relay:', '');
    final wordPair = NameGenerator.extractWordPair(sessionName);
    final name = NameGenerator.generateRoomName(wordPair: wordPair);
    final isE2e = dotenv.env['E2E_TEST_MODE']?.toLowerCase() == 'true';
    return isE2e ? 'e2e-$name' : name;
  }

  /// Create a new room and connect to it (used for recovery after budget exhaustion).
  Future<void> _connectToNewRoom() async {
    final roomName = await _generateRoomName();
    _currentRoomName = roomName;
    _needsSessionLoad = true; // ACP backend retains history for the session

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
      _initRelayChatService();

      // Send session/bind to the relay (TASK-081). Two paths:
      // 1. Relay already in room (e.g., room discovery re-joined before us) → send now.
      // 2. Relay joins after us (normal webhook flow) → ParticipantConnectedEvent handler sends it.
      if (_hasRelayParticipant) {
        _sendSessionBind();
      }
      // Otherwise, ParticipantConnectedEvent handler will send it when relay joins.

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
      healthService.updateAgentPresent(present: hasAgent, voiceModeActive: _voiceModeActive);

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

      // Configure dispatch URL for agent presence service (Epic 20).
      // Derive dispatch URL from the LiveKit URL (same host, token server port).
      // Note: enable() is deferred to voice mode activation (TASK-078).
      if (_currentRoomName != null) {
        final uri = Uri.parse(url);
        final dispatchBaseUrl = 'http://${uri.host}:$_tokenServerPort';
        agentPresenceService.updateDispatchBaseUrl(dispatchBaseUrl);
      }

      // Always send TTS mode state to agent on connect (BUG-001, TASK-030).
      // Unconditional so the agent always receives the current state, not just
      // when TTS is off.  If no agent is in the room yet (on-demand dispatch),
      // the message is lost — the ParticipantConnectedEvent handler below resends it.
      await _sendTtsMode();

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
      _reconnecting = true;  // BUG-010: align flag with status for all reconnect paths
      // Start the budget clock NOW — not when the SDK gives up. The server's
      // departure_timeout counts from the first disconnect, so the app's
      // budget must too. begin() is idempotent (won't reset if already started).
      _reconnectScheduler.begin();
      _updateState(status: ConversationStatus.reconnecting);
      healthService.updateRoomReconnecting();
      // Emit room reconnecting system event (task 020)
      // Suppress during background disconnect or when app is in background to avoid UX noise (TASK-082 / BUG-037)
      if (!_backgroundDisconnected) {
        _emitSystemEvent(SystemEvent(
          id: 'room-reconnect-${DateTime.now().millisecondsSinceEpoch}',
          type: SystemEventType.room,
          status: SystemEventStatus.error,
          message: 'disconnected \u00B7 reconnecting...',
          timestamp: DateTime.now(),
          prefix: '\u2715',
        ));
      }
      // Buffer mic audio during reconnection (BUG-027)
      // Only buffer if voice mode is active — chat mode should not grab the mic (BUG-046)
      if (_voiceModeActive && !_isMuted) {
        _reconnectBuffer?.reset();
        _reconnectBuffer = PreConnectAudioBuffer(_room!);
        _reconnectBuffer!.startRecording(timeout: const Duration(seconds: 60));
      }
    });

    _listener?.on<RoomAttemptReconnectEvent>((event) {
      // Start the budget clock on the FIRST SDK reconnect attempt — not when
      // the SDK gives up. The server's departure_timeout counts from the first
      // disconnect, so the app's budget must too. begin() is idempotent (won't
      // reset if already started). We use this event rather than
      // RoomReconnectingEvent because the SDK doesn't always fire that event.
      _reconnectScheduler.begin();
      // Deduplicate: SDK may emit attempt=1 twice when both peer connections
      // fail simultaneously (BUG-010). Only log each attempt number once.
      if (event.attempt != _lastLoggedReconnectAttempt) {
        _lastLoggedReconnectAttempt = event.attempt;
        debugPrint(
          '[Fletcher] SDK reconnect attempt ${event.attempt}/${event.maxAttemptsRetry} '
          '(next retry in ${event.nextRetryDelaysInMs}ms)',
        );
      }
    });

    _listener?.on<RoomReconnectedEvent>((_) async {
      debugPrint('[Fletcher] SDK reconnected successfully');
      _reconnectScheduler.reset();
      _reconnecting = false;
      _lastLoggedReconnectAttempt = 0;
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

      // Re-validate relay binding after SDK reconnect (BUG-045).
      // The data channel may have been replaced during reconnection, so the
      // relay's previous bind state is stale. Reset and re-bind so the relay
      // knows the client is alive. If the relay also disconnected and rejoined
      // (new participant SID), ParticipantConnectedEvent will handle it.
      _sessionBound = false;
      if (_hasRelayParticipant) {
        _sendSessionBind();
      }

      // After reconnection, refresh audio track to restore BT routing, but
      // only when an agent is present. If the room is empty (post-idle), skip
      // the refresh — restartTrack() would trigger a device-change event that
      // starts another ICE renegotiation cycle (BUG-010).
      final agentPresent = _room!.remoteParticipants.values
          .any((p) => p.kind == ParticipantKind.AGENT);
      if (agentPresent) {
        _refreshAudioTrack();
      }
    });

    _listener?.on<RoomDisconnectedEvent>((event) async {
      final reason = event.reason ?? DisconnectReason.unknown;
      debugPrint('[Fletcher] Disconnected: $reason');
      _lastLoggedReconnectAttempt = 0;
      healthService.updateAgentPresent(present: false, voiceModeActive: _voiceModeActive);
      // Emit room disconnected system event (task 020)
      // Suppress during background disconnect or when app is in background to avoid UX noise (TASK-082 / BUG-037)
      if (!_backgroundDisconnected) {
        _emitSystemEvent(SystemEvent(
          id: 'room-disconnect-${DateTime.now().millisecondsSinceEpoch}',
          type: SystemEventType.room,
          status: SystemEventStatus.error,
          message: 'disconnected \u00B7 $reason',
          timestamp: DateTime.now(),
          prefix: '\u2715',
        ));
      }
      // Clean up reconnect buffer — room is disconnecting, can't send via it
      await _reconnectBuffer?.reset();
      _reconnectBuffer = null;

      if (dr.shouldReconnect(reason)) {
        healthService.updateRoomConnected(
          connected: false,
          errorDetail: 'Disconnected ($reason)',
        );
        // BUG-031: SDK reconnect failed — clear the stale flag so the
        // app-layer reconnect loop in _reconnectRoom() can actually run.
        _reconnecting = false;
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
      // Relay participant — send session/bind now that relay is in the room,
      // then emit relay-specific event. Don't process as agent.
      if (event.participant.identity?.startsWith('relay-') == true) {
        // Send session/bind as the first data channel message (TASK-081).
        // Must happen here (not in connect()) because the relay joins via
        // webhook ~500ms after room.connect() — sending earlier means the
        // message is lost (LiveKit doesn't buffer for late joiners).
        _sendSessionBind();
        _emitSystemEvent(SystemEvent(
          id: 'relay-connected-${DateTime.now().millisecondsSinceEpoch}',
          type: SystemEventType.room,
          status: SystemEventStatus.success,
          message: 'relay connected',
          timestamp: DateTime.now(),
          prefix: '\u25B8',
        ));
        return;
      }
      healthService.updateAgentPresent(present: true);
      // Update diagnostics with agent identity
      _updateState(
        diagnostics: _state.diagnostics.copyWith(
          agentIdentity: event.participant.identity,
        ),
      );
      // Notify agent presence service (Epic 20)
      _holdModeActive = false; // Agent connected — clear any hold flag
      agentPresenceService.onAgentConnected();
      // Always re-sync TTS mode when a new agent joins (BUG-001, BUG-004).
      _sendTtsMode();
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
      // Count only agent participants — relay participants are infrastructure,
      // not agents, and should not prevent hold mode / disconnect handling.
      final remaining = _room?.remoteParticipants.values
          .where((p) => p.identity?.startsWith('relay-') != true)
          .length ?? 0;
      debugPrint('[Fletcher] Remote participant disconnected: ${event.participant.identity} (remaining agents=$remaining)');
      // Relay participant — emit relay-specific event, don't count toward agent presence.
      // Suppress the event if we never bound to this relay (e.g., stale relay from
      // a previous app process leaving the room as we join).
      if (event.participant.identity?.startsWith('relay-') == true) {
        if (_sessionBound) {
          _sessionBound = false;
          _emitSystemEvent(SystemEvent(
            id: 'relay-disconnected-${DateTime.now().millisecondsSinceEpoch}',
            type: SystemEventType.room,
            status: SystemEventStatus.error,
            message: 'relay disconnected',
            timestamp: DateTime.now(),
            prefix: '\u2715',
          ));
        }
        return;
      }
      healthService.updateAgentPresent(present: remaining > 0, voiceModeActive: _voiceModeActive);
      // Clear agent identity if no agents remain
      if (remaining == 0) {
        // When hold mode or mode switch is active, clear the reconnecting
        // status that TrackUnsubscribed may have set (it fires before
        // ParticipantDisconnected, so the agentAbsent guard doesn't catch
        // it). Without this, the status stays "reconnecting" and
        // unmute→dispatch is blocked. (BUG-031, BUG-027c)
        final wasHoldMode = _holdModeActive;
        final wasModeSwitch = _modeSwitchActive;
        final isNeutralDisconnect = wasHoldMode || wasModeSwitch;
        _updateState(
          status: isNeutralDisconnect ? ConversationStatus.idle : null,
          diagnostics: _state.diagnostics.copyWith(clearAgentIdentity: true),
        );
        // Notify agent presence service (Epic 20)
        agentPresenceService.onAgentDisconnected(holdMode: wasHoldMode);
        _holdModeActive = false;
        // Don't clear _modeSwitchActive here — it stays true until text→voice
        // transition clears it in toggleInputMode().
        // Emit agent disconnected system event (task 020)
        // Suppress duplicate raw disconnect during hold or mode switch —
        // the agent presence service already emits hold-specific events,
        // and mode switch is intentional. (TASK-069, BUG-027c)
        if (wasModeSwitch) {
          _emitSystemEvent(SystemEvent(
            id: 'agent-disconnect-${DateTime.now().millisecondsSinceEpoch}',
            type: SystemEventType.agent,
            status: SystemEventStatus.pending,
            message: 'switched to text mode',
            timestamp: DateTime.now(),
            prefix: '\u25B8', // ▸ neutral
          ));
        } else if (!wasHoldMode) {
          _emitSystemEvent(SystemEvent(
            id: 'agent-disconnect-${DateTime.now().millisecondsSinceEpoch}',
            type: SystemEventType.agent,
            status: SystemEventStatus.error,
            message: 'disconnected',
            timestamp: DateTime.now(),
            prefix: '\u2715',
          ));
        }
      }
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
      // Guard: do not show the reconnecting banner when the agent is absent
      // (on-demand dispatch lifecycle). The agent presence UX (system events)
      // already communicates what happened.
      if (event.track.kind == TrackType.AUDIO) {
        // Also skip when hold mode or mode switch is active — the agent
        // is leaving intentionally, not due to a network issue. (BUG-031, BUG-027c)
        final isAgentAbsent = (agentPresenceService.enabled &&
            agentPresenceService.state == AgentPresenceState.agentAbsent) ||
            _holdModeActive ||
            _modeSwitchActive;
        if (!isAgentAbsent) {
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

  /// Handles data received from the voice agent or relay via data channel.
  void _handleDataReceived(DataReceivedEvent event) {
    // Route by topic: ganglia-events (voice agent) or relay (chat mode)
    if (event.topic == 'relay') {
      // Intercept session/bind response before forwarding to RelayChatService.
      // The bind response has { result: { bound: true, sessionKey: ... } }.
      try {
        final decoded =
            jsonDecode(utf8.decode(event.data)) as Map<String, dynamic>;
        if (decoded['jsonrpc'] == '2.0' &&
            decoded.containsKey('result') &&
            decoded['result'] is Map) {
          final result = decoded['result'] as Map;
          if (result.containsKey('bound') && result['bound'] == true) {
            _sessionBound = true;
            _bindRetryTimer?.cancel();
            _bindRetryTimer = null;
            debugPrint(
                '[Fletcher] Session bound: ${result['sessionKey']}');
            // TASK-077: Load session history after bind on reconnect
            if (_needsSessionLoad) {
              _needsSessionLoad = false;
              // BUG-047: Catch errors to prevent _isReplaying staying true forever
              _loadSessionHistory().catchError((e) {
                debugPrint('[Fletcher] Session history load failed: $e');
                _isReplaying = false;
              });
            }
            return;
          }
        }
      } catch (_) {
        // Not valid JSON or not a bind response — fall through to RelayChatService
      }
      _relayChatService?.handleMessage(event.data);
      return;
    }

    if (event.topic != 'ganglia-events') return;

    try {
      final jsonStr = utf8.decode(event.data);
      final json = jsonDecode(jsonStr) as Map<String, dynamic>;

      _processGangliaEvent(json);
    } catch (e) {
      debugPrint('[Ganglia] Failed to parse event: $e');
    }
  }

  void _processGangliaEvent(Map<String, dynamic> json) {
    final eventType = json['type'] as String?;

    if (eventType == 'system_event') {
      // Server-sent system events (Brain Timed Out, Voice Degraded, etc.)
      // rendered as inline system messages.
      final severity = json['severity'] as String? ?? 'error';
      final title = json['title'] as String? ?? 'Error';
      final message = json['message'] as String? ?? '';
      _emitSystemEvent(SystemEvent(
        id: 'agent-event-${DateTime.now().millisecondsSinceEpoch}',
        type: SystemEventType.agent,
        status: severity == 'success'
            ? SystemEventStatus.success
            : SystemEventStatus.error,
        message: '$title: $message',
        timestamp: DateTime.now(),
        prefix: severity == 'success' ? '\u26A1' : '\u2715',
      ));
    } else if (eventType == 'agent_transcript') {
      // Agent transcript forwarded directly from Ganglia LLM content stream.
      // Bypasses the SDK's lk.transcription pipeline which breaks when the
      // speech handle is interrupted before text forwarding is created.
      final segmentId = json['segmentId'] as String? ?? 'unknown';
      final text = json['text'] as String? ?? '';
      final isFinal = json['final'] == true;
      if (text.isNotEmpty) {
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
    } else if (eventType == 'session_hold') {
      // Agent is entering hold mode (idle timeout) — flag so we show
      // "on hold" UX when the agent disconnects shortly after.
      debugPrint('[Ganglia] Session hold (reason: ${json['reason']})');
      _holdModeActive = true;
    }
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

    // BUG-009: When fully muted (track unpublished via removePublishedTrack),
    // skip the restart — there is no track to restart and running the refresh
    // would hold _isRefreshingAudio for ~1s, silently dropping subsequent
    // device events. For soft-mute (muteOnly), the track is still published
    // and disabled — proceed with refresh so audio routing stays correct.
    if (_isMuted) {
      final pub = _localParticipant!.audioTrackPublications.firstOrNull;
      if (pub?.track == null) {
        debugPrint('[Fletcher] Device change while muted — skipping audio track restart (BUG-009)');
        _pendingDeviceChange = true;
        return;
      }
      debugPrint('[Fletcher] Device change while soft-muted — refreshing audio track');
    }

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
      if (track != null) {
        await track.restartTrack();
        debugPrint('[Fletcher] Audio track restarted successfully');
      }
    } catch (e) {
      debugPrint('[Fletcher] Audio track refresh failed: $e');
    } finally {
      _isRefreshingAudio = false;
      // Suppress device-change events for 5s after restartTrack() completes —
      // getUserMedia() internally fires devicechange on Android, which would
      // loop back into another restartTrack() call (BUG-010).
      _deviceChangeDebounce?.cancel();
      _deviceChangeDebounce = Timer(const Duration(seconds: 5), () {
        // No-op: exhausts the debounce window so _onDeviceChange
        // cannot fire a new refresh for 5 seconds.
      });
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
    } else if (_state.status == ConversationStatus.error) {
      // Keep error state (requires explicit user action to clear)
    } else if (_state.status == ConversationStatus.reconnecting && _reconnecting) {
      // Keep reconnecting state only while a reconnect is actually in progress.
      // If _reconnecting was cleared by RoomReconnectedEvent but the status
      // wasn't yet updated (race), let the normal audio-level logic take over. (BUG-010)
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
          agentPresenceService.state == AgentPresenceState.agentAbsent &&
          !_reconnecting &&
          _state.status != ConversationStatus.reconnecting) {
        debugPrint('[Fletcher] Unmute while agent absent — triggering dispatch');
        agentPresenceService.onSpeechDetected();
      } else if (agentPresenceService.enabled &&
          agentPresenceService.state == AgentPresenceState.agentAbsent &&
          (_reconnecting || _state.status == ConversationStatus.reconnecting)) {
        debugPrint('[Fletcher] Unmute while agent absent — deferring dispatch until reconnected (BUG-010)');
      }
      // BUG-031: Mic toggle as recovery trigger — if the service is in a
      // dead error/reconnecting state, treat unmute as user intent to recover.
      if (_state.status == ConversationStatus.error ||
          _state.status == ConversationStatus.reconnecting) {
        debugPrint('[Fletcher] Unmute while in ${_state.status} — triggering tryReconnect (BUG-031)');
        unawaited(tryReconnect());
      }
      // Republish a fresh audio track — setMicrophoneEnabled(true) creates
      // a new LocalAudioTrack and publishes it to the PeerConnection.
      await _localParticipant?.setMicrophoneEnabled(true);
      // BUG-009: If a device change fired while muted, the new track just published
      // via setMicrophoneEnabled(true) already picked up the current device
      // (getUserMedia returns the active device). Clear the flag.
      if (_pendingDeviceChange) {
        debugPrint('[Fletcher] Applying deferred device change refresh after unmute (BUG-009)');
        _pendingDeviceChange = false;
      }
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
  /// **Voice → Text:** Signals the agent to self-terminate via
  /// `end_voice_session`, then unpublishes the audio track to release
  /// Android's AudioRecord for keyboard STT. The pipeline death is
  /// intentional — a fresh agent will be dispatched on return to voice.
  ///
  /// **Text → Voice:** Republishes the audio track, then dispatches a
  /// fresh agent with a fresh pipeline if the previous one is gone.
  ///
  /// (BUG-027c, Epic 26)
  Future<void> toggleInputMode() async {
    final current = _state.inputMode;
    final next = current == TextInputMode.voiceFirst
        ? TextInputMode.textInput
        : TextInputMode.voiceFirst;
    debugPrint('[Fletcher] Input mode toggled: $current → $next');
    _state = _state.copyWith(inputMode: next);

    if (next == TextInputMode.textInput) {
      // --- Voice → Text ---
      _voiceModeActive = false;
      _modeSwitchActive = true; // Suppress red disconnect UX (Task 4)
      // 1. Signal agent to self-terminate (immediate, don't wait 60s hold)
      await _sendEvent({'type': 'end_voice_session'});
      // 2. Unpublish track to release AudioRecord for keyboard STT
      if (!_isMuted) await toggleMute(); // existing removePublishedTrack path
      // 3. Disable agent presence — no agent needed in text mode (TASK-078)
      agentPresenceService.disable();
      // 4. Update health: agent absence is expected in text mode
      healthService.updateAgentPresent(present: false, voiceModeActive: false);
    } else if (next == TextInputMode.voiceFirst) {
      // --- Text → Voice ---
      _modeSwitchActive = false;
      // 1. Republish audio track
      if (_isMuted) await toggleMute();
      _voiceModeActive = true;
      // 2. Enable agent presence for on-demand dispatch (TASK-078)
      if (_currentRoomName != null) {
        agentPresenceService.enable(_currentRoomName!);
      }
      // 3. Dispatch fresh agent if absent.
      //    Agent may already be gone from end_voice_session signal.
      //    AgentPresenceService handles dispatch when agent is absent.
      if (agentPresenceService.enabled &&
          agentPresenceService.state == AgentPresenceState.agentAbsent) {
        agentPresenceService.onSpeechDetected();
      }
    }

    notifyListeners();
  }

  /// Soft mute/unmute without exiting voice mode. Used when tapping the user
  /// histogram — keeps histograms visible while silencing the mic.
  ///
  /// Unlike toggleMute() (which calls removePublishedTrack), this uses
  /// setMicrophoneEnabled(false/true) so the audio track stays published.
  /// The SDK's MultiInputStream pump gets silence frames but stays alive —
  /// unmuting resumes audio instantly with no pipeline death. (BUG-027c)
  ///
  /// Tradeoff: keyboard STT won't work while soft-muted in voice mode
  /// because AudioRecord is still held. Voice mode IS the STT.
  Future<void> muteOnly() async {
    _isMuted = !_isMuted;
    debugPrint('[Fletcher] Soft mute toggled: muted=$_isMuted (voice mode stays active)');
    if (_isMuted) {
      _updateState(status: ConversationStatus.muted);
      await _localParticipant?.setMicrophoneEnabled(false);
    } else {
      _updateState(status: ConversationStatus.idle);
      await _localParticipant?.setMicrophoneEnabled(true);
      // BUG-009: If a device change fired while soft-muted and was handled by
      // _refreshAudioTrack (track was still published), the flag may already be
      // clear. But if it slipped through, clear it — setMicrophoneEnabled(true)
      // on a re-enabled track doesn't call getUserMedia, but restartTrack()
      // during the refresh already picked up the new device.
      if (_pendingDeviceChange) {
        debugPrint('[Fletcher] Clearing pending device change after soft-unmute (BUG-009)');
        _pendingDeviceChange = false;
      }
    }
    // _voiceModeActive stays unchanged — histograms remain visible
  }

  /// Send a text message through the relay (both text and voice mode).
  ///
  /// In both modes, typed text is sent as `session/prompt` via the relay
  /// data channel (`"relay"` topic). Response streams back as `session/update`
  /// chunks and appears in the chat UI. In voice mode the response is shown
  /// in the transcript but not spoken (TTS is driven by the STT pipeline).
  ///
  /// The user's message is added to the local transcript immediately
  /// (optimistic update) regardless of mode. (Epic 30, T30.03)
  Future<void> sendTextMessage(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;

    // Slash command intercept — route to registry, skip relay
    if (trimmed.startsWith('/') && trimmed.length > 1) {
      final result = await _commandRegistry.dispatch(trimmed);
      if (result != null) {
        _addCommandResult(result);
      }
      return;
    }

    debugPrint('[Fletcher] Sending text message: ${trimmed.length} chars');

    // Optimistic: add user message to local transcript immediately
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
    if (updatedTranscript.length > _maxTranscriptEntries) {
      updatedTranscript.removeRange(
        0,
        updatedTranscript.length - _maxTranscriptEntries,
      );
    }
    _updateState(transcript: updatedTranscript);

    // All text input routes through the relay (T30.03). Gate prompts behind
    // bind completion so the relay has a valid ACP session (TASK-081).
    if (!_sessionBound) {
      debugPrint('[Fletcher] Prompt blocked — session not yet bound');
      return;
    }
    await _sendViaRelay(trimmed);
  }

  // ---------------------------------------------------------------------------
  // Relay chat mode (Epic 22 — dual-mode architecture)
  // ---------------------------------------------------------------------------

  /// Check whether a relay participant (identity starting with `relay-`)
  /// is present in the current room.
  bool get _hasRelayParticipant {
    if (_room == null) return false;
    return _room!.remoteParticipants.values
        .any((p) => p.identity.startsWith('relay-'));
  }

  /// Initialize the relay chat service. Called once when the room connects.
  void _initRelayChatService() {
    _relayChatService = RelayChatService(
      publish: (data) async {
        final participant = _localParticipant;
        if (participant == null) return;
        await participant.publishData(data, reliable: true, topic: 'relay');
      },
      onAsyncUpdate: _handleAsyncRelayUpdate,
    );
  }

  /// Handle async/polled updates that arrive when no prompt is in-flight.
  ///
  /// WORKAROUND for BUG-022: The relay's session poller forwards new agent
  /// messages between prompts. These need to be added directly to the
  /// transcript since there is no active prompt stream to deliver them.
  ///
  /// Dedup: uses content-hash-based segment IDs so duplicate deliveries
  /// (e.g., same message via both live stream and poll) are naturally
  /// deduplicated by [_upsertTranscript].
  ///
  /// TODO(BUG-022): Remove once openclaw/openclaw#40693 is fixed.
  void _handleAsyncRelayUpdate(RelayChatEvent event) {
    switch (event) {
      case RelayContentDelta(:final text):
        // Build a deterministic ID from a content hash to enable dedup.
        // If the same text was already delivered via live stream, the
        // _upsertTranscript call will update the existing entry instead
        // of creating a duplicate.
        final messageId = 'poll-${text.hashCode.toRadixString(16)}';

        // Check if this message already exists in the transcript (dedup)
        final existing = _state.transcript.any((e) =>
          e.id == messageId ||
          (e.role == TranscriptRole.agent && e.text == text && e.isFinal)
        );
        if (existing) {
          debugPrint('[Fletcher] Polled message already in transcript — skipping');
          return;
        }

        debugPrint('[Fletcher] Async agent message received via poll '
            '(${text.length} chars)');
        _upsertTranscript(
          segmentId: messageId,
          role: TranscriptRole.agent,
          text: text,
          isFinal: true,
        );

      case RelayUserMessage(:final text):
        final messageId = 'poll-user-${text.hashCode.toRadixString(16)}';
        final existing = _state.transcript.any((e) =>
          e.id == messageId ||
          (e.role == TranscriptRole.user && e.text == text && e.isFinal)
        );
        if (existing) return;

        _upsertTranscript(
          segmentId: messageId,
          role: TranscriptRole.user,
          text: text,
          isFinal: true,
        );

      default:
        // Other async events (thinking, usage, tool calls) are not
        // meaningful outside a prompt context — ignore them.
        break;
    }
  }

  /// Send session/bind to the relay as the first data channel message.
  /// Must be called after room.connect() and before any session/prompt.
  ///
  /// Retries up to [_maxBindAttempts] times with [_bindRetryInterval]
  /// between attempts. Gives up and emits a system error if all attempts
  /// fail (BUG-045).
  Future<void> _sendSessionBind() async {
    // Cancel any existing retry timer before starting fresh
    _bindRetryTimer?.cancel();
    _bindAttempts = 0;
    await _sendSessionBindOnce();

    // Schedule retry: if not bound within _bindRetryInterval, re-send
    _bindRetryTimer = Timer.periodic(_bindRetryInterval, (timer) async {
      if (_sessionBound) {
        timer.cancel();
        _bindRetryTimer = null;
        return;
      }
      _bindAttempts++;
      if (_bindAttempts >= _maxBindAttempts) {
        timer.cancel();
        _bindRetryTimer = null;
        debugPrint('[Fletcher] session/bind failed after $_maxBindAttempts attempts');
        _emitSystemEvent(SystemEvent(
          id: 'bind-failed-${DateTime.now().millisecondsSinceEpoch}',
          type: SystemEventType.room,
          status: SystemEventStatus.error,
          message: 'relay bind failed \u00B7 reconnect to retry',
          timestamp: DateTime.now(),
          prefix: '\u2715',
        ));
        return;
      }
      debugPrint('[Fletcher] session/bind retry ${_bindAttempts + 1}/$_maxBindAttempts');
      await _sendSessionBindOnce();
    });
  }

  /// Send a single session/bind message (no retry logic).
  Future<void> _sendSessionBindOnce() async {
    final sessionKey = await SessionStorage.getSessionKey();
    debugPrint('[Fletcher] Sending session/bind: $sessionKey');

    final data = utf8.encode(jsonEncode({
      'jsonrpc': '2.0',
      'method': 'session/bind',
      'id': DateTime.now().millisecondsSinceEpoch,
      'params': {'sessionKey': sessionKey},
    }));

    await _room?.localParticipant?.publishData(
      data,
      reliable: true,
      topic: 'relay',
    );
  }

  /// Load session history from the relay via `session/load` (TASK-077).
  ///
  /// Called after a successful session/bind on reconnect (app restart with
  /// recent room). Replays the conversation as `session/update` notifications
  /// and populates the transcript. Historical messages do not trigger
  /// thinking spinners or auto-scroll.
  Future<void> _loadSessionHistory() async {
    final relay = _relayChatService;
    if (relay == null) {
      debugPrint('[Relay] Cannot load session — service not initialized');
      return;
    }
    if (relay.isBusy) {
      debugPrint('[Relay] Cannot load session — stream already active');
      return;
    }

    debugPrint('[Fletcher] Loading session history (TASK-077)');
    _isReplaying = true;

    final replayEntries = <TranscriptEntry>[];
    String currentAgentText = '';
    String currentThinkingText = '';
    int turnIndex = 0;

    void finalizeAgentTurn() {
      if (currentAgentText.isNotEmpty || currentThinkingText.isNotEmpty) {
        final text = currentThinkingText.isNotEmpty
            ? '<think>$currentThinkingText</think>$currentAgentText'
            : currentAgentText;
        replayEntries.add(TranscriptEntry(
          id: 'replay-agent-$turnIndex',
          role: TranscriptRole.agent,
          text: text,
          isFinal: true,
          timestamp: DateTime.now(),
          origin: MessageOrigin.text,
        ));
        currentAgentText = '';
        currentThinkingText = '';
        turnIndex++;
      }
    }

    final stream = relay.sendSessionLoad();
    await for (final event in stream) {
      switch (event) {
        case RelayUserMessage(:final text):
          // Finalize any pending agent message before starting new user turn
          finalizeAgentTurn();
          final stripped = stripPreamble(text);
          replayEntries.add(TranscriptEntry(
            id: 'replay-user-$turnIndex',
            role: TranscriptRole.user,
            text: stripped,
            isFinal: true,
            timestamp: DateTime.now(),
            origin: MessageOrigin.text,
          ));
          turnIndex++;

        case RelayThinkingDelta(:final text):
          currentThinkingText += text;

        case RelayContentDelta(:final text):
          currentAgentText += text;

        case RelayLoadComplete():
          finalizeAgentTurn();

        case RelayPromptComplete():
          finalizeAgentTurn();

        case RelayPromptError(:final code, :final message):
          debugPrint('[Relay] Session load error: $code $message');

        case RelayUsageUpdate(:final used, :final size):
          _state = _state.copyWith(
            diagnostics: _state.diagnostics.copyWith(
              tokenUsed: used,
              tokenSize: size,
            ),
          );

        case RelayToolCallEvent():
          break; // Skip tool call events from history
      }
    }

    // Batch-add all replay entries at once to avoid per-item auto-scroll
    if (replayEntries.isNotEmpty) {
      debugPrint('[Fletcher] Session loaded: ${replayEntries.length} messages');
      _updateState(transcript: replayEntries);
    }

    _isReplaying = false;
    _emitSystemEvent(SystemEvent(
      id: 'session-loaded-${DateTime.now().millisecondsSinceEpoch}',
      type: SystemEventType.room,
      status: SystemEventStatus.success,
      message: 'session restored \u00B7 ${replayEntries.length} messages',
      timestamp: DateTime.now(),
      prefix: '\u25B8',
    ));
  }

  /// Send user text through the relay (chat mode).
  ///
  /// Checks relay presence, starts streaming, and routes events into
  /// the transcript. Shows thinking indicator while waiting for first chunk.
  Future<void> _sendViaRelay(String text) async {
    final relay = _relayChatService;
    if (relay == null) {
      debugPrint('[Relay] Service not initialized');
      return;
    }

    if (!_hasRelayParticipant) {
      debugPrint('[Relay] No relay participant in room — cannot send');
      _emitSystemEvent(SystemEvent(
        id: 'relay-absent-${DateTime.now().millisecondsSinceEpoch}',
        type: SystemEventType.agent,
        status: SystemEventStatus.error,
        message: 'Relay not connected — try again',
        timestamp: DateTime.now(),
        prefix: '▸',
      ));
      return;
    }

    if (relay.isBusy) {
      debugPrint('[Relay] Prompt already in-flight — cancelling previous');
      relay.cancelPrompt();
      // Wait a tick for the cancel to propagate before sending new prompt
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }

    // Create placeholder agent message for streaming
    final messageId = 'relay-${DateTime.now().millisecondsSinceEpoch}';

    _relayAgentMessageText = '';
    _relayThinkingText = '';

    // Clear stale tool calls from previous prompt and show thinking indicator
    _updateState(isAgentThinking: true, activeToolCalls: const []);

    String buildTranscriptText() {
      if (_relayThinkingText.isEmpty) return _relayAgentMessageText;
      return '<think>$_relayThinkingText</think>$_relayAgentMessageText';
    }

    final stream = relay.sendPrompt(text);
    await for (final event in stream) {
      switch (event) {
        case RelayThinkingDelta(:final text):
          _relayThinkingText += text;
          _upsertTranscript(
            segmentId: messageId,
            role: TranscriptRole.agent,
            text: buildTranscriptText(),
            isFinal: false,
          );

        case RelayContentDelta(:final text):
          _relayAgentMessageText += text;
          _upsertTranscript(
            segmentId: messageId,
            role: TranscriptRole.agent,
            text: buildTranscriptText(),
            isFinal: false,
          );
          // Hide thinking after first content arrives
          if (_state.isAgentThinking) {
            _updateState(isAgentThinking: false);
          }

        case RelayPromptComplete():
          _upsertTranscript(
            segmentId: messageId,
            role: TranscriptRole.agent,
            text: buildTranscriptText(),
            isFinal: true,
          );
          _statusClearTimer?.cancel();
          _updateState(
            isAgentThinking: false,
            activeToolCalls: const [],
            clearStatus: true,
          );

          _relayAgentMessageText = '';
          _relayThinkingText = '';

        case RelayPromptError(:final code, :final message):
          debugPrint('[Relay] Prompt error: $code $message');
          _statusClearTimer?.cancel();
          _updateState(
            isAgentThinking: false,
            activeToolCalls: const [],
            clearStatus: true,
          );
          _emitSystemEvent(SystemEvent(
            id: 'relay-error-${DateTime.now().millisecondsSinceEpoch}',
            type: SystemEventType.agent,
            status: SystemEventStatus.error,
            message: _relayErrorMessage(code, message),
            timestamp: DateTime.now(),
            prefix: '▸',
          ));

          _relayAgentMessageText = '';
          _relayThinkingText = '';

        case RelayUsageUpdate(:final used, :final size):
          _state = _state.copyWith(
            diagnostics: _state.diagnostics.copyWith(
              tokenUsed: used,
              tokenSize: size,
            ),
          );
          notifyListeners();

        case RelayToolCallEvent(:final id, :final kind, :final title, :final status):
          if (status == null) {
            // Tool call started — update activeToolCalls and StatusBar
            final toolCall = ToolCallInfo(
              id: id,
              name: title ?? kind ?? 'tool',
              startedAt: DateTime.now(),
            );
            final toolStatus = ToolStatus.fromAcp(
              kind: kind ?? 'other',
              title: title,
            );
            _state = _state.copyWith(
              activeToolCalls: [..._state.activeToolCalls, toolCall],
              currentStatus: toolStatus,
            );
            // Reset 5s auto-clear on each new tool call start
            _statusClearTimer?.cancel();
            notifyListeners();
          } else {
            // Tool call completed or errored — update activeToolCalls
            final updated = _state.activeToolCalls.map((tc) {
              if (tc.id != id) return tc;
              return tc.copyWith(
                status: status,
                duration: DateTime.now().difference(tc.startedAt),
              );
            }).toList();
            _state = _state.copyWith(activeToolCalls: updated);
            // Auto-clear StatusBar after completed/failed with a short delay
            if (status == 'completed' || status == 'failed' || status == 'error') {
              _statusClearTimer?.cancel();
              _statusClearTimer = Timer(const Duration(seconds: 5), () {
                _updateState(clearStatus: true);
              });
            }
            notifyListeners();
          }

        case RelayUserMessage():
          break; // User messages are handled separately via _upsertTranscript

        case RelayLoadComplete():
          break; // Session load completion — no action needed in prompt stream
      }
    }
  }

  /// Map relay error codes to user-facing messages.
  String _relayErrorMessage(int code, String message) {
    return switch (code) {
      -32003 => 'Voice mode active — switch to voice',
      -32010 => 'Backend unavailable — retrying...',
      -32011 => 'Relay starting up — try again',
      -32029 => 'Rate limited — try again shortly',
      _ => 'Error: $message',
    };
  }

  void _addCommandResult(CommandResult result) {
    final updated = List<CommandResult>.from(_state.commandResults)..add(result);
    _updateState(commandResults: updated);
  }

  void _updateState({
    ConversationStatus? status,
    double? userAudioLevel,
    double? aiAudioLevel,
    String? errorMessage,
    List<TranscriptEntry>? transcript,
    ToolStatus? currentStatus,
    bool clearStatus = false,
    List<double>? userWaveform,
    List<double>? aiWaveform,
    TranscriptEntry? currentUserTranscript,
    bool clearCurrentUserTranscript = false,
    TranscriptEntry? currentAgentTranscript,
    bool clearCurrentAgentTranscript = false,
    List<SystemEvent>? systemEvents,
    bool? isAgentThinking,
    DiagnosticsInfo? diagnostics,
    List<CommandResult>? commandResults,
    List<ToolCallInfo>? activeToolCalls,
  }) {
    _state = _state.copyWith(
      status: status,
      userAudioLevel: userAudioLevel,
      aiAudioLevel: aiAudioLevel,
      errorMessage: errorMessage,
      transcript: transcript,
      currentStatus: currentStatus,
      clearStatus: clearStatus,
      userWaveform: userWaveform,
      aiWaveform: aiWaveform,
      currentUserTranscript: currentUserTranscript,
      clearCurrentUserTranscript: clearCurrentUserTranscript,
      currentAgentTranscript: currentAgentTranscript,
      clearCurrentAgentTranscript: clearCurrentAgentTranscript,
      systemEvents: systemEvents,
      isAgentThinking: isAgentThinking,
      diagnostics: diagnostics,
      commandResults: commandResults,
      activeToolCalls: activeToolCalls,
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
        // - "Connecting..." = pending
        // - "Connected" = success
        // - "Disconnected..." = error (visual distinction)
        final SystemEventStatus status;
        final String prefix;
        if (id == 'agent-dispatching') {
          status = SystemEventStatus.pending;
          prefix = '\u25B8'; // ▸
        } else if (id == 'agent-disconnected') {
          final isNeutral = _holdModeActive || _modeSwitchActive;
          status = isNeutral
              ? SystemEventStatus.pending   // gray, neutral
              : SystemEventStatus.error;    // red, alarming
          prefix = isNeutral ? '\u25B8' : '\u2715'; // ▸ vs ✕
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
      debugPrint('[Fletcher] _reconnectRoom — no cached credentials (url=${_url != null} token=${_token != null})');
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
        // If new room also failed, retry once after delay (BUG-046)
        if (_state.status == ConversationStatus.error) {
          debugPrint('[Fletcher] New room failed — retrying once after 5s');
          await Future.delayed(const Duration(seconds: 5));
          if (connectivityService.isOnline) {
            await _connectToNewRoom();
          }
        }
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

    // BUG-049: If we never successfully connected (cold start failure),
    // _url/_token are null. Fall back to a full connection attempt using
    // the stored URLs from the initial connectWithDynamicRoom() call.
    if (_url == null || _token == null) {
      if (_allUrls.isNotEmpty) {
        debugPrint('[Fletcher] tryReconnect — no cached credentials, retrying full connect (BUG-049)');
        await connectWithDynamicRoom(
          urls: _allUrls,
          tokenServerPort: _tokenServerPort,
          departureTimeoutS: _departureTimeoutS,
        );
        return;
      }
      debugPrint('[Fletcher] tryReconnect — no URLs configured, cannot retry');
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
  /// In chat mode, disconnects immediately to avoid relay churn (TASK-074 / BUG-034).
  /// In voice mode, starts a 10-minute countdown that disconnects on expiry.
  /// Screen-locked in voice mode means the user may be talking via earbuds, so
  /// we skip the timeout. Chat mode always disconnects regardless of lock state.
  void onAppBackgrounded({required bool isScreenLocked}) {
    debugPrint('[Fletcher] onAppBackgrounded called — room=${_room != null ? 'connected' : 'NULL'}, isScreenLocked=$isScreenLocked');
    if (_room == null) return;

    // Cancel any in-progress background reconnect attempt (BUG-044)
    _backgroundReconnecting = false;

    // Chat mode: always disconnect immediately — can't interact with a
    // backgrounded or locked screen. Keeps room alive = relay idle churn. (BUG-042)
    if (!_voiceModeActive) {
      debugPrint('[Fletcher] Chat mode backgrounded — disconnecting immediately');
      _backgroundDisconnected = true;
      disconnect(preserveTranscripts: true);
      return;
    }

    // Voice mode: screen lock means earbuds in use — stay connected
    if (isScreenLocked) {
      debugPrint('[Fletcher] Voice mode screen locked — skipping background timeout');
      return;
    }

    // Voice mode: existing 10-minute timeout (user may switch back quickly)
    _backgroundDisconnected = true;
    debugPrint('[Fletcher] Voice mode backgrounded — starting ${_backgroundTimeout.inMinutes}min timeout');
    _backgroundMinutesRemaining = _backgroundTimeout.inMinutes;

    updateBackgroundNotification();

    _backgroundCountdownTimer?.cancel();
    _backgroundCountdownTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      _backgroundMinutesRemaining--;
      if (_backgroundMinutesRemaining > 0) {
        updateBackgroundNotification();
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
  /// In chat mode after a background disconnect, reconnects automatically
  /// using cached credentials (TASK-074). In voice mode, cancels any active
  /// background timeout and resets the notification.
  void onAppResumed() {
    // Reconnect after chat-mode background disconnect (TASK-074 / BUG-034)
    if (_backgroundDisconnected) {
      _backgroundDisconnected = false;
      debugPrint('[Fletcher] Resuming after background disconnect — reconnecting');
      _reconnectAfterBackground();
      return;
    }

    // Existing: cancel voice-mode background timeout
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

  /// Reconnect after a chat-mode background disconnect, with retries.
  ///
  /// Android WiFi often needs several seconds to re-associate after deep
  /// sleep. A single connection attempt frequently fails because the radio
  /// isn't ready yet. Retry up to 3 times with a 3-second pause between
  /// attempts. If all retries fail, engage [tryReconnect] so the existing
  /// reconnect infrastructure can pick it up. (BUG-044)
  @visibleForTesting
  Future<void> reconnectAfterBackground() => _reconnectAfterBackground();

  Future<void> _reconnectAfterBackground() async {
    const maxAttempts = 3;
    const baseDelay = Duration(seconds: 3);

    _backgroundReconnecting = true;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!_backgroundReconnecting) {
        debugPrint('[Fletcher] Background reconnect cancelled');
        return;
      }

      // Wait for network readiness before first attempt (BUG-044).
      // On resume, WiFi may still be re-associating. Give it up to 2s.
      if (attempt == 1 && !connectivityService.isOnline) {
        debugPrint('[Fletcher] Waiting for network before background reconnect...');
        try {
          await connectivityService.onConnectivityChanged
              .firstWhere((online) => online)
              .timeout(const Duration(seconds: 2));
        } on TimeoutException {
          debugPrint('[Fletcher] Network wait timed out — proceeding anyway');
        }
      }

      debugPrint('[Fletcher] Background reconnect attempt $attempt/$maxAttempts');
      await connectWithDynamicRoom(
        urls: _allUrls,
        tokenServerPort: _tokenServerPort,
        departureTimeoutS: _departureTimeoutS,
      );

      // Success — connected or at least not in error state
      if (_state.status != ConversationStatus.error) {
        _backgroundReconnecting = false;
        return;
      }

      // Last attempt — don't sleep, fall through to engage tryReconnect
      if (attempt >= maxAttempts) break;

      // Bail if we went offline
      if (!connectivityService.isOnline) {
        debugPrint('[Fletcher] Went offline during background reconnect — aborting retries');
        break;
      }

      // Exponential backoff: 3s, 6s
      final delay = baseDelay * attempt;
      debugPrint('[Fletcher] Retrying in ${delay.inSeconds}s...');
      await Future.delayed(delay);
    }

    _backgroundReconnecting = false;

    // If still in error state after all retries, engage the existing
    // reconnect infrastructure so the user isn't stranded. (BUG-044)
    if (_state.status == ConversationStatus.error) {
      debugPrint('[Fletcher] Background reconnect exhausted — engaging tryReconnect');
      await tryReconnect();
    }
  }

  @visibleForOverriding
  void updateBackgroundNotification() {
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
    _relayChatService?.dispose();
    _relayChatService = null;
    _relayAgentMessageText = '';
    _relayThinkingText = '';
    _sessionBound = false;
    _bindRetryTimer?.cancel();
    _bindRetryTimer = null;
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
