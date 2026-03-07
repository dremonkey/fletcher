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

  void _showDiagnosticsModal(BuildContext context) {
    HapticFeedback.lightImpact();
    if (onTapDiagnostics != null) {
      onTapDiagnostics!();
      return;
    }
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
      builder: (context) => _DiagnosticsModal(
        overallHealth: overallHealth,
        status: status,
        vadConfidence: vadConfidence,
        errorMessage: errorMessage,
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

    return Container(
      constraints: const BoxConstraints(minHeight: 48),
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.base),
      child: Row(
        children: [
          // Left side: tappable diagnostics summary
          Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => _showDiagnosticsModal(context),
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
                          TextSpan(text: '--', style: metricStyle),
                        ],
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // Right side: trailing widget (e.g. artifacts button)
          if (trailing != null) ...[
            const SizedBox(width: AppSpacing.sm),
            trailing!,
          ],
        ],
      ),
    );
  }
}

/// Expanded diagnostics modal shown on tap.
class _DiagnosticsModal extends StatelessWidget {
  final OverallHealth overallHealth;
  final ConversationStatus status;
  final double vadConfidence;
  final String? errorMessage;

  const _DiagnosticsModal({
    required this.overallHealth,
    required this.status,
    required this.vadConfidence,
    this.errorMessage,
  });

  @override
  Widget build(BuildContext context) {
    final labelStyle = AppTypography.statusMetric.copyWith(
      color: AppColors.cyan,
    );
    final valueStyle = AppTypography.statusMetric.copyWith(
      color: AppColors.textPrimary,
    );

    return TuiModal(
      title: 'DIAGNOSTICS',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _DiagRow(label: 'SYS', value: _sysValue, labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'CONNECTION', value: _connectionValue, labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'STT', value: 'deepgram', labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'TTS', value: 'cartesia', labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'LLM', value: 'openclaw', labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'VAD', value: vadConfidence.toStringAsFixed(2), labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'RT', value: '--', labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'SESSION', value: '--', labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'AGENT', value: '--', labelStyle: labelStyle, valueStyle: valueStyle),
          _DiagRow(label: 'UPTIME', value: '--', labelStyle: labelStyle, valueStyle: valueStyle),
          if (errorMessage != null)
            _DiagRow(label: 'ERROR', value: errorMessage!, labelStyle: labelStyle, valueStyle: valueStyle.copyWith(color: AppColors.healthRed)),
        ],
      ),
    );
  }

  String get _sysValue {
    switch (overallHealth) {
      case OverallHealth.healthy:
        return 'OK';
      case OverallHealth.degraded:
        return 'DEGRADED';
      case OverallHealth.unhealthy:
        return 'ERROR';
    }
  }

  String get _connectionValue {
    switch (status) {
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
