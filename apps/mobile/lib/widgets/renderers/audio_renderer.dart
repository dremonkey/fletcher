import 'package:flutter/material.dart';

import '../../models/content_block.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

/// Renders an ACP `audio` content block as a metadata card with a play button.
///
/// Displays:
/// - Audio icon
/// - MIME type (e.g., `audio/wav`)
/// - Decoded byte size (base64 length × 0.75)
/// - Play button placeholder
///
/// Inline playback is deferred to a future task once `just_audio` is added as
/// a dependency. The button is present but non-functional in this v1.
///
/// Example:
/// ```dart
/// AudioRenderer(
///   block: AudioContent(data: base64Data, mimeType: 'audio/wav'),
/// )
/// ```
class AudioRenderer extends StatelessWidget {
  final AudioContent block;

  const AudioRenderer({super.key, required this.block});

  @override
  Widget build(BuildContext context) {
    final sizeBytes = block.decodedSize;
    final sizeLabel = _formatSize(sizeBytes);

    return Container(
      padding: const EdgeInsets.all(AppSpacing.base),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.textSecondary),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Audio icon
          const Icon(
            Icons.audio_file,
            color: AppColors.cyan,
            size: 32,
          ),
          const SizedBox(width: AppSpacing.md),

          // Metadata column
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                // MIME type
                Text(
                  block.mimeType,
                  style: AppTypography.label.copyWith(
                    color: AppColors.cyan,
                  ),
                  key: const Key('audio_mime_type'),
                ),
                const SizedBox(height: AppSpacing.xs),

                // Decoded size
                Text(
                  sizeLabel,
                  style: AppTypography.overline.copyWith(
                    color: AppColors.textSecondary,
                  ),
                  key: const Key('audio_size'),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.md),

          // Play button placeholder
          _PlayButton(onPressed: null),
        ],
      ),
    );
  }

  /// Format [bytes] into a human-readable string.
  static String _formatSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) {
      final kb = (bytes / 1024).toStringAsFixed(1);
      return '$kb KB';
    }
    final mb = (bytes / (1024 * 1024)).toStringAsFixed(1);
    return '$mb MB';
  }
}

// ---------------------------------------------------------------------------
// Play button (placeholder — no just_audio dependency yet)
// ---------------------------------------------------------------------------

/// Play button widget.
///
/// [onPressed] is null until inline playback is implemented (requires
/// `just_audio` or similar). Renders as a disabled button placeholder
/// when [onPressed] is null.
class _PlayButton extends StatelessWidget {
  final VoidCallback? onPressed;

  const _PlayButton({required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onPressed,
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          border: Border.all(
            color: onPressed != null
                ? AppColors.cyan
                : AppColors.textSecondary,
          ),
        ),
        child: Icon(
          Icons.play_arrow,
          color: onPressed != null
              ? AppColors.cyan
              : AppColors.textSecondary,
          size: 24,
          semanticLabel: 'Play audio',
        ),
      ),
    );
  }
}
