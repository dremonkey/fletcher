import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_typography.dart';
import '../utils/agent_text_parser.dart';

/// Collapsible widget that shows agent reasoning content from `<think>` tags.
///
/// **In-progress mode** ([ThinkingState.inProgress]): Displays a single
/// non-tappable line `◆ thinking ···` while the thinking content is still
/// streaming in.
///
/// **Complete mode** ([ThinkingState.complete]): Starts collapsed (one line,
/// `◆` indicator, truncated preview in quotes). Tap to expand and see the
/// full reasoning text. Tap again to collapse.
///
/// No border or card — sits inline within the parent agent message TuiCard.
class ThinkingBlock extends StatefulWidget {
  const ThinkingBlock({
    super.key,
    required this.text,
    required this.state,
  });

  /// The thinking content from `<think>...</think>`. May be null while
  /// streaming (inProgress) or when the block was empty.
  final String? text;

  /// Whether the thinking block is still streaming or complete.
  final ThinkingState state;

  @override
  State<ThinkingBlock> createState() => _ThinkingBlockState();
}

class _ThinkingBlockState extends State<ThinkingBlock> {
  bool _isExpanded = false;

  void _toggle() {
    if (widget.state != ThinkingState.complete) return;
    setState(() {
      _isExpanded = !_isExpanded;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (widget.state == ThinkingState.inProgress) {
      return _buildInProgress();
    }
    // ThinkingState.complete
    return _buildComplete();
  }

  Widget _buildInProgress() {
    return Text(
      '◆ thinking ···',
      style: AppTypography.overline.copyWith(
        color: AppColors.textSecondary,
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }

  Widget _buildComplete() {
    if (_isExpanded) {
      return _buildExpanded();
    }
    return _buildCollapsed();
  }

  Widget _buildCollapsed() {
    final preview = widget.text ?? '';
    final previewText = preview.isNotEmpty ? ' "$preview"' : '';

    return GestureDetector(
      onTap: _toggle,
      child: Text(
        '◆ thinking ···$previewText',
        style: AppTypography.overline.copyWith(
          color: AppColors.textSecondary,
        ),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    );
  }

  Widget _buildExpanded() {
    return GestureDetector(
      onTap: _toggle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '▼ thinking',
            style: AppTypography.overline.copyWith(
              color: AppColors.textSecondary,
            ),
          ),
          if (widget.text != null && widget.text!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              widget.text!,
              style: AppTypography.body.copyWith(
                fontStyle: FontStyle.italic,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
