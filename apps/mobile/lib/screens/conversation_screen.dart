import 'package:flutter/material.dart';
import '../models/conversation_state.dart';
import '../services/livekit_service.dart';
import '../widgets/amber_orb.dart';
import '../widgets/artifact_viewer.dart';
import '../widgets/audio_waveform.dart';
import '../widgets/health_panel.dart';
import '../widgets/mute_toggle.dart';
import '../widgets/status_bar.dart';
import '../widgets/transcript_drawer.dart';
import '../widgets/transcript_subtitle.dart';

class ConversationScreen extends StatefulWidget {
  final String livekitUrl;
  final String token;

  const ConversationScreen({
    super.key,
    required this.livekitUrl,
    required this.token,
  });

  @override
  State<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends State<ConversationScreen>
    with WidgetsBindingObserver {
  final LiveKitService _liveKitService = LiveKitService();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _liveKitService.addListener(_onStateChanged);
    _liveKitService.healthService.addListener(_onStateChanged);
    _connect();
  }

  void _onStateChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _connect() async {
    await _liveKitService.connect(
      url: widget.livekitUrl,
      token: widget.token,
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _liveKitService.tryReconnect();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _liveKitService.removeListener(_onStateChanged);
    _liveKitService.healthService.removeListener(_onStateChanged);
    _liveKitService.dispose();
    super.dispose();
  }

  void _openTranscriptDrawer() {
    showTranscriptDrawer(
      context,
      transcript: _liveKitService.state.transcript,
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = _liveKitService.state;

    return Scaffold(
      backgroundColor: const Color(0xFF0D0D0D),
      body: SafeArea(
        child: Stack(
          children: [
            // Main content - centered orb
            Center(
              child: AmberOrb(
                status: state.status,
                userAudioLevel: state.userAudioLevel,
                aiAudioLevel: state.aiAudioLevel,
              ),
            ),

            // Status indicator (for debugging - can remove later)
            Positioned(
              top: 16,
              left: 0,
              right: 0,
              child: Center(
                child: _buildStatusIndicator(state),
              ),
            ),

            // Ganglia status bar (shows what the agent is doing)
            Positioned(
              top: 60,
              left: 16,
              right: 16,
              child: Center(
                child: StatusBar(status: state.currentStatus),
              ),
            ),

            // Audio waveform row
            Positioned(
              bottom: 220,
              left: 0,
              right: 0,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // User waveform
                  AudioWaveform(
                    amplitudes: state.userWaveform,
                    color: const Color(0xFFF59E0B),
                    height: 32,
                    barCount: 15,
                  ),
                  const SizedBox(width: 24),
                  // Agent waveform
                  AudioWaveform(
                    amplitudes: state.aiWaveform,
                    color: const Color(0xFF6B7280),
                    height: 32,
                    barCount: 15,
                  ),
                ],
              ),
            ),

            // Transcript subtitle
            Positioned(
              bottom: 150,
              left: 0,
              right: 0,
              child: TranscriptSubtitle(
                userTranscript: state.currentUserTranscript,
                agentTranscript: state.currentAgentTranscript,
                onTap: _openTranscriptDrawer,
              ),
            ),

            // Health chip + Artifact chip + Transcript chip row
            Positioned(
              bottom: 105,
              left: 0,
              right: 0,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  HealthChip(
                    overall: _liveKitService.healthService.state.overall,
                    onTap: () => showHealthPanel(
                      context,
                      healthService: _liveKitService.healthService,
                    ),
                  ),
                  if (state.artifacts.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    ArtifactChip(
                      count: state.artifacts.length,
                      onTap: () => showArtifactDrawer(
                        context,
                        artifacts: state.artifacts,
                        onClear: _liveKitService.clearArtifacts,
                      ),
                    ),
                  ],
                  if (state.transcript.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    TranscriptChip(
                      count: state.transcript.length,
                      onTap: _openTranscriptDrawer,
                    ),
                  ],
                ],
              ),
            ),

            // Mute toggle at bottom
            Positioned(
              bottom: 48,
              left: 0,
              right: 0,
              child: Center(
                child: MuteToggle(
                  isMuted: _liveKitService.isMuted,
                  onToggle: _liveKitService.toggleMute,
                ),
              ),
            ),

            // Error / reconnecting message
            if (state.status == ConversationStatus.error ||
                state.status == ConversationStatus.reconnecting)
              Positioned(
                bottom: 260,
                left: 24,
                right: 24,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1F1F1F),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: state.status == ConversationStatus.reconnecting
                          ? const Color(0xFFF59E0B).withOpacity(0.5)
                          : const Color(0xFFEF4444).withOpacity(0.5),
                    ),
                  ),
                  child: Text(
                    state.status == ConversationStatus.reconnecting
                        ? 'Connection lost. Reconnecting...'
                        : state.errorMessage ?? 'Connection error',
                    style: const TextStyle(
                      color: Color(0xFFE5E7EB),
                      fontSize: 14,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusIndicator(ConversationState state) {
    String statusText;
    Color statusColor;

    switch (state.status) {
      case ConversationStatus.connecting:
        statusText = 'Connecting...';
        statusColor = const Color(0xFF4B5563);
        break;
      case ConversationStatus.reconnecting:
        statusText = 'Reconnecting...';
        statusColor = const Color(0xFFF59E0B);
        break;
      case ConversationStatus.idle:
        statusText = 'Listening';
        statusColor = const Color(0xFFF59E0B);
        break;
      case ConversationStatus.userSpeaking:
        statusText = 'You\'re speaking';
        statusColor = const Color(0xFFFCD34D);
        break;
      case ConversationStatus.processing:
        statusText = 'Processing...';
        statusColor = const Color(0xFFF59E0B);
        break;
      case ConversationStatus.aiSpeaking:
        statusText = 'Fletcher is speaking';
        statusColor = const Color(0xFFFBBF24);
        break;
      case ConversationStatus.muted:
        statusText = 'Muted';
        statusColor = const Color(0xFF4B5563);
        break;
      case ConversationStatus.error:
        statusText = 'Error';
        statusColor = const Color(0xFFEF4444);
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: statusColor.withOpacity(0.15),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: statusColor.withOpacity(0.3),
        ),
      ),
      child: Text(
        statusText,
        style: TextStyle(
          color: statusColor,
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}
