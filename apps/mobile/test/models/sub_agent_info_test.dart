import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/models/sub_agent_info.dart';

void main() {
  test('SubAgentStatus.fromString parses known statuses', () {
    expect(SubAgentStatus.fromString('running'), SubAgentStatus.running);
    expect(SubAgentStatus.fromString('completed'), SubAgentStatus.completed);
    expect(SubAgentStatus.fromString('error'), SubAgentStatus.error);
    expect(SubAgentStatus.fromString('timeout'), SubAgentStatus.timeout);
  });

  test('SubAgentStatus.fromString defaults to running for unknown', () {
    expect(SubAgentStatus.fromString('unknown'), SubAgentStatus.running);
    expect(SubAgentStatus.fromString(''), SubAgentStatus.running);
  });

  test('SubAgentInfo.fromJson parses correctly', () {
    final info = SubAgentInfo.fromJson({
      'id': 'abc',
      'task': 'Fix bug',
      'status': 'completed',
      'startedAt': 1000,
      'lastActivityAt': 2000,
      'completedAt': 2000,
      'durationMs': 1000,
      'model': 'claude-sonnet-4-6',
      'tokens': 500,
      'lastOutput': 'Done.',
    });

    expect(info.id, 'abc');
    expect(info.task, 'Fix bug');
    expect(info.status, SubAgentStatus.completed);
    expect(info.startedAt, 1000);
    expect(info.completedAt, 2000);
    expect(info.durationMs, 1000);
    expect(info.model, 'claude-sonnet-4-6');
    expect(info.tokens, 500);
    expect(info.lastOutput, 'Done.');
    expect(info.isRunning, false);
    expect(info.isTerminal, true);
  });

  test('SubAgentInfo.fromJson handles missing fields', () {
    final info = SubAgentInfo.fromJson({});
    expect(info.id, '');
    expect(info.task, '(unknown)');
    expect(info.status, SubAgentStatus.running);
    expect(info.model, isNull);
    expect(info.tokens, isNull);
  });

  test('durationDisplay formats correctly', () {
    final short = SubAgentInfo(
      id: '1',
      task: 'test',
      status: SubAgentStatus.completed,
      startedAt: 0,
      lastActivityAt: 0,
      durationMs: 5000,
    );
    expect(short.durationDisplay, '5s');

    final long = SubAgentInfo(
      id: '2',
      task: 'test',
      status: SubAgentStatus.completed,
      startedAt: 0,
      lastActivityAt: 0,
      durationMs: 125000,
    );
    expect(long.durationDisplay, '2m 5s');
  });
}
