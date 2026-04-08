import 'package:flutter/material.dart';
import '../../models/content_block.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

/// Renders a [RawContent] block as formatted, selectable JSON.
///
/// Used as the fallback renderer for unknown content types.
class RawJsonRenderer extends StatelessWidget {
  final RawContent block;

  const RawJsonRenderer({super.key, required this.block});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header with warning
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.base,
            vertical: AppSpacing.sm,
          ),
          color: AppColors.background,
          child: Text(
            'Unknown content type -- showing raw JSON',
            style: AppTypography.overline.copyWith(color: AppColors.textSecondary),
          ),
        ),

        // JSON content
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.base),
            child: SelectableText(
              block.prettyJson,
              style: AppTypography.artifactContent.copyWith(height: 1.5),
            ),
          ),
        ),
      ],
    );
  }
}
