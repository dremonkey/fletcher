import 'dart:async';
import 'package:flutter/foundation.dart';

/// Result of a retry-with-backoff operation.
class RetryResult<T> {
  /// The successful return value (null if all attempts failed).
  final T? value;

  /// The number of attempts made (1-based).
  final int attempts;

  /// The last error if all attempts failed.
  final Object? lastError;

  /// Whether the operation succeeded.
  bool get succeeded => lastError == null;

  const RetryResult._({this.value, required this.attempts, this.lastError});
}

/// Execute [fn] up to [maxAttempts] times, sleeping [delays[i]] between
/// attempt i and i+1. Returns a [RetryResult] with the outcome.
///
/// The [delays] list must have at least [maxAttempts] - 1 entries.
/// If [onRetry] is provided, it's called before each retry delay with the
/// attempt number (1-based) and the error from the failed attempt.
///
/// Example:
/// ```dart
/// final result = await retryWithBackoff(
///   fn: () => fetchToken(...),
///   maxAttempts: 3,
///   delays: [Duration(seconds: 2), Duration(seconds: 3)],
/// );
/// if (result.succeeded) {
///   print('Got token after ${result.attempts} attempt(s)');
/// }
/// ```
Future<RetryResult<T>> retryWithBackoff<T>({
  required Future<T> Function() fn,
  required int maxAttempts,
  required List<Duration> delays,
  void Function(int attempt, Object error)? onRetry,
  @visibleForTesting Future<void> Function(Duration)? delayFn,
}) async {
  assert(
    delays.length >= maxAttempts - 1,
    'delays must have at least maxAttempts - 1 entries',
  );

  final effectiveDelay = delayFn ?? (d) => Future.delayed(d);
  Object? lastError;

  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      final value = await fn();
      return RetryResult<T>._(value: value, attempts: attempt);
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts) {
        onRetry?.call(attempt, e);
        await effectiveDelay(delays[attempt - 1]);
      }
    }
  }

  return RetryResult<T>._(attempts: maxAttempts, lastError: lastError);
}
