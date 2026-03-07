import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/theme/app_colors.dart';

void main() {
  group('AppColors', () {
    test('background is dark grey #121212', () {
      expect(AppColors.background, const Color(0xFF121212));
    });

    test('surface is slightly lighter #1A1A1A', () {
      expect(AppColors.surface, const Color(0xFF1A1A1A));
    });

    test('amber is #FFB300', () {
      expect(AppColors.amber, const Color(0xFFFFB300));
    });

    test('cyan is #00E5FF', () {
      expect(AppColors.cyan, const Color(0xFF00E5FF));
    });

    test('textPrimary is white', () {
      expect(AppColors.textPrimary, const Color(0xFFFFFFFF));
    });

    test('textSecondary is muted grey', () {
      expect(AppColors.textSecondary, const Color(0xFF888888));
    });

    test('healthGreen is pure green', () {
      expect(AppColors.healthGreen, const Color(0xFF00FF00));
    });

    test('healthYellow is #FFD600', () {
      expect(AppColors.healthYellow, const Color(0xFFFFD600));
    });

    test('healthRed is #FF1744', () {
      expect(AppColors.healthRed, const Color(0xFFFF1744));
    });

    test('amberGlow has 30% opacity (alpha 0x4D)', () {
      expect(AppColors.amberGlow, const Color(0x4DFFB300));
      expect(AppColors.amberGlow.a, closeTo(0.3, 0.01));
    });
  });
}
