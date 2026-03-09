import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_spacing.dart';
import 'app_typography.dart';

/// Renders a TUI-style header: `--- LABEL ---`
///
/// Uses box-drawing aesthetic with configurable label text and color.
class TuiHeader extends StatelessWidget {
  const TuiHeader({
    super.key,
    required this.label,
    this.color = AppColors.amber,
  });

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final style = AppTypography.label.copyWith(color: color);
    final borderStyle = style.copyWith(color: color.withAlpha(153));

    return Row(
      children: [
        Text('\u250C\u2500 ', style: borderStyle),
        Text(label.toUpperCase(), style: style),
        Text(' \u2500\u2510', style: borderStyle),
      ],
    );
  }
}

/// Dark surface card with optional colored left border.
///
/// Sharp corners (no border radius), surface background,
/// and consistent padding.
class TuiCard extends StatelessWidget {
  const TuiCard({
    super.key,
    required this.child,
    this.borderColor,
  });

  final Widget child;

  /// Optional left border accent color. When null, no left border is shown.
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.zero,
        border: borderColor != null
            ? Border(left: BorderSide(color: borderColor!, width: 2))
            : null,
      ),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: child,
    );
  }
}

/// Amber-bordered rectangle button with monospace text.
///
/// Outline style (no fill), sharp corners, minimum 48dp touch target.
class TuiButton extends StatelessWidget {
  const TuiButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.color = AppColors.amber,
  });

  final String label;
  final VoidCallback? onPressed;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: Center(
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onPressed,
          child: Container(
            height: 36,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.base),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.zero,
              border: Border.all(color: color),
            ),
            alignment: Alignment.center,
            child: Text(
              label.toUpperCase(),
              style: AppTypography.label.copyWith(color: color),
            ),
          ),
        ),
      ),
    );
  }
}

/// Full amber border modal with dark background and TuiHeader at top.
class TuiModal extends StatelessWidget {
  const TuiModal({
    super.key,
    required this.title,
    required this.child,
    this.borderColor = AppColors.amber,
  });

  final String title;
  final Widget child;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.zero,
        border: Border.all(color: borderColor, width: 1),
      ),
      padding: const EdgeInsets.all(AppSpacing.base),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TuiHeader(label: title, color: borderColor),
          const SizedBox(height: AppSpacing.md),
          child,
        ],
      ),
    );
  }
}
