/// Tests for ToolStatus — the shared status model for the StatusBar.
///
/// Covers:
/// - T30.02: ACP tool_call status display (text mode)
/// - Ganglia status mapping (voice mode backward compat)
///
/// [ToolStatus] is populated from two sources:
/// 1. ACP `tool_call` events via [ToolStatus.fromAcp] (text mode)
/// 2. Ganglia `StatusEvent` via [ToolStatus.fromGangliaStatusEvent] (voice mode)

import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/models/conversation_state.dart';

void main() {
  // ---------------------------------------------------------------------------
  // ToolStatus.fromAcp — ACP tool_call events (text mode)
  // ---------------------------------------------------------------------------

  group('ToolStatus.fromAcp', () {
    test('uses title when provided', () {
      final status = ToolStatus.fromAcp(kind: 'read', title: 'Reading src/main.dart');
      expect(status.kind, 'read');
      expect(status.displayText, 'Reading src/main.dart');
    });

    test('falls back to kind-derived label when title is null', () {
      final status = ToolStatus.fromAcp(kind: 'read', title: null);
      expect(status.kind, 'read');
      expect(status.displayText, 'Reading');
    });

    group('kind → fallback label mapping', () {
      test('read → Reading', () {
        expect(ToolStatus.fromAcp(kind: 'read').displayText, 'Reading');
      });

      test('edit → Editing', () {
        expect(ToolStatus.fromAcp(kind: 'edit').displayText, 'Editing');
      });

      test('search → Searching', () {
        expect(ToolStatus.fromAcp(kind: 'search').displayText, 'Searching');
      });

      test('execute → Running', () {
        expect(ToolStatus.fromAcp(kind: 'execute').displayText, 'Running');
      });

      test('think → Thinking', () {
        expect(ToolStatus.fromAcp(kind: 'think').displayText, 'Thinking');
      });

      test('fetch → Fetching', () {
        expect(ToolStatus.fromAcp(kind: 'fetch').displayText, 'Fetching');
      });

      test('delete → Deleting', () {
        expect(ToolStatus.fromAcp(kind: 'delete').displayText, 'Deleting');
      });

      test('move → Moving', () {
        expect(ToolStatus.fromAcp(kind: 'move').displayText, 'Moving');
      });

      test('other → Working (generic fallback)', () {
        expect(ToolStatus.fromAcp(kind: 'other').displayText, 'Working');
      });

      test('unknown future kind → Working (forward compat)', () {
        // ACP may add new kinds in future versions — unknown kinds should not crash.
        expect(ToolStatus.fromAcp(kind: 'future_kind_v3').displayText, 'Working');
      });
    });

    test('title takes precedence over kind-derived label', () {
      // Even for well-known kinds, title should win when provided.
      final status = ToolStatus.fromAcp(
        kind: 'search',
        title: 'Searching for flutter packages in pubspec.yaml',
      );
      expect(status.displayText, 'Searching for flutter packages in pubspec.yaml');
      // Not the fallback 'Searching'
    });

    test('kind is preserved exactly as passed', () {
      // The StatusBar uses kind for icon/color selection — must not be transformed.
      final status = ToolStatus.fromAcp(kind: 'execute', title: 'Running tests');
      expect(status.kind, 'execute');
    });
  });

  // ---------------------------------------------------------------------------
  // ToolStatus.fromGangliaStatusEvent — voice mode backward compat
  // ---------------------------------------------------------------------------

  group('ToolStatus.fromGangliaStatusEvent', () {
    StatusEvent makeEvent(StatusAction action, {String? detail}) {
      return StatusEvent(
        action: action,
        detail: detail,
        startedAt: DateTime(2026, 3, 13),
      );
    }

    test('thinking → kind: think', () {
      final status = ToolStatus.fromGangliaStatusEvent(
        makeEvent(StatusAction.thinking),
      );
      expect(status.kind, 'think');
    });

    test('searchingFiles → kind: search', () {
      final status = ToolStatus.fromGangliaStatusEvent(
        makeEvent(StatusAction.searchingFiles),
      );
      expect(status.kind, 'search');
    });

    test('readingFile → kind: read', () {
      final status = ToolStatus.fromGangliaStatusEvent(
        makeEvent(StatusAction.readingFile),
      );
      expect(status.kind, 'read');
    });

    test('writingFile → kind: edit', () {
      final status = ToolStatus.fromGangliaStatusEvent(
        makeEvent(StatusAction.writingFile),
      );
      expect(status.kind, 'edit');
    });

    test('editingFile → kind: edit', () {
      final status = ToolStatus.fromGangliaStatusEvent(
        makeEvent(StatusAction.editingFile),
      );
      expect(status.kind, 'edit');
    });

    test('webSearch → kind: fetch', () {
      final status = ToolStatus.fromGangliaStatusEvent(
        makeEvent(StatusAction.webSearch),
      );
      expect(status.kind, 'fetch');
    });

    test('executingCommand → kind: execute', () {
      final status = ToolStatus.fromGangliaStatusEvent(
        makeEvent(StatusAction.executingCommand),
      );
      expect(status.kind, 'execute');
    });

    test('analyzing → kind: other', () {
      final status = ToolStatus.fromGangliaStatusEvent(
        makeEvent(StatusAction.analyzing),
      );
      expect(status.kind, 'other');
    });

    test('displayText matches StatusEvent.displayText', () {
      // Ganglia path: StatusEvent.displayText provides the label.
      final event = makeEvent(StatusAction.readingFile, detail: '/app/main.dart');
      final status = ToolStatus.fromGangliaStatusEvent(event);
      expect(status.displayText, event.displayText);
    });

    test('displayText uses Ganglia fallback label when detail is null', () {
      final event = makeEvent(StatusAction.thinking);
      final status = ToolStatus.fromGangliaStatusEvent(event);
      expect(status.displayText, 'Thinking...');
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-clear behavior — ConversationState.clearStatus
  //
  // The actual 5s Timer lives in LiveKitService._sendViaRelay. These tests
  // verify the clearStatus mechanism in ConversationState that the timer uses.
  // ---------------------------------------------------------------------------

  group('auto-clear: clearStatus mechanism', () {
    test('clearStatus: true removes currentStatus when set from ACP tool call', () {
      // Simulate: tool_call starts → status shown → tool_call_update completed → timer fires → status cleared
      final toolStatus = ToolStatus.fromAcp(kind: 'read', title: 'Reading file');
      final activeState = ConversationState().copyWith(currentStatus: toolStatus);
      expect(activeState.currentStatus, isNotNull);

      // Timer fires: clearStatus
      final clearedState = activeState.copyWith(clearStatus: true);
      expect(clearedState.currentStatus, isNull);
    });

    test('clearStatus: true is idempotent when currentStatus is already null', () {
      final state = const ConversationState();
      expect(state.currentStatus, isNull);

      // Should not throw or error
      final cleared = state.copyWith(clearStatus: true);
      expect(cleared.currentStatus, isNull);
    });

    test('completed status in RelayToolCallEvent should trigger auto-clear', () {
      // Document the status values that trigger the 5s timer in livekit_service.
      // Values: 'completed', 'failed', 'error'
      //
      // This test verifies the state transition model: once status clears,
      // currentStatus is null.
      final toolStatus = ToolStatus.fromAcp(kind: 'execute', title: 'Running tests');
      final stateBeforeCompletion = ConversationState().copyWith(currentStatus: toolStatus);

      // After 5s timer fires on 'completed':
      final stateAfterClear = stateBeforeCompletion.copyWith(clearStatus: true);
      expect(stateAfterClear.currentStatus, isNull);
    });

    test('new tool call replaces existing status without waiting for clear', () {
      // When multiple sequential tool calls arrive, each new tool_call
      // should replace the current status immediately (no stale status from
      // a previous tool call).
      final firstStatus = ToolStatus.fromAcp(kind: 'read', title: 'Reading file A');
      final secondStatus = ToolStatus.fromAcp(kind: 'edit', title: 'Editing file B');

      final state = ConversationState()
          .copyWith(currentStatus: firstStatus)
          .copyWith(currentStatus: secondStatus);

      expect(state.currentStatus!.kind, 'edit');
      expect(state.currentStatus!.displayText, 'Editing file B');
    });
  });

  // ---------------------------------------------------------------------------
  // ToolStatus equality and identity
  // ---------------------------------------------------------------------------

  group('ToolStatus equality', () {
    test('same kind and displayText are equal', () {
      const a = ToolStatus(kind: 'read', displayText: 'Reading main.dart');
      const b = ToolStatus(kind: 'read', displayText: 'Reading main.dart');
      expect(a, equals(b));
    });

    test('different kind is not equal', () {
      const a = ToolStatus(kind: 'read', displayText: 'Reading');
      const b = ToolStatus(kind: 'edit', displayText: 'Reading');
      expect(a, isNot(equals(b)));
    });

    test('different displayText is not equal', () {
      const a = ToolStatus(kind: 'read', displayText: 'Reading main.dart');
      const b = ToolStatus(kind: 'read', displayText: 'Reading other.dart');
      expect(a, isNot(equals(b)));
    });

    test('hashCode is consistent with equality', () {
      const a = ToolStatus(kind: 'search', displayText: 'Searching');
      const b = ToolStatus(kind: 'search', displayText: 'Searching');
      expect(a.hashCode, b.hashCode);
    });
  });

  // ---------------------------------------------------------------------------
  // ConversationState.currentStatus — ToolStatus integration
  // ---------------------------------------------------------------------------

  group('ConversationState.currentStatus', () {
    test('defaults to null', () {
      const state = ConversationState();
      expect(state.currentStatus, isNull);
    });

    test('can be set to a ToolStatus', () {
      const status = ToolStatus(kind: 'read', displayText: 'Reading file');
      final state = ConversationState().copyWith(currentStatus: status);
      expect(state.currentStatus, equals(status));
      expect(state.currentStatus!.kind, 'read');
      expect(state.currentStatus!.displayText, 'Reading file');
    });

    test('clearStatus: true sets currentStatus to null', () {
      const status = ToolStatus(kind: 'think', displayText: 'Thinking...');
      final state = ConversationState().copyWith(currentStatus: status);
      expect(state.currentStatus, isNotNull);

      final cleared = state.copyWith(clearStatus: true);
      expect(cleared.currentStatus, isNull);
    });

    test('copyWith without currentStatus preserves existing value', () {
      const status = ToolStatus(kind: 'execute', displayText: 'Running tests');
      final state = ConversationState().copyWith(currentStatus: status);

      // Update an unrelated field
      final updated = state.copyWith(isAgentThinking: true);
      expect(updated.currentStatus, equals(status));
    });

    test('ACP tool_call status round-trips through ConversationState', () {
      // Simulate the text mode flow: tool_call event → ToolStatus → state update
      final toolStatus = ToolStatus.fromAcp(
        kind: 'read',
        title: 'Reading configuration file',
      );
      final state = ConversationState().copyWith(currentStatus: toolStatus);

      expect(state.currentStatus!.kind, 'read');
      expect(state.currentStatus!.displayText, 'Reading configuration file');
    });

    test('Ganglia status round-trips through ConversationState', () {
      // Simulate the voice mode flow: StatusEvent → ToolStatus → state update
      final event = StatusEvent(
        action: StatusAction.executingCommand,
        detail: 'flutter test',
        startedAt: DateTime(2026, 3, 13),
      );
      final toolStatus = ToolStatus.fromGangliaStatusEvent(event);
      final state = ConversationState().copyWith(currentStatus: toolStatus);

      expect(state.currentStatus!.kind, 'execute');
      // displayText comes from Ganglia's StatusEvent.displayText
      expect(state.currentStatus!.displayText, contains('Running'));
    });
  });
}
