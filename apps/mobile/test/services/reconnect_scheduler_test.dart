import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/reconnect_scheduler.dart';

void main() {
  group('initial state', () {
    test('starts inactive with zero attempts', () {
      final s = ReconnectScheduler();
      expect(s.isActive, isFalse);
      expect(s.attempt, 0);
      expect(s.elapsed, Duration.zero);
    });
  });

  group('begin', () {
    test('activates the scheduler', () {
      final s = ReconnectScheduler();
      s.begin();
      expect(s.isActive, isTrue);
    });

    test('calling begin twice does not reset start time', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(clock: () => now);

      s.begin();
      now = DateTime(2026, 3, 4, 12, 0, 30);
      s.begin(); // should NOT reset

      expect(s.elapsed, const Duration(seconds: 30));
    });
  });

  group('reset', () {
    test('clears all state', () {
      final s = ReconnectScheduler();
      s.begin();
      s.nextAttempt();
      s.nextAttempt();
      s.reset();

      expect(s.isActive, isFalse);
      expect(s.attempt, 0);
      expect(s.elapsed, Duration.zero);
    });

    test('after reset, begin starts a fresh cycle', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(clock: () => now);

      s.begin();
      now = DateTime(2026, 3, 4, 12, 1, 0);
      s.reset();

      now = DateTime(2026, 3, 4, 12, 2, 0);
      s.begin();
      now = DateTime(2026, 3, 4, 12, 2, 5);

      expect(s.elapsed, const Duration(seconds: 5));
    });
  });

  group('fast phase', () {
    test('first 5 attempts use exponential backoff', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(clock: () => now);
      s.begin();

      final expectedDelays = [1, 2, 4, 8, 16];
      for (var i = 0; i < 5; i++) {
        final action = s.nextAttempt();
        expect(action.phase, ReconnectPhase.fast, reason: 'attempt ${i + 1}');
        expect(action.delay, Duration(seconds: expectedDelays[i]),
            reason: 'attempt ${i + 1} delay');
        expect(action.attempt, i + 1);
      }
    });

    test('attempt counter increments correctly', () {
      final s = ReconnectScheduler();
      s.begin();

      for (var i = 1; i <= 5; i++) {
        final action = s.nextAttempt();
        expect(action.attempt, i);
        expect(s.attempt, i);
      }
    });
  });

  group('slow phase', () {
    test('attempt 6+ uses fixed slow poll interval', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(clock: () => now);
      s.begin();

      // Exhaust fast phase
      for (var i = 0; i < 5; i++) {
        s.nextAttempt();
      }

      // Attempt 6 should be slow
      final action = s.nextAttempt();
      expect(action.phase, ReconnectPhase.slow);
      expect(action.delay, const Duration(seconds: 10));
      expect(action.attempt, 6);
    });

    test('slow phase reports elapsed time', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(clock: () => now);
      s.begin();

      // Exhaust fast phase
      for (var i = 0; i < 5; i++) {
        s.nextAttempt();
      }

      // Advance clock to simulate elapsed time
      now = DateTime(2026, 3, 4, 12, 1, 15); // 75s elapsed
      final action = s.nextAttempt();
      expect(action.phase, ReconnectPhase.slow);
      expect(action.elapsed, const Duration(seconds: 75));
    });

    test('multiple slow polls continue at fixed interval', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(clock: () => now);
      s.begin();

      // Exhaust fast phase
      for (var i = 0; i < 5; i++) {
        s.nextAttempt();
      }

      // Several slow polls
      for (var i = 0; i < 5; i++) {
        now = now.add(const Duration(seconds: 10));
        final action = s.nextAttempt();
        expect(action.phase, ReconnectPhase.slow);
        expect(action.delay, const Duration(seconds: 10));
      }
    });
  });

  group('budget exhaustion', () {
    test('returns exhausted after budget expires', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(
        budget: const Duration(seconds: 130),
        clock: () => now,
      );
      s.begin();

      // Advance past budget
      now = DateTime(2026, 3, 4, 12, 2, 11); // 131s elapsed
      final action = s.nextAttempt();
      expect(action.phase, ReconnectPhase.exhausted);
      expect(action.elapsed.inSeconds, 131);
    });

    test('returns slow at exactly budget boundary', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(
        budget: const Duration(seconds: 130),
        clock: () => now,
      );
      s.begin();

      // Exhaust fast phase first
      for (var i = 0; i < 5; i++) {
        s.nextAttempt();
      }

      // Exactly at budget boundary — should still allow
      now = DateTime(2026, 3, 4, 12, 2, 10); // 130s elapsed
      final action = s.nextAttempt();
      expect(action.phase, ReconnectPhase.slow);
    });

    test('fast phase can exhaust budget if clock advances enough', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(
        budget: const Duration(seconds: 10),
        clock: () => now,
      );
      s.begin();

      // Even on attempt 1, if budget is exceeded, give up
      now = now.add(const Duration(seconds: 11));
      final action = s.nextAttempt();
      expect(action.phase, ReconnectPhase.exhausted);
    });
  });

  group('phase transition', () {
    test('transitions from fast to slow at attempt boundary', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(clock: () => now);
      s.begin();

      // Last fast attempt
      for (var i = 0; i < 4; i++) {
        s.nextAttempt();
      }
      final lastFast = s.nextAttempt();
      expect(lastFast.phase, ReconnectPhase.fast);
      expect(lastFast.attempt, 5);
      expect(lastFast.delay, const Duration(seconds: 16));

      // First slow attempt
      final firstSlow = s.nextAttempt();
      expect(firstSlow.phase, ReconnectPhase.slow);
      expect(firstSlow.attempt, 6);
      expect(firstSlow.delay, const Duration(seconds: 10));
    });

    test('full lifecycle: fast → slow → exhausted', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(
        budget: const Duration(seconds: 50),
        clock: () => now,
      );
      s.begin();

      // Fast phase
      for (var i = 0; i < 5; i++) {
        final a = s.nextAttempt();
        expect(a.phase, ReconnectPhase.fast);
      }

      // Slow phase — within budget
      now = now.add(const Duration(seconds: 40));
      final slow = s.nextAttempt();
      expect(slow.phase, ReconnectPhase.slow);

      // Exhausted — past budget
      now = now.add(const Duration(seconds: 15));
      final exhausted = s.nextAttempt();
      expect(exhausted.phase, ReconnectPhase.exhausted);
    });
  });

  group('custom parameters', () {
    test('custom fastRetryCount changes phase boundary', () {
      final s = ReconnectScheduler(fastRetryCount: 3);
      s.begin();

      for (var i = 0; i < 3; i++) {
        expect(s.nextAttempt().phase, ReconnectPhase.fast);
      }
      expect(s.nextAttempt().phase, ReconnectPhase.slow);
    });

    test('custom slowPollInterval used in slow phase', () {
      final s = ReconnectScheduler(
        slowPollInterval: const Duration(seconds: 5),
      );
      s.begin();

      // Exhaust fast phase
      for (var i = 0; i < 5; i++) {
        s.nextAttempt();
      }

      final action = s.nextAttempt();
      expect(action.delay, const Duration(seconds: 5));
    });

    test('custom budget changes exhaustion point', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(
        budget: const Duration(seconds: 30),
        clock: () => now,
      );
      s.begin();

      now = now.add(const Duration(seconds: 31));
      expect(s.nextAttempt().phase, ReconnectPhase.exhausted);
    });
  });

  group('elapsed tracking', () {
    test('elapsed is zero before begin', () {
      final s = ReconnectScheduler();
      expect(s.elapsed, Duration.zero);
    });

    test('elapsed tracks time since begin', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(clock: () => now);
      s.begin();

      now = now.add(const Duration(seconds: 45));
      expect(s.elapsed, const Duration(seconds: 45));
    });

    test('elapsed is zero after reset', () {
      var now = DateTime(2026, 3, 4, 12, 0, 0);
      final s = ReconnectScheduler(clock: () => now);
      s.begin();

      now = now.add(const Duration(seconds: 45));
      s.reset();
      expect(s.elapsed, Duration.zero);
    });
  });

  group('default parameters match server config', () {
    test('budget is 130s (departure_timeout 120s + 10s margin)', () {
      final s = ReconnectScheduler();
      expect(s.budget, const Duration(seconds: 130));
    });

    test('fast retry count is 5', () {
      final s = ReconnectScheduler();
      expect(s.fastRetryCount, 5);
    });

    test('slow poll interval is 10s', () {
      final s = ReconnectScheduler();
      expect(s.slowPollInterval, const Duration(seconds: 10));
    });

    test('total fast retry delay is 31s', () {
      // 1 + 2 + 4 + 8 + 16 = 31s
      final s = ReconnectScheduler();
      s.begin();

      var totalDelay = Duration.zero;
      for (var i = 0; i < 5; i++) {
        totalDelay += s.nextAttempt().delay;
      }
      expect(totalDelay, const Duration(seconds: 31));
    });
  });
}
