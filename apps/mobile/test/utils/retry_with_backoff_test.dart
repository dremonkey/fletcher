import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/utils/retry_with_backoff.dart';

void main() {
  // Fake delay that records durations without actually waiting.
  late List<Duration> recordedDelays;
  Future<void> fakeDelay(Duration d) async {
    recordedDelays.add(d);
  }

  setUp(() {
    recordedDelays = [];
  });

  group('retryWithBackoff', () {
    test('succeeds on first attempt — no retries', () async {
      var callCount = 0;

      final result = await retryWithBackoff<String>(
        fn: () async {
          callCount++;
          return 'ok';
        },
        maxAttempts: 3,
        delays: [const Duration(seconds: 2), const Duration(seconds: 3)],
        delayFn: fakeDelay,
      );

      expect(result.succeeded, isTrue);
      expect(result.value, 'ok');
      expect(result.attempts, 1);
      expect(result.lastError, isNull);
      expect(callCount, 1);
      expect(recordedDelays, isEmpty, reason: 'no delay on first success');
    });

    test('succeeds on second attempt after first failure', () async {
      var callCount = 0;

      final result = await retryWithBackoff<String>(
        fn: () async {
          callCount++;
          if (callCount == 1) throw Exception('network down');
          return 'ok';
        },
        maxAttempts: 3,
        delays: [const Duration(seconds: 2), const Duration(seconds: 3)],
        delayFn: fakeDelay,
      );

      expect(result.succeeded, isTrue);
      expect(result.value, 'ok');
      expect(result.attempts, 2);
      expect(callCount, 2);
      expect(recordedDelays, [const Duration(seconds: 2)]);
    });

    test('succeeds on third attempt after two failures', () async {
      var callCount = 0;

      final result = await retryWithBackoff<String>(
        fn: () async {
          callCount++;
          if (callCount <= 2) throw Exception('still down');
          return 'ok';
        },
        maxAttempts: 3,
        delays: [const Duration(seconds: 2), const Duration(seconds: 3)],
        delayFn: fakeDelay,
      );

      expect(result.succeeded, isTrue);
      expect(result.value, 'ok');
      expect(result.attempts, 3);
      expect(callCount, 3);
      expect(recordedDelays, [
        const Duration(seconds: 2),
        const Duration(seconds: 3),
      ]);
    });

    test('fails after all attempts exhausted', () async {
      var callCount = 0;

      final result = await retryWithBackoff<String>(
        fn: () async {
          callCount++;
          throw Exception('attempt $callCount failed');
        },
        maxAttempts: 3,
        delays: [const Duration(seconds: 2), const Duration(seconds: 3)],
        delayFn: fakeDelay,
      );

      expect(result.succeeded, isFalse);
      expect(result.value, isNull);
      expect(result.attempts, 3);
      expect(result.lastError, isA<Exception>());
      expect(result.lastError.toString(), contains('attempt 3 failed'));
      expect(callCount, 3);
      expect(recordedDelays, [
        const Duration(seconds: 2),
        const Duration(seconds: 3),
      ]);
    });

    test('onRetry callback receives attempt number and error', () async {
      final retryLog = <(int, String)>[];

      final result = await retryWithBackoff<String>(
        fn: () async {
          throw Exception('boom');
        },
        maxAttempts: 3,
        delays: [const Duration(seconds: 2), const Duration(seconds: 3)],
        onRetry: (attempt, error) {
          retryLog.add((attempt, error.toString()));
        },
        delayFn: fakeDelay,
      );

      expect(result.succeeded, isFalse);
      expect(retryLog.length, 2, reason: 'onRetry called for attempts 1 and 2, not 3');
      expect(retryLog[0].$1, 1);
      expect(retryLog[1].$1, 2);
      expect(retryLog[0].$2, contains('boom'));
    });

    test('onRetry not called when first attempt succeeds', () async {
      var retryCalled = false;

      await retryWithBackoff<String>(
        fn: () async => 'ok',
        maxAttempts: 3,
        delays: [const Duration(seconds: 2), const Duration(seconds: 3)],
        onRetry: (_, __) => retryCalled = true,
        delayFn: fakeDelay,
      );

      expect(retryCalled, isFalse);
    });

    test('single attempt — no retry on failure', () async {
      final result = await retryWithBackoff<String>(
        fn: () async => throw Exception('single shot'),
        maxAttempts: 1,
        delays: [],
        delayFn: fakeDelay,
      );

      expect(result.succeeded, isFalse);
      expect(result.attempts, 1);
      expect(recordedDelays, isEmpty);
    });

    test('uses increasing delays between attempts', () async {
      final customDelays = [
        const Duration(milliseconds: 100),
        const Duration(milliseconds: 500),
        const Duration(seconds: 1),
      ];

      await retryWithBackoff<String>(
        fn: () async => throw Exception('fail'),
        maxAttempts: 4,
        delays: customDelays,
        delayFn: fakeDelay,
      );

      expect(recordedDelays, customDelays);
    });

    test('returns correct value type', () async {
      final result = await retryWithBackoff<int>(
        fn: () async => 42,
        maxAttempts: 1,
        delays: [],
        delayFn: fakeDelay,
      );

      expect(result.value, 42);
    });
  });
}
