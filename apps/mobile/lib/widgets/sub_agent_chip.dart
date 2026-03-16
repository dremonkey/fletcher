import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/sub_agent_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import 'sub_agent_panel.dart';

/// Compact chip shown in the DiagnosticsBar trailing slot.
///
/// Displays running sub-agent count: `SUB: 2▸`
/// Tapping opens the [SubAgentPanel] bottom sheet.
class SubAgentChip extends StatelessWidget {
  final SubAgentService service;

  const SubAgentChip({super.key, required this.service});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: service,
      builder: (context, _) {
        if (!service.hasAgents) return const SizedBox.shrink();

        final running = service.runningCount;
        final total = service.agents.length;

        return GestureDetector(
          onTap: () {
            HapticFeedback.lightImpact();
            showSubAgentPanel(context, service);
          },
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm,
              vertical: AppSpacing.xs,
            ),
            decoration: BoxDecoration(
              border: Border.all(
                color: running > 0 ? AppColors.amber : AppColors.textSecondary,
                width: 1,
              ),
            ),
            child: Text(
              running > 0 ? 'SUB: $running\u25B8' : 'SUB: $total',
              style: AppTypography.statusMetric.copyWith(
                color: running > 0 ? AppColors.amber : AppColors.textSecondary,
              ),
            ),
          ),
        );
      },
    );
  }
}
