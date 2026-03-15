import 'package:flutter/material.dart';
import '../models/command_result.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import '../theme/tui_widgets.dart';

/// Inline card displaying the result of a slash command.
///
/// Renders as a TuiCard with green border (or red for errors):
///   [▸] [CMD]  /command    [result text]    [timestamp]
class CommandResultCard extends StatelessWidget {
  final CommandResult result;

  const CommandResultCard({super.key, required this.result});

  @override
  Widget build(BuildContext context) {
    final borderColor = result.isError ? AppColors.healthRed : AppColors.healthGreen;
    final labelColor = result.isError ? AppColors.healthRed : AppColors.healthGreen;

    return TuiCard(
      borderColor: borderColor,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Prefix
              Text(
                '\u25B8',  // ▸
                style: AppTypography.label.copyWith(color: labelColor),
              ),
              const SizedBox(width: AppSpacing.sm),
              // Type label
              Text(
                'CMD',
                style: AppTypography.label.copyWith(color: labelColor),
              ),
              const SizedBox(width: AppSpacing.sm),
              // Command name
              Expanded(
                child: Text(
                  '/${result.command}',
                  style: AppTypography.label.copyWith(
                    color: AppColors.textSecondary,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              // Timestamp
              Text(
                _formatTimestamp(result.timestamp),
                style: AppTypography.overline,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          // Result text body
          Text(
            result.text,
            style: AppTypography.label.copyWith(
              color: result.isError ? AppColors.healthRed : AppColors.textPrimary,
              fontWeight: FontWeight.w400,
            ),
          ),
        ],
      ),
    );
  }

  String _formatTimestamp(DateTime ts) {
    final h = ts.hour.toString().padLeft(2, '0');
    final m = ts.minute.toString().padLeft(2, '0');
    final s = ts.second.toString().padLeft(2, '0');
    return '$h:$m:$s';
  }
}
