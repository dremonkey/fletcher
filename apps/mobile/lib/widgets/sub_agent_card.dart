import 'dart:async';

import 'package:flutter/material.dart';

import '../models/sub_agent_info.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Individual sub-agent row in the [SubAgentPanel].
///
/// Shows status icon, task description, duration, and optional model/output.
class SubAgentCard extends StatefulWidget {
  final SubAgentInfo agent;

  const SubAgentCard({super.key, required this.agent});

  @override
  State<SubAgentCard> createState() => _SubAgentCardState();
}

class _SubAgentCardState extends State<SubAgentCard> {
  Timer? _durationTimer;

  @override
  void initState() {
    super.initState();
    if (widget.agent.isRunning) {
      _durationTimer = Timer.periodic(
        const Duration(seconds: 1),
        (_) {
          if (mounted) setState(() {});
        },
      );
    }
  }

  @override
  void didUpdateWidget(SubAgentCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.agent.isRunning && _durationTimer == null) {
      _durationTimer = Timer.periodic(
        const Duration(seconds: 1),
        (_) {
          if (mounted) setState(() {});
        },
      );
    } else if (!widget.agent.isRunning && _durationTimer != null) {
      _durationTimer?.cancel();
      _durationTimer = null;
    }
  }

  @override
  void dispose() {
    _durationTimer?.cancel();
    super.dispose();
  }

  Color get _statusColor {
    switch (widget.agent.status) {
      case SubAgentStatus.running:
        return AppColors.amber;
      case SubAgentStatus.completed:
        return AppColors.healthGreen;
      case SubAgentStatus.error:
        return AppColors.healthRed;
      case SubAgentStatus.timeout:
        return AppColors.healthYellow;
    }
  }

  String get _statusIcon {
    switch (widget.agent.status) {
      case SubAgentStatus.running:
        return '\u25B6'; // ▶
      case SubAgentStatus.completed:
        return '\u2713'; // ✓
      case SubAgentStatus.error:
        return '\u2715'; // ✕
      case SubAgentStatus.timeout:
        return '\u25CB'; // ○
    }
  }

  @override
  Widget build(BuildContext context) {
    final agent = widget.agent;
    final dimmed = agent.isTerminal;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(
          left: BorderSide(color: _statusColor, width: 2),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row: status icon + task + duration
          Row(
            children: [
              Text(
                _statusIcon,
                style: AppTypography.statusMetric.copyWith(color: _statusColor),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  agent.task,
                  style: AppTypography.body.copyWith(
                    color: dimmed
                        ? AppColors.textSecondary
                        : AppColors.textPrimary,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                agent.durationDisplay,
                style: AppTypography.overline.copyWith(
                  color: dimmed ? AppColors.textSecondary : AppColors.cyan,
                ),
              ),
            ],
          ),
          // Metadata row: model + tokens
          if (agent.model != null || agent.tokens != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Row(
              children: [
                const SizedBox(width: 20), // Align with task text
                if (agent.model != null)
                  Text(
                    agent.model!,
                    style: AppTypography.overline.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                if (agent.model != null && agent.tokens != null)
                  Text(
                    ' \u00B7 ',
                    style: AppTypography.overline.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                if (agent.tokens != null)
                  Text(
                    '${agent.tokens} tok',
                    style: AppTypography.overline.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
              ],
            ),
          ],
          // Last output preview
          if (agent.lastOutput != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Padding(
              padding: const EdgeInsets.only(left: 20),
              child: Text(
                agent.lastOutput!,
                style: AppTypography.overline.copyWith(
                  color: AppColors.textSecondary,
                  fontStyle: FontStyle.italic,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
