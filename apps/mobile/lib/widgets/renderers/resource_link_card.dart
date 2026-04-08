import 'package:flutter/material.dart';

import '../../models/content_block.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../theme/tui_widgets.dart';

/// Card widget for ACP `resource_link` content blocks.
///
/// Displays resource metadata: file icon, [ResourceLinkContent.name],
/// [ResourceLinkContent.mimeType], formatted [ResourceLinkContent.size],
/// [ResourceLinkContent.description], and a truncated URI.
/// Includes a placeholder download button (action deferred to Epic 31).
///
/// Appearance:
/// ```
/// ┌ RESOURCE ─────────────────────────────
/// 📄 filename.pdf
///    application/pdf  ·  1.4 MB
///    Optional description text
///    file:///path/to/file.pdf
///                               [ DOWNLOAD ]
/// ```
class ResourceLinkCard extends StatelessWidget {
  final ResourceLinkContent block;

  const ResourceLinkCard({super.key, required this.block});

  @override
  Widget build(BuildContext context) {
    return TuiCard(
      borderColor: AppColors.cyan,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row: icon + name
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _fileIcon(block.mimeType),
                style: AppTypography.body.copyWith(color: AppColors.cyan),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  block.name,
                  style: AppTypography.body,
                  overflow: TextOverflow.ellipsis,
                  maxLines: 2,
                ),
              ),
            ],
          ),
          // Metadata row: mimeType · size
          if (block.mimeType != null || block.size != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              _metadataLine(),
              style: AppTypography.overline,
            ),
          ],
          // Description
          if (block.description != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              block.description!,
              style: AppTypography.statusMetric,
            ),
          ],
          // URI (truncated)
          const SizedBox(height: AppSpacing.xs),
          Text(
            block.uri,
            style: AppTypography.overline.copyWith(
              color: AppColors.textSecondary,
            ),
            overflow: TextOverflow.ellipsis,
            maxLines: 1,
          ),
          // Download placeholder button
          const SizedBox(height: AppSpacing.md),
          Align(
            alignment: Alignment.centerRight,
            child: TuiButton(
              label: 'Download',
              color: AppColors.cyan,
              onPressed: null, // Epic 31: resource delivery
            ),
          ),
        ],
      ),
    );
  }

  /// Returns a simple ASCII/Unicode file icon based on [mimeType].
  String _fileIcon(String? mimeType) {
    if (mimeType == null) return '\u{1F4C4}'; // 📄
    if (mimeType.startsWith('image/')) return '\u{1F5BC}'; // 🖼
    if (mimeType.startsWith('audio/')) return '\u{1F3B5}'; // 🎵
    if (mimeType.startsWith('video/')) return '\u{1F3AC}'; // 🎬
    if (mimeType == 'application/pdf') return '\u{1F4D5}'; // 📕
    if (mimeType.startsWith('text/')) return '\u{1F4DD}'; // 📝
    return '\u{1F4C4}'; // 📄 default
  }

  String _metadataLine() {
    final parts = <String>[];
    if (block.mimeType != null) parts.add(block.mimeType!);
    if (block.size != null) parts.add(formatBytes(block.size!));
    return parts.join('  \u00B7  '); // · separator
  }
}

/// Formats a byte count into a human-readable string.
///
/// Examples: `512 B`, `1.5 KB`, `2.3 MB`.
String formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}
