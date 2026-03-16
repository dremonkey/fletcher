import 'package:flutter/material.dart';
import '../models/conversation_state.dart';
import '../services/livekit_service.dart';
import '../services/screen_state_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import '../theme/tui_widgets.dart';
import '../widgets/artifact_viewer.dart';
import '../widgets/chat_transcript.dart';
import '../widgets/diagnostics_bar.dart';
import '../widgets/sub_agent_chip.dart';
import '../widgets/voice_control_bar.dart';

class ConversationScreen extends StatefulWidget {
  final List<String> livekitUrls;
  final int tokenServerPort;
  final int departureTimeoutS;

  const ConversationScreen({
    super.key,
    required this.livekitUrls,
    required this.tokenServerPort,
    required this.departureTimeoutS,
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
    _liveKitService.subAgentService.addListener(_onStateChanged);
    _connect();
  }

  void _onStateChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _connect() async {
    await _liveKitService.connectWithDynamicRoom(
      urls: widget.livekitUrls,
      tokenServerPort: widget.tokenServerPort,
      departureTimeoutS: widget.departureTimeoutS,
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) async {
    debugPrint('[Fletcher] didChangeAppLifecycleState: $state');
    switch (state) {
      case AppLifecycleState.paused:
        final locked = await ScreenStateService.isScreenLocked();
        debugPrint('[Fletcher] Screen locked check returned: $locked');
        _liveKitService.onAppBackgrounded(isScreenLocked: locked);
        break;
      case AppLifecycleState.resumed:
        _liveKitService.onAppResumed();
        _liveKitService.tryReconnect();
        break;
      case AppLifecycleState.detached:
        _liveKitService.disconnect();
        break;
      default:
        break;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _liveKitService.removeListener(_onStateChanged);
    _liveKitService.healthService.removeListener(_onStateChanged);
    _liveKitService.subAgentService.removeListener(_onStateChanged);
    _liveKitService.dispose();
    super.dispose();
  }

  Widget? _buildTrailingWidgets(BuildContext context, ConversationState state) {
    final hasSubAgents = _liveKitService.subAgentService.hasAgents;
    final hasArtifacts = state.artifacts.isNotEmpty;

    if (!hasSubAgents && !hasArtifacts) return null;

    final children = <Widget>[];

    if (hasSubAgents) {
      children.add(SubAgentChip(service: _liveKitService.subAgentService));
    }

    if (hasArtifacts) {
      if (children.isNotEmpty) {
        children.add(const SizedBox(width: AppSpacing.sm));
      }
      children.add(TuiButton(
        label: 'ARTIFACTS: ${state.artifacts.length}',
        onPressed: () => showArtifactsListModal(
          context,
          artifacts: state.artifacts,
        ),
      ));
    }

    if (children.length == 1) return children.first;
    return Row(mainAxisSize: MainAxisSize.min, children: children);
  }

  @override
  Widget build(BuildContext context) {
    final state = _liveKitService.state;
    final healthOverall = _liveKitService.healthService.state.overall;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            // Diagnostics bar (48dp min)
            DiagnosticsBar(
              overallHealth: healthOverall,
              status: state.status,
              vadConfidence: state.userAudioLevel,
              errorMessage: state.errorMessage,
              diagnostics: state.diagnostics,
              trailing: _buildTrailingWidgets(context, state),
            ),

            // Error/reconnecting inline banner
            if (state.status == ConversationStatus.error ||
                state.status == ConversationStatus.reconnecting)
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.base,
                  vertical: AppSpacing.xs,
                ),
                child: TuiCard(
                  borderColor: state.status == ConversationStatus.reconnecting
                      ? AppColors.healthYellow
                      : AppColors.healthRed,
                  child: Text(
                    state.status == ConversationStatus.reconnecting
                        ? 'Connection lost. Reconnecting...'
                        : state.errorMessage ?? 'Connection error',
                    style: AppTypography.body.copyWith(
                      color: state.status == ConversationStatus.reconnecting
                          ? AppColors.healthYellow
                          : AppColors.healthRed,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),

            // Chat transcript (fills remaining space)
            Expanded(
              child: ChatTranscript(service: _liveKitService),
            ),
            const SizedBox(height: AppSpacing.sm),

            // Voice control bar: mic + histograms (voice mode) or text field
            VoiceControlBar(service: _liveKitService),
            const SizedBox(height: AppSpacing.base),
          ],
        ),
      ),
    );
  }
}
