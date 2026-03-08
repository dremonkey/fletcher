import 'package:flutter/material.dart';

import '../models/system_event.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import '../theme/tui_widgets.dart';

/// Compact inline card displaying a connection lifecycle event.
///
/// Renders as a single-row TuiCard with cyan left border:
///   [prefix] [TYPE]    [message]    [timestamp]
///
/// No TuiHeader, not tappable -- purely informational.
/// Uses [AnimatedSwitcher] on the message text for smooth status transitions.
class SystemEventCard extends StatelessWidget {
  final SystemEvent event;

  const SystemEventCard({super.key, required this.event});

  @override
  Widget build(BuildContext context) {
    return TuiCard(
      borderColor: AppColors.cyan,
      child: Row(
        children: [
          // Prefix symbol
          Text(
            event.prefix,
            style: AppTypography.label.copyWith(
              color: _messageColor,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),

          // Type label (NETWORK / ROOM / AGENT)
          Text(
            event.typeLabel,
            style: AppTypography.label.copyWith(
              color: AppColors.cyan,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),

          // Message with animated transitions
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 300),
              child: Text(
                event.message,
                key: ValueKey('${event.id}-${event.status}-${event.message}'),
                style: AppTypography.label.copyWith(
                  color: _messageColor,
                  fontWeight: FontWeight.w400,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),

          // Timestamp
          Text(
            _formatTimestamp(event.timestamp),
            style: AppTypography.overline,
          ),
        ],
      ),
    );
  }

  /// Message text color based on event status.
  Color get _messageColor {
    switch (event.status) {
      case SystemEventStatus.pending:
        return AppColors.textSecondary;
      case SystemEventStatus.success:
        return AppColors.healthGreen;
      case SystemEventStatus.error:
        return AppColors.healthRed;
    }
  }

  String _formatTimestamp(DateTime ts) {
    final h = ts.hour.toString().padLeft(2, '0');
    final m = ts.minute.toString().padLeft(2, '0');
    final s = ts.second.toString().padLeft(2, '0');
    return '$h:$m:$s';
  }
}
