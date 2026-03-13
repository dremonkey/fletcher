/// Tests for DiagnosticsInfo — token usage fields, computed getters,
/// and copyWith behaviour.
///
/// Widget-level tests (DiagnosticsBar rendering) are in
/// test/widgets/diagnostics_bar_test.dart.

import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/models/conversation_state.dart';

void main() {
  group('DiagnosticsInfo.tokenDisplay', () {
    test('returns null when both tokenUsed and tokenSize are null', () {
      const info = DiagnosticsInfo();
      expect(info.tokenDisplay, isNull);
    });

    test('returns null when only tokenUsed is set', () {
      const info = DiagnosticsInfo(tokenUsed: 35000);
      expect(info.tokenDisplay, isNull);
    });

    test('returns null when only tokenSize is set', () {
      const info = DiagnosticsInfo(tokenSize: 1048576);
      expect(info.tokenDisplay, isNull);
    });

    test('formats 35224 / 1048576 as "35K / 1M"', () {
      const info = DiagnosticsInfo(tokenUsed: 35224, tokenSize: 1048576);
      expect(info.tokenDisplay, '35K / 1M');
    });

    test('formats 500 / 128000 as "1K / 128K" (rounds used to nearest K)', () {
      const info = DiagnosticsInfo(tokenUsed: 500, tokenSize: 128000);
      expect(info.tokenDisplay, '1K / 128K');
    });

    test('formats 0 / 1048576 as "0K / 1M"', () {
      const info = DiagnosticsInfo(tokenUsed: 0, tokenSize: 1048576);
      expect(info.tokenDisplay, '0K / 1M');
    });

    test('formats 1000 / 4000 as "1K / 4K" (sub-million size uses K suffix)',
        () {
      const info = DiagnosticsInfo(tokenUsed: 1000, tokenSize: 4000);
      expect(info.tokenDisplay, '1K / 4K');
    });

    test('formats 2000000 / 8000000 as "2000K / 8M"', () {
      // Used is always in K (no M conversion for used)
      const info = DiagnosticsInfo(tokenUsed: 2000000, tokenSize: 8000000);
      expect(info.tokenDisplay, '2000K / 8M');
    });
  });

  group('DiagnosticsInfo.tokenPercentage', () {
    test('returns null when both fields are null', () {
      const info = DiagnosticsInfo();
      expect(info.tokenPercentage, isNull);
    });

    test('returns null when only tokenUsed is set', () {
      const info = DiagnosticsInfo(tokenUsed: 35000);
      expect(info.tokenPercentage, isNull);
    });

    test('returns null when only tokenSize is set', () {
      const info = DiagnosticsInfo(tokenSize: 1048576);
      expect(info.tokenPercentage, isNull);
    });

    test('returns null when tokenSize is 0 (avoid division by zero)', () {
      const info = DiagnosticsInfo(tokenUsed: 1000, tokenSize: 0);
      expect(info.tokenPercentage, isNull);
    });

    test('returns 0.0 when tokenUsed is 0', () {
      const info = DiagnosticsInfo(tokenUsed: 0, tokenSize: 1000);
      expect(info.tokenPercentage, 0.0);
    });

    test('returns 1.0 when fully consumed', () {
      const info = DiagnosticsInfo(tokenUsed: 1000, tokenSize: 1000);
      expect(info.tokenPercentage, 1.0);
    });

    test('returns correct fraction for partial usage', () {
      const info = DiagnosticsInfo(tokenUsed: 35224, tokenSize: 1048576);
      final pct = info.tokenPercentage!;
      // 35224 / 1048576 ≈ 0.03359
      expect(pct, closeTo(35224 / 1048576, 1e-9));
    });

    test('returns 0.5 for half-consumed context window', () {
      const info = DiagnosticsInfo(tokenUsed: 500, tokenSize: 1000);
      expect(info.tokenPercentage, 0.5);
    });
  });

  group('DiagnosticsInfo.copyWith token fields', () {
    test('copyWith sets tokenUsed and tokenSize', () {
      const info = DiagnosticsInfo();
      final copy = info.copyWith(tokenUsed: 35224, tokenSize: 1048576);
      expect(copy.tokenUsed, 35224);
      expect(copy.tokenSize, 1048576);
    });

    test('copyWith preserves existing token fields when not specified', () {
      const info = DiagnosticsInfo(tokenUsed: 10000, tokenSize: 200000);
      final copy = info.copyWith(roundTripMs: 500);
      expect(copy.tokenUsed, 10000);
      expect(copy.tokenSize, 200000);
      expect(copy.roundTripMs, 500);
    });

    test('copyWith updates tokenUsed independently', () {
      const info = DiagnosticsInfo(tokenUsed: 10000, tokenSize: 200000);
      final copy = info.copyWith(tokenUsed: 50000);
      expect(copy.tokenUsed, 50000);
      expect(copy.tokenSize, 200000);
    });

    test('copyWith clears tokenUsed with clearTokenUsed flag', () {
      const info = DiagnosticsInfo(tokenUsed: 10000, tokenSize: 200000);
      final copy = info.copyWith(clearTokenUsed: true);
      expect(copy.tokenUsed, isNull);
      expect(copy.tokenSize, 200000);
    });

    test('copyWith clears tokenSize with clearTokenSize flag', () {
      const info = DiagnosticsInfo(tokenUsed: 10000, tokenSize: 200000);
      final copy = info.copyWith(clearTokenSize: true);
      expect(copy.tokenUsed, 10000);
      expect(copy.tokenSize, isNull);
    });

    test('default DiagnosticsInfo has null token fields', () {
      const info = DiagnosticsInfo();
      expect(info.tokenUsed, isNull);
      expect(info.tokenSize, isNull);
    });
  });
}
