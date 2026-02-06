import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/conversation_state.dart';

class LiveKitService extends ChangeNotifier {
  Room? _room;
  LocalParticipant? _localParticipant;
  EventsListener<RoomEvent>? _listener;

  ConversationState _state = const ConversationState();
  ConversationState get state => _state;

  bool _isMuted = false;
  bool get isMuted => _isMuted;

  Timer? _audioLevelTimer;

  Future<bool> requestPermissions() async {
    final status = await Permission.microphone.request();
    return status.isGranted;
  }

  Future<void> connect({
    required String url,
    required String token,
  }) async {
    try {
      _updateState(status: ConversationStatus.connecting);

      final hasPermission = await requestPermissions();
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

      _localParticipant = _room!.localParticipant;

      // Enable microphone
      await _localParticipant!.setMicrophoneEnabled(true);

      _startAudioLevelMonitoring();
      _updateState(status: ConversationStatus.idle);
    } catch (e) {
      _updateState(
        status: ConversationStatus.error,
        errorMessage: e.toString(),
      );
    }
  }

  void _setupRoomListeners() {
    _listener?.on<RoomDisconnectedEvent>((event) {
      _updateState(
        status: ConversationStatus.error,
        errorMessage: 'Disconnected from room',
      );
    });

    _listener?.on<ParticipantConnectedEvent>((event) {
      // Remote participant joined (the AI agent)
      debugPrint('Participant connected: ${event.participant.identity}');
    });

    _listener?.on<TrackSubscribedEvent>((event) {
      // Subscribed to remote track (AI audio)
      if (event.track is AudioTrack) {
        debugPrint('Subscribed to audio track');
      }
    });
  }

  void _startAudioLevelMonitoring() {
    _audioLevelTimer?.cancel();
    _audioLevelTimer = Timer.periodic(
      const Duration(milliseconds: 50),
      (_) => _updateAudioLevels(),
    );
  }

  void _updateAudioLevels() {
    if (_room == null) return;

    // Get local (user) audio level
    double userLevel = 0.0;
    final localAudioTrack = _localParticipant?.audioTrackPublications
        .where((pub) => pub.track != null)
        .firstOrNull
        ?.track as LocalAudioTrack?;

    if (localAudioTrack != null) {
      userLevel = localAudioTrack.currentBitrate?.toDouble() ?? 0.0;
      // Normalize - this is a rough approximation
      userLevel = (userLevel / 100000).clamp(0.0, 1.0);
    }

    // Get remote (AI) audio level
    double aiLevel = 0.0;
    for (final participant in _room!.remoteParticipants.values) {
      for (final pub in participant.audioTrackPublications) {
        if (pub.track != null && pub.subscribed) {
          // Audio level from remote track
          aiLevel = (pub.track as RemoteAudioTrack).currentBitrate?.toDouble() ?? 0.0;
          aiLevel = (aiLevel / 100000).clamp(0.0, 1.0);
        }
      }
    }

    // Update state based on audio levels
    ConversationStatus newStatus = _state.status;

    if (_isMuted) {
      newStatus = ConversationStatus.muted;
    } else if (_state.status == ConversationStatus.error) {
      // Keep error state
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
  }) {
    _state = _state.copyWith(
      status: status,
      userAudioLevel: userAudioLevel,
      aiAudioLevel: aiAudioLevel,
      errorMessage: errorMessage,
      transcript: transcript,
    );
    notifyListeners();
  }

  Future<void> disconnect() async {
    _audioLevelTimer?.cancel();
    _listener?.dispose();
    await _room?.disconnect();
    _room = null;
    _localParticipant = null;
  }

  @override
  void dispose() {
    disconnect();
    super.dispose();
  }
}
