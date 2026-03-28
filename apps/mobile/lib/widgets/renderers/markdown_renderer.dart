import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../../models/content_block.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

/// Renders a [TextContent] block as formatted Markdown.
///
/// Uses the TUI brutalist [MarkdownStyleSheet] with amber accents and
/// monospace fonts throughout.
class MarkdownRenderer extends StatelessWidget {
  final TextContent block;

  const MarkdownRenderer({super.key, required this.block});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Markdown(
        data: block.text,
        selectable: true,
        padding: const EdgeInsets.all(AppSpacing.base),
        styleSheet: MarkdownStyleSheet(
          p: AppTypography.artifactContent,
          h1: AppTypography.body.copyWith(
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
          h2: AppTypography.body.copyWith(
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
          h3: AppTypography.body.copyWith(
            fontSize: 14,
            fontWeight: FontWeight.bold,
          ),
          code: AppTypography.artifactContent.copyWith(
            backgroundColor: AppColors.background,
          ),
          codeblockDecoration: const BoxDecoration(
            color: AppColors.background,
            borderRadius: BorderRadius.zero,
            border: Border.fromBorderSide(
              BorderSide(color: AppColors.textSecondary),
            ),
          ),
          blockquote: AppTypography.artifactContent.copyWith(
            color: AppColors.textSecondary,
            fontStyle: FontStyle.italic,
          ),
          blockquoteDecoration: const BoxDecoration(
            color: AppColors.background,
            borderRadius: BorderRadius.zero,
            border: Border(
              left: BorderSide(color: AppColors.amber, width: 2),
            ),
          ),
          a: AppTypography.artifactContent.copyWith(
            color: AppColors.amber,
            decoration: TextDecoration.underline,
            decorationColor: AppColors.amber,
          ),
          listBullet: AppTypography.artifactContent,
        ),
      ),
    );
  }
}
