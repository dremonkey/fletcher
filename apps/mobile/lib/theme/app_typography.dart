import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Monospace typography system for the TUI brutalist design.
///
/// All text uses monospace font. We use the platform default monospace font
/// for now; a custom font (e.g. JetBrains Mono) can be bundled later.
class AppTypography {
  AppTypography._();

  static const String _fontFamily = 'monospace';

  /// Message body text — 14sp, w400.
  static const TextStyle body = TextStyle(
    fontFamily: _fontFamily,
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: AppColors.textPrimary,
  );

  /// Labels (USER/AGENT) — 12sp, w700, uppercase by convention.
  static const TextStyle label = TextStyle(
    fontFamily: _fontFamily,
    fontSize: 12,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
  );

  /// Status bar metrics — 12sp, w500.
  static const TextStyle statusMetric = TextStyle(
    fontFamily: _fontFamily,
    fontSize: 12,
    fontWeight: FontWeight.w500,
    color: AppColors.textSecondary,
  );

  /// Artifact badges — 12sp, w500, uppercase by convention.
  static const TextStyle artifactBadge = TextStyle(
    fontFamily: _fontFamily,
    fontSize: 12,
    fontWeight: FontWeight.w500,
    color: AppColors.textPrimary,
  );

  /// Artifact content — 13sp, w400. For code/log content.
  static const TextStyle artifactContent = TextStyle(
    fontFamily: _fontFamily,
    fontSize: 13,
    fontWeight: FontWeight.w400,
    color: AppColors.textPrimary,
  );

  /// Overline/timestamps — 11sp, w500. Minimum size, metadata only.
  static const TextStyle overline = TextStyle(
    fontFamily: _fontFamily,
    fontSize: 11,
    fontWeight: FontWeight.w500,
    color: AppColors.textSecondary,
  );
}
