/// Sub-agent visibility data model.
///
/// Mirrors the relay's SubAgentInfo type. Received via the "sub-agents"
/// data channel topic as full snapshots.

enum SubAgentStatus {
  running,
  completed,
  error,
  timeout;

  static SubAgentStatus fromString(String s) {
    switch (s) {
      case 'running':
        return SubAgentStatus.running;
      case 'completed':
        return SubAgentStatus.completed;
      case 'error':
        return SubAgentStatus.error;
      case 'timeout':
        return SubAgentStatus.timeout;
      default:
        return SubAgentStatus.running;
    }
  }
}

class SubAgentInfo {
  final String id;
  final String task;
  final SubAgentStatus status;
  final int startedAt;
  final int lastActivityAt;
  final int? completedAt;
  final int durationMs;
  final String? model;
  final int? tokens;
  final String? lastOutput;

  const SubAgentInfo({
    required this.id,
    required this.task,
    required this.status,
    required this.startedAt,
    required this.lastActivityAt,
    this.completedAt,
    required this.durationMs,
    this.model,
    this.tokens,
    this.lastOutput,
  });

  factory SubAgentInfo.fromJson(Map<String, dynamic> json) {
    return SubAgentInfo(
      id: json['id'] as String? ?? '',
      task: json['task'] as String? ?? '(unknown)',
      status: SubAgentStatus.fromString(json['status'] as String? ?? 'running'),
      startedAt: json['startedAt'] as int? ?? 0,
      lastActivityAt: json['lastActivityAt'] as int? ?? 0,
      completedAt: json['completedAt'] as int?,
      durationMs: json['durationMs'] as int? ?? 0,
      model: json['model'] as String?,
      tokens: json['tokens'] as int?,
      lastOutput: json['lastOutput'] as String?,
    );
  }

  /// Live duration: for running agents, compute from startedAt to now.
  Duration get liveDuration {
    if (status == SubAgentStatus.running) {
      final now = DateTime.now().millisecondsSinceEpoch;
      return Duration(milliseconds: now - startedAt);
    }
    return Duration(milliseconds: durationMs);
  }

  /// Format duration as "Xs" or "Xm Ys".
  String get durationDisplay {
    final d = liveDuration;
    if (d.inMinutes > 0) {
      return '${d.inMinutes}m ${d.inSeconds % 60}s';
    }
    return '${d.inSeconds}s';
  }

  bool get isRunning => status == SubAgentStatus.running;
  bool get isTerminal =>
      status == SubAgentStatus.completed ||
      status == SubAgentStatus.error ||
      status == SubAgentStatus.timeout;
}
