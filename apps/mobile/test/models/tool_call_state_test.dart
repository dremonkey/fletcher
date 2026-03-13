/// Tests for ToolCallInfo model and ConversationState.activeToolCalls.
///
/// Covers Task 038: Verbose ACP Tool Feedback.
/// Verifies that tool call state is correctly added, updated, and preserved
/// through ConversationState.copyWith.

import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/models/conversation_state.dart';

void main() {
  group('ToolCallInfo', () {
    test('constructs with required fields', () {
      final now = DateTime(2026, 3, 13, 12, 0, 0);
      final tc = ToolCallInfo(id: 'tc_1', name: 'memory_search', startedAt: now);
      expect(tc.id, 'tc_1');
      expect(tc.name, 'memory_search');
      expect(tc.startedAt, now);
      expect(tc.status, isNull);
      expect(tc.duration, isNull);
    });

    test('copyWith updates status and duration', () {
      final start = DateTime(2026, 3, 13, 12, 0, 0);
      final tc = ToolCallInfo(id: 'tc_1', name: 'read_file', startedAt: start);

      final updated = tc.copyWith(
        status: 'completed',
        duration: const Duration(milliseconds: 1234),
      );

      expect(updated.id, 'tc_1');
      expect(updated.name, 'read_file');
      expect(updated.startedAt, start);
      expect(updated.status, 'completed');
      expect(updated.duration, const Duration(milliseconds: 1234));
    });

    test('copyWith without arguments preserves all fields', () {
      final start = DateTime(2026, 3, 13, 12, 0, 0);
      final tc = ToolCallInfo(
        id: 'tc_2',
        name: 'web_search',
        startedAt: start,
        status: 'error',
        duration: const Duration(milliseconds: 400),
      );

      final copy = tc.copyWith();
      expect(copy.id, tc.id);
      expect(copy.name, tc.name);
      expect(copy.startedAt, tc.startedAt);
      expect(copy.status, tc.status);
      expect(copy.duration, tc.duration);
    });

    test('copyWith does not mutate original', () {
      final start = DateTime(2026, 3, 13, 12, 0, 0);
      final tc = ToolCallInfo(id: 'tc_3', name: 'list_files', startedAt: start);

      tc.copyWith(status: 'completed', duration: const Duration(seconds: 2));

      // Original is unchanged
      expect(tc.status, isNull);
      expect(tc.duration, isNull);
    });
  });

  group('ConversationState.activeToolCalls', () {
    test('defaults to empty list', () {
      const state = ConversationState();
      expect(state.activeToolCalls, isEmpty);
    });

    test('adding a tool call to activeToolCalls', () {
      const state = ConversationState();
      final now = DateTime(2026, 3, 13, 12, 0, 0);
      final toolCall = ToolCallInfo(
        id: 'tc_1',
        name: 'memory_search',
        startedAt: now,
      );

      final updated = state.copyWith(
        activeToolCalls: [...state.activeToolCalls, toolCall],
      );

      expect(updated.activeToolCalls.length, 1);
      expect(updated.activeToolCalls.first.id, 'tc_1');
      expect(updated.activeToolCalls.first.name, 'memory_search');
      expect(updated.activeToolCalls.first.status, isNull);
    });

    test('updating tool call status from null to "completed"', () {
      final start = DateTime(2026, 3, 13, 12, 0, 0);
      final toolCall = ToolCallInfo(id: 'tc_1', name: 'search', startedAt: start);
      final state = ConversationState(activeToolCalls: [toolCall]);

      // Simulate the update: map over list and replace matching entry
      final updatedList = state.activeToolCalls.map((tc) {
        if (tc.id != 'tc_1') return tc;
        return tc.copyWith(
          status: 'completed',
          duration: const Duration(milliseconds: 800),
        );
      }).toList();

      final updated = state.copyWith(activeToolCalls: updatedList);

      expect(updated.activeToolCalls.length, 1);
      expect(updated.activeToolCalls.first.status, 'completed');
      expect(updated.activeToolCalls.first.duration, const Duration(milliseconds: 800));
    });

    test('duration calculation on completion reflects elapsed time', () {
      final start = DateTime(2026, 3, 13, 12, 0, 0);
      final end = DateTime(2026, 3, 13, 12, 0, 2, 500); // 2.5s later
      final toolCall = ToolCallInfo(id: 'tc_2', name: 'read_file', startedAt: start);

      final duration = end.difference(toolCall.startedAt);
      final completed = toolCall.copyWith(status: 'completed', duration: duration);

      expect(completed.duration!.inMilliseconds, 2500);
      expect(completed.status, 'completed');
    });

    test('multiple tool calls can coexist in activeToolCalls', () {
      final now = DateTime(2026, 3, 13, 12, 0, 0);
      final tc1 = ToolCallInfo(id: 'tc_1', name: 'search', startedAt: now);
      final tc2 = ToolCallInfo(id: 'tc_2', name: 'read_file', startedAt: now);

      final state = ConversationState(activeToolCalls: [tc1, tc2]);
      expect(state.activeToolCalls.length, 2);
      expect(state.activeToolCalls[0].id, 'tc_1');
      expect(state.activeToolCalls[1].id, 'tc_2');
    });

    test('copyWith without activeToolCalls preserves existing list', () {
      final now = DateTime(2026, 3, 13, 12, 0, 0);
      final toolCall = ToolCallInfo(id: 'tc_1', name: 'search', startedAt: now);
      final state = ConversationState(activeToolCalls: [toolCall]);

      // copyWith on an unrelated field
      final updated = state.copyWith(isAgentThinking: true);
      expect(updated.activeToolCalls.length, 1);
      expect(updated.activeToolCalls.first.id, 'tc_1');
    });

    test('copyWith with empty list clears activeToolCalls', () {
      final now = DateTime(2026, 3, 13, 12, 0, 0);
      final toolCall = ToolCallInfo(id: 'tc_1', name: 'search', startedAt: now);
      final state = ConversationState(activeToolCalls: [toolCall]);

      final cleared = state.copyWith(activeToolCalls: []);
      expect(cleared.activeToolCalls, isEmpty);
    });

    test('only matching id is updated when completing a tool call', () {
      final start = DateTime(2026, 3, 13, 12, 0, 0);
      final tc1 = ToolCallInfo(id: 'tc_1', name: 'search', startedAt: start);
      final tc2 = ToolCallInfo(id: 'tc_2', name: 'read_file', startedAt: start);
      final state = ConversationState(activeToolCalls: [tc1, tc2]);

      // Only update tc_1
      final updatedList = state.activeToolCalls.map((tc) {
        if (tc.id != 'tc_1') return tc;
        return tc.copyWith(status: 'completed', duration: const Duration(seconds: 1));
      }).toList();

      final updated = state.copyWith(activeToolCalls: updatedList);
      expect(updated.activeToolCalls[0].status, 'completed');
      expect(updated.activeToolCalls[1].status, isNull); // tc_2 unchanged
    });
  });
}
