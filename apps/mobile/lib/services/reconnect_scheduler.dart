/// Phase of the reconnection cycle.
enum ReconnectPhase { fast, slow, exhausted }

/// What [ReconnectScheduler.nextAttempt] decided.
class ReconnectAction {
  const ReconnectAction._({
    required this.phase,
    required this.delay,
    required this.attempt,
    required this.elapsed,
  });

  /// Fast retry with exponential backoff.
  const ReconnectAction.fast({required Duration delay, required int attempt})
      : this._(
          phase: ReconnectPhase.fast,
          delay: delay,
          attempt: attempt,
          elapsed: Duration.zero,
        );

  /// Slow poll at fixed interval.
  const ReconnectAction.slow({
    required Duration delay,
    required Duration elapsed,
    required int attempt,
  }) : this._(
          phase: ReconnectPhase.slow,
          delay: delay,
          attempt: attempt,
          elapsed: elapsed,
        );

  /// Give up — budget exhausted.
  const ReconnectAction.giveUp({required Duration elapsed})
      : this._(
          phase: ReconnectPhase.exhausted,
          delay: Duration.zero,
          attempt: 0,
          elapsed: elapsed,
        );

  final ReconnectPhase phase;
  final Duration delay;
  final int attempt;
  final Duration elapsed;
}

/// Pure scheduling logic for two-phase reconnection (BUG-028).
///
/// Phase 1 (fast): exponential backoff (1s, 2s, 4s, 8s, 16s)
/// Phase 2 (slow): fixed interval poll until time budget expires
///
/// This class is stateful: call [begin] when a disconnect is detected,
/// [nextAttempt] for each retry, and [reset] on successful reconnection.
///
/// Inject a [clock] for deterministic testing.
class ReconnectScheduler {
  ReconnectScheduler({
    this.fastRetryCount = 5,
    this.slowPollInterval = const Duration(seconds: 10),
    this.budget = const Duration(seconds: 130),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final int fastRetryCount;
  final Duration slowPollInterval;
  final Duration budget;
  final DateTime Function() _clock;

  DateTime? _startTime;
  int _attempt = 0;

  /// Current attempt number (1-based after first [nextAttempt] call).
  int get attempt => _attempt;

  /// Whether a reconnection cycle is active.
  bool get isActive => _startTime != null;

  /// Time elapsed since [begin] was called.
  Duration get elapsed =>
      _startTime != null ? _clock().difference(_startTime!) : Duration.zero;

  /// Mark the start of a reconnection cycle.
  /// Calling [begin] multiple times does not reset the start time.
  void begin() {
    _startTime ??= _clock();
  }

  /// Compute the next reconnect action.
  ///
  /// Returns [ReconnectPhase.fast] for the first [fastRetryCount] attempts
  /// (exponential backoff: 1s, 2s, 4s, 8s, 16s), then [ReconnectPhase.slow]
  /// (fixed [slowPollInterval]) until [budget] is exceeded, then
  /// [ReconnectPhase.exhausted].
  ReconnectAction nextAttempt() {
    _attempt++;
    final el = elapsed;

    if (el > budget) {
      return ReconnectAction.giveUp(elapsed: el);
    }

    if (_attempt <= fastRetryCount) {
      return ReconnectAction.fast(
        delay: Duration(seconds: 1 << (_attempt - 1)),
        attempt: _attempt,
      );
    } else {
      return ReconnectAction.slow(
        delay: slowPollInterval,
        elapsed: el,
        attempt: _attempt,
      );
    }
  }

  /// Reset all state (on successful reconnection or external trigger).
  void reset() {
    _startTime = null;
    _attempt = 0;
  }
}
