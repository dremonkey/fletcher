import 'package:flutter/material.dart';

import '../models/conversation_state.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Compact inline indicator for a single ACP tool call.
///
/// Shown in the chat transcript while the agent is working. Displays the tool
/// name, a status icon (in-progress / completed / error), and the elapsed
/// duration once the tool call has finished.
///
/// Appearance:
/// ```
/// ▸ memory_search
/// ✓ memory_search (1.2s)
/// ✕ memory_search (0.4s)
/// ```
class ToolCallCard extends StatelessWidget {
  final ToolCallInfo toolCall;

  const ToolCallCard({super.key, required this.toolCall});

  @override
  Widget build(BuildContext context) {
    final statusIcon = toolCall.status == 'completed'
        ? '\u2713'  // ✓
        : toolCall.status == 'error'
            ? '\u2715'  // ✕
            : '\u25b8'; // ▸ (in-progress)

    final durationText = toolCall.duration != null
        ? ' (${(toolCall.duration!.inMilliseconds / 1000).toStringAsFixed(1)}s)'
        : '';

    return Padding(
      padding: const EdgeInsets.symmetric(
        vertical: 2,
        horizontal: AppSpacing.base,
      ),
      child: Text(
        '$statusIcon ${toolCall.name}$durationText',
        style: AppTypography.statusMetric.copyWith(
          color: AppColors.textSecondary,
        ),
      ),
    );
  }
}
