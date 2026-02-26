enum HealthCheckStatus { ok, warning, error, pending }

class HealthCheck {
  final String id;
  final String label;
  final HealthCheckStatus status;
  final String? detail;
  final String? suggestion;

  const HealthCheck({
    required this.id,
    required this.label,
    this.status = HealthCheckStatus.pending,
    this.detail,
    this.suggestion,
  });

  HealthCheck copyWith({
    HealthCheckStatus? status,
    String? detail,
    String? suggestion,
  }) {
    return HealthCheck(
      id: id,
      label: label,
      status: status ?? this.status,
      detail: detail ?? this.detail,
      suggestion: suggestion ?? this.suggestion,
    );
  }
}

enum OverallHealth { healthy, degraded, unhealthy }

class HealthState {
  final List<HealthCheck> checks;

  const HealthState({this.checks = const []});

  OverallHealth get overall {
    if (checks.isEmpty) return OverallHealth.healthy;
    if (checks.any((c) => c.status == HealthCheckStatus.error)) {
      return OverallHealth.unhealthy;
    }
    if (checks.any(
        (c) => c.status == HealthCheckStatus.warning || c.status == HealthCheckStatus.pending)) {
      return OverallHealth.degraded;
    }
    return OverallHealth.healthy;
  }
}
