import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/theme/app_spacing.dart';

void main() {
  group('AppSpacing', () {
    test('xs is 4dp', () {
      expect(AppSpacing.xs, 4.0);
    });

    test('sm is 8dp', () {
      expect(AppSpacing.sm, 8.0);
    });

    test('md is 12dp', () {
      expect(AppSpacing.md, 12.0);
    });

    test('base is 16dp', () {
      expect(AppSpacing.base, 16.0);
    });

    test('lg is 24dp', () {
      expect(AppSpacing.lg, 24.0);
    });

    test('xl is 32dp', () {
      expect(AppSpacing.xl, 32.0);
    });

    test('xxl is 48dp', () {
      expect(AppSpacing.xxl, 48.0);
    });

    test('all values are on the 4dp grid', () {
      const values = [
        AppSpacing.xs,
        AppSpacing.sm,
        AppSpacing.md,
        AppSpacing.base,
        AppSpacing.lg,
        AppSpacing.xl,
        AppSpacing.xxl,
      ];
      for (final v in values) {
        expect(v % 4, equals(0), reason: '$v is not on the 4dp grid');
      }
    });
  });
}
