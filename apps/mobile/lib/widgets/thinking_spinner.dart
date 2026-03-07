import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import '../theme/tui_widgets.dart';

/// Inline animated spinner shown in the chat transcript while the agent is
/// "thinking" (between user finishing speaking and first agent text arriving).
///
/// Displays a 4-frame ASCII arrow-assembly animation that cycles at 250ms per
/// frame — an arrow materializing left-to-right, evoking a fletcher crafting
/// an arrow.
///
/// Wrapped in a [TuiCard] with amber left border to match agent messages.
/// Uses monospace amber text, sharp corners, no header.
class ThinkingSpinner extends StatefulWidget {
  const ThinkingSpinner({super.key});

  @override
  State<ThinkingSpinner> createState() => _ThinkingSpinnerState();
}

class _ThinkingSpinnerState extends State<ThinkingSpinner>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  /// 4 frames showing an arrow being assembled/fletched left-to-right.
  static const List<String> _frames = [
    ' \u00B7   \u00B7   \u00B7   \u00B7   \u00B7 ',
    ' \u2500\u2500  \u00B7   \u00B7   \u00B7  \u25B8',
    ' \u2500\u2500\u2500 \u2500\u2500  \u00B7  \u25B8',
    ' \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u25B8',
  ];

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  int get _frameIndex {
    return (_controller.value * _frames.length).floor().clamp(0, _frames.length - 1);
  }

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: TuiCard(
        borderColor: AppColors.amber,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            return Padding(
              padding: const EdgeInsets.only(left: AppSpacing.sm),
              child: Text(
                _frames[_frameIndex],
                style: AppTypography.body.copyWith(
                  color: AppColors.amber,
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
