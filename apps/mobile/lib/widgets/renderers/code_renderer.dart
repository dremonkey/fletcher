import 'package:flutter/material.dart';
import '../../models/content_block.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

/// Renders a [TextContent] or [ResourceContent] block as syntax-highlighted code.
///
/// The language hint is derived from [TextContent.mimeType]:
/// - `text/x-python` → python
/// - `text/x-typescript` → typescript
/// - `text/x-<lang>` → lang
///
/// Line numbers are shown starting at 1.
class CodeRenderer extends StatelessWidget {
  final ContentBlock block;

  const CodeRenderer({super.key, required this.block});

  @override
  Widget build(BuildContext context) {
    final content = _extractContent(block);
    final language = _extractLanguage(block);
    final filePath = _extractPath(block);
    final lines = content.split('\n');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // File / language header
        if (filePath != null || language != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.base,
              vertical: AppSpacing.sm,
            ),
            color: AppColors.background,
            child: Row(
              children: [
                if (filePath != null)
                  Expanded(
                    child: Text(
                      filePath,
                      style: AppTypography.overline
                          .copyWith(color: AppColors.textSecondary),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                if (language != null) ...[
                  if (filePath != null) const SizedBox(width: AppSpacing.sm),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.zero,
                      border: Border.all(color: AppColors.textSecondary),
                    ),
                    child: Text(
                      language,
                      style: AppTypography.overline
                          .copyWith(color: AppColors.textSecondary),
                    ),
                  ),
                ],
              ],
            ),
          ),

        // Code content with line numbers
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(AppSpacing.base),
            itemCount: lines.length,
            itemBuilder: (context, index) {
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 40,
                    child: Text(
                      '${index + 1}',
                      style: AppTypography.artifactContent.copyWith(
                        color: AppColors.textSecondary,
                        height: 1.5,
                      ),
                      textAlign: TextAlign.right,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Text(
                      lines[index],
                      style: AppTypography.artifactContent.copyWith(height: 1.5),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }

  static String _extractContent(ContentBlock block) {
    if (block is TextContent) return block.text;
    if (block is ResourceContent) return block.text ?? '';
    return '';
  }

  /// Extracts the language hint from the mimeType, e.g. `text/x-python` → `python`.
  static String? _extractLanguage(ContentBlock block) => extractLanguageForTest(block);

  /// Public entry point for unit tests — same as [_extractLanguage].
  @visibleForTesting
  static String? extractLanguageForTest(ContentBlock block) {
    String? mime;
    if (block is TextContent) mime = block.mimeType;
    if (block is ResourceContent) mime = block.mimeType;
    if (mime == null) return null;
    if (mime.startsWith('text/x-')) {
      return mime.substring('text/x-'.length);
    }
    return null;
  }

  static String? _extractPath(ContentBlock block) {
    if (block is ResourceContent) return block.uri.isNotEmpty ? block.uri : null;
    return null;
  }
}
