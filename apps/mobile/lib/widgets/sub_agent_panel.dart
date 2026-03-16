import 'package:flutter/material.dart';

import '../services/sub_agent_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/tui_widgets.dart';
import 'sub_agent_card.dart';

/// Show the sub-agent panel as a modal bottom sheet.
void showSubAgentPanel(BuildContext context, SubAgentService service) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.surface,
    barrierColor: Colors.black54,
    shape: const Border(top: BorderSide(color: AppColors.amber, width: 2)),
    builder: (context) => _SubAgentPanel(service: service),
  );
}

class _SubAgentPanel extends StatelessWidget {
  final SubAgentService service;

  const _SubAgentPanel({required this.service});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: service,
      builder: (context, _) {
        final agents = service.agents;
        // Sort: running first, then by startedAt descending
        final sorted = List.of(agents)
          ..sort((a, b) {
            if (a.isRunning && !b.isRunning) return -1;
            if (!a.isRunning && b.isRunning) return 1;
            return b.startedAt.compareTo(a.startedAt);
          });

        return ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.65,
          ),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.base),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TuiHeader(label: 'SUB-AGENTS', color: AppColors.amber),
                const SizedBox(height: AppSpacing.md),
                if (sorted.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                    child: Center(
                      child: Text(
                        'No sub-agents',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                  )
                else
                  Flexible(
                    child: ListView.separated(
                      shrinkWrap: true,
                      itemCount: sorted.length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(height: AppSpacing.sm),
                      itemBuilder: (context, index) =>
                          SubAgentCard(agent: sorted[index]),
                    ),
                  ),
                const SizedBox(height: AppSpacing.sm),
              ],
            ),
          ),
        );
      },
    );
  }
}
