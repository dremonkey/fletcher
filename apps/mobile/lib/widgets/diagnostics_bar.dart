import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/conversation_state.dart';
import '../models/health_state.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import '../theme/tui_widgets.dart';

/// Horizontal status bar showing system health, VAD level, and round-trip time.
///
/// Left side is tappable and opens an expanded diagnostics modal.
/// Right side accepts an optional trailing widget (e.g. artifact counter).
class DiagnosticsBar extends StatelessWidget {
  final OverallHealth overallHealth;
  final ConversationStatus status;
  final double vadConfidence;
  final String? errorMessage;

  /// Live diagnostics data (RT, session, agent, uptime, providers).
  final DiagnosticsInfo diagnostics;

  /// Optional widget displayed on the right side (e.g. artifacts button).
  final Widget? trailing;

  /// Optional override for the diagnostics tap action.
  final VoidCallback? onTapDiagnostics;

  const DiagnosticsBar({
    super.key,
    required this.overallHealth,
    required this.status,
    required this.vadConfidence,
    this.errorMessage,
    this.diagnostics = const DiagnosticsInfo(),
    this.trailing,
    this.onTapDiagnostics,
  });

  Color get _orbColor {
    switch (overallHealth) {
      case OverallHealth.healthy:
        return AppColors.healthGreen;
      case OverallHealth.degraded:
        return AppColors.healthYellow;
      case OverallHealth.unhealthy:
        return AppColors.healthRed;
    }
  }

  String get _sysText {
    switch (status) {
      case ConversationStatus.error:
        return 'ERROR';
      case ConversationStatus.reconnecting:
        return 'RECONNECTING';
      default:
        switch (overallHealth) {
          case OverallHealth.healthy:
            return 'OK';
          case OverallHealth.degraded:
            return 'DEGRADED';
          case OverallHealth.unhealthy:
            return 'ERROR';
        }
    }
  }

  String get _rtText {
    final rt = diagnostics.roundTripMs;
    if (rt == null) return '--';
    return '${rt}ms';
  }

  /// Color for the TOK metric based on context window usage percentage.
  Color get _tokenColor {
    final pct = diagnostics.tokenPercentage;
    if (pct == null) return AppColors.cyan;
    if (pct >= 0.9) return AppColors.healthRed;
    if (pct >= 0.75) return AppColors.healthYellow;
    return AppColors.cyan;
  }

  void _showDiagnosticsModal(BuildContext context) {
    HapticFeedback.lightImpact();
    if (onTapDiagnostics != null) {
      onTapDiagnostics!();
      return;
    }
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      barrierColor: Colors.black54,
      shape: const Border(top: BorderSide(color: AppColors.amber, width: 2)),
      builder: (context) => _DiagnosticsModal(
        overallHealth: overallHealth,
        status: status,
        vadConfidence: vadConfidence,
        errorMessage: errorMessage,
        diagnostics: diagnostics,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pipeStyle = AppTypography.statusMetric.copyWith(
      color: AppColors.textSecondary,
    );
    final metricStyle = AppTypography.statusMetric.copyWith(
      color: AppColors.cyan,
    );

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => _showDiagnosticsModal(context),
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.base),
        child: Row(
          children: [
            // Left side: diagnostics summary
            Expanded(
              child: Row(
                children: [
                  // Health orb with glow
                  RepaintBoundary(
                    child: Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(
                        color: _orbColor,
                        borderRadius: BorderRadius.zero,
                        boxShadow: [
                          BoxShadow(
                            color: _orbColor.withAlpha(128),
                            blurRadius: 6,
                            spreadRadius: 1,
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  // Metrics text
                  Flexible(
                    child: Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(text: 'SYS: ', style: metricStyle),
                          TextSpan(text: _sysText, style: metricStyle),
                          TextSpan(text: ' | ', style: pipeStyle),
                          TextSpan(text: 'VAD: ', style: metricStyle),
                          TextSpan(
                            text: vadConfidence.toStringAsFixed(2),
                            style: metricStyle,
                          ),
                          TextSpan(text: ' | ', style: pipeStyle),
                          TextSpan(text: 'RT: ', style: metricStyle),
                          TextSpan(text: _rtText, style: metricStyle),
                          if (diagnostics.tokenDisplay != null) ...[
                            TextSpan(text: ' | ', style: pipeStyle),
                            TextSpan(text: 'TOK: ', style: metricStyle),
                            TextSpan(
                              text: diagnostics.tokenDisplay!,
                              style: metricStyle.copyWith(color: _tokenColor),
                            ),
                          ],
                        ],
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  ),
                ],
              ),
            ),
            // Right side: trailing widget (e.g. artifacts button)
            if (trailing != null) ...[
              const SizedBox(width: AppSpacing.sm),
              trailing!,
            ],
          ],
        ),
      ),
    );
  }
}

/// Expanded diagnostics modal shown on tap.
///
/// Stateful to support a periodic Timer that updates the UPTIME field
/// every second while the modal is open.
class _DiagnosticsModal extends StatefulWidget {
  final OverallHealth overallHealth;
  final ConversationStatus status;
  final double vadConfidence;
  final String? errorMessage;
  final DiagnosticsInfo diagnostics;

  const _DiagnosticsModal({
    required this.overallHealth,
    required this.status,
    required this.vadConfidence,
    this.errorMessage,
    required this.diagnostics,
  });

  @override
  State<_DiagnosticsModal> createState() => _DiagnosticsModalState();
}

class _DiagnosticsModalState extends State<_DiagnosticsModal> {
  Timer? _uptimeTimer;

  @override
  void initState() {
    super.initState();
    // Tick every second to update uptime display
    if (widget.diagnostics.connectedAt != null) {
      _uptimeTimer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    }
  }

  @override
  void dispose() {
    _uptimeTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final labelStyle = AppTypography.statusMetric.copyWith(
      color: AppColors.cyan,
    );
    final valueStyle = AppTypography.statusMetric.copyWith(
      color: AppColors.textPrimary,
    );
    final diag = widget.diagnostics;

    return Padding(
      padding: const EdgeInsets.all(AppSpacing.base),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TuiHeader(label: 'DIAGNOSTICS', color: AppColors.amber),
          const SizedBox(height: AppSpacing.md),
          _DiagRow(label: 'SYS', value: _sysValue, labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'CONNECTION', value: _connectionValue, labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'STT', value: diag.sttProvider ?? '--', labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'TTS', value: diag.ttsProvider ?? '--', labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'LLM', value: diag.llmProvider ?? '--', labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'VAD', value: widget.vadConfidence.toStringAsFixed(2), labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(
            label: 'TOKENS',
            value: diag.tokenDisplay ?? '--',
            labelStyle: labelStyle,
            valueStyle: valueStyle.copyWith(color: _tokenColor),
          ),
          _DiagRow(label: 'RT', value: _rtValue, labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'SESSION', value: diag.sessionName ?? '--', labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'AGENT', value: diag.agentIdentity ?? '--', labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'UPTIME', value: _uptimeValue, labelStyle: labelStyle, valueStyle: valueStyle),
          if (widget.errorMessage != null)
            _DiagRow(label: 'ERROR', value: widget.errorMessage!, labelStyle: labelStyle, valueStyle: valueStyle.copyWith(color: AppColors.healthRed)),
          const SizedBox(height: AppSpacing.sm),
        ],
      ),
    );
  }

  String get _sysValue {
    switch (widget.overallHealth) {
      case OverallHealth.healthy:
        return 'OK';
      case OverallHealth.degraded:
        return 'DEGRADED';
      case OverallHealth.unhealthy:
        return 'ERROR';
    }
  }

  String get _connectionValue {
    switch (widget.status) {
      case ConversationStatus.connecting:
        return 'CONNECTING';
      case ConversationStatus.reconnecting:
        return 'RECONNECTING';
      case ConversationStatus.error:
        return 'ERROR';
      default:
        return 'CONNECTED';
    }
  }

  String get _rtValue {
    final rt = widget.diagnostics.roundTripMs;
    if (rt == null) return '--';
    return '${rt}ms';
  }

  String get _uptimeValue {
    final connectedAt = widget.diagnostics.connectedAt;
    if (connectedAt == null) return '--';
    final duration = DateTime.now().difference(connectedAt);
    return DiagnosticsInfo.formatUptime(duration);
  }

  /// Color for the TOKENS row based on context window usage percentage.
  Color get _tokenColor {
    final pct = widget.diagnostics.tokenPercentage;
    if (pct == null) return AppColors.textPrimary;
    if (pct >= 0.9) return AppColors.healthRed;
    if (pct >= 0.75) return AppColors.healthYellow;
    return AppColors.textPrimary;
  }
}

class _DiagRow extends StatelessWidget {
  final String label;
  final String value;
  final TextStyle labelStyle;
  final TextStyle valueStyle;

  const _DiagRow({
    required this.label,
    required this.value,
    required this.labelStyle,
    required this.valueStyle,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: labelStyle),
          Flexible(
            child: Text(
              value,
              style: valueStyle,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }
}
