import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/sub_agent_service.dart';
import 'package:fletcher/models/sub_agent_info.dart';

void main() {
  late SubAgentService service;
  int notifyCount = 0;

  setUp(() {
    service = SubAgentService();
    notifyCount = 0;
    service.addListener(() => notifyCount++);
  });

  tearDown(() {
    service.dispose();
  });

  List<int> encodeSnapshot(List<Map<String, dynamic>> agents) {
    return utf8.encode(jsonEncode({
      'type': 'sub_agent_snapshot',
      'agents': agents,
    }));
  }

  test('starts with empty state', () {
    expect(service.agents, isEmpty);
    expect(service.runningCount, 0);
    expect(service.hasAgents, false);
    expect(service.hasRunning, false);
  });

  test('parses a sub_agent_snapshot message', () {
    service.handleMessage(encodeSnapshot([
      {
        'id': 'abc123',
        'task': 'Fix the bug',
        'status': 'running',
        'startedAt': 1710600000000,
        'lastActivityAt': 1710600045000,
        'completedAt': null,
        'durationMs': 45000,
        'model': 'claude-sonnet-4-6',
      },
    ]));

    expect(service.agents.length, 1);
    expect(service.agents[0].id, 'abc123');
    expect(service.agents[0].task, 'Fix the bug');
    expect(service.agents[0].status, SubAgentStatus.running);
    expect(service.agents[0].model, 'claude-sonnet-4-6');
    expect(service.runningCount, 1);
    expect(service.hasAgents, true);
    expect(service.hasRunning, true);
    expect(notifyCount, 1);
  });

  test('replaces entire agent list on each snapshot', () {
    service.handleMessage(encodeSnapshot([
      {
        'id': 'a1',
        'task': 'Task A',
        'status': 'running',
        'startedAt': 1710600000000,
        'lastActivityAt': 1710600000000,
        'durationMs': 0,
      },
    ]));

    service.handleMessage(encodeSnapshot([
      {
        'id': 'a1',
        'task': 'Task A',
        'status': 'completed',
        'startedAt': 1710600000000,
        'lastActivityAt': 1710600010000,
        'completedAt': 1710600010000,
        'durationMs': 10000,
      },
      {
        'id': 'a2',
        'task': 'Task B',
        'status': 'running',
        'startedAt': 1710600005000,
        'lastActivityAt': 1710600010000,
        'durationMs': 5000,
      },
    ]));

    expect(service.agents.length, 2);
    expect(service.agents[0].status, SubAgentStatus.completed);
    expect(service.agents[1].id, 'a2');
    expect(service.runningCount, 1);
    expect(notifyCount, 2);
  });

  test('ignores non-snapshot messages', () {
    service.handleMessage(utf8.encode(jsonEncode({
      'type': 'something_else',
      'data': 'irrelevant',
    })));

    expect(service.agents, isEmpty);
    expect(notifyCount, 0);
  });

  test('ignores malformed data', () {
    service.handleMessage(utf8.encode('not json'));
    expect(service.agents, isEmpty);
    expect(notifyCount, 0);
  });

  test('clear() resets agents and notifies', () {
    service.handleMessage(encodeSnapshot([
      {
        'id': 'a1',
        'task': 'Task',
        'status': 'running',
        'startedAt': 0,
        'lastActivityAt': 0,
        'durationMs': 0,
      },
    ]));
    expect(notifyCount, 1);

    service.clear();
    expect(service.agents, isEmpty);
    expect(notifyCount, 2);
  });

  test('clear() on empty list does not notify', () {
    service.clear();
    expect(notifyCount, 0);
  });
}
