# TASK-089: Flutter SubAgentService + Data Model

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** —
**Blocked By:** —

## Description

Create the Flutter-side data model (`SubAgentInfo`, `SubAgentStatus`) and `SubAgentService` (ChangeNotifier) that processes sub-agent snapshots from the data channel. Wire the service into `LiveKitService`'s data received handler.

This task is independent of the relay-side tasks and can be developed in parallel with 085-088.

## Files

### Create

- `apps/mobile/lib/models/sub_agent_info.dart` — `SubAgentInfo` model + `SubAgentStatus` enum
- `apps/mobile/lib/services/sub_agent_service.dart` — `SubAgentService` ChangeNotifier
- `apps/mobile/test/models/sub_agent_info_test.dart` — Model unit tests
- `apps/mobile/test/services/sub_agent_service_test.dart` — Service unit tests

### Modify

- `apps/mobile/lib/services/livekit_service.dart` — Add `"sub-agents"` topic routing in `_handleDataReceived()`, create and expose `SubAgentService` instance

## Implementation Notes

### SubAgentInfo model (`sub_agent_info.dart`)

```dart
enum SubAgentStatus { running, completed, errored, unknown }

class SubAgentInfo {
  final String id;
  final String task;
  final SubAgentStatus status;
  final DateTime startedAt;
  final DateTime lastActivityAt;
  final DateTime? completedAt;
  final Duration duration;
  final String? model;
  final String? lastOutput;

  const SubAgentInfo({
    required this.id,
    required this.task,
    required this.status,
    required this.startedAt,
    required this.lastActivityAt,
    this.completedAt,
    required this.duration,
    this.model,
    this.lastOutput,
  });

  factory SubAgentInfo.fromJson(Map<String, dynamic> json) {
    // Parse status string to enum with fallback to unknown
    // Parse epoch ms to DateTime
    // Parse durationMs to Duration
    // Null-safe handling for optional fields
  }
}
```

Follow the pattern from `StatusEvent.fromJson()` and `ArtifactEvent.fromJson()` in `conversation_state.dart`.

### SubAgentService (`sub_agent_service.dart`)

```dart
class SubAgentService extends ChangeNotifier {
  List<SubAgentInfo> _agents = [];

  List<SubAgentInfo> get agents => _agents;
  int get activeCount => _agents.where((a) => a.status == SubAgentStatus.running).length;
  bool get hasAgents => _agents.isNotEmpty;
  SubAgentStatus get overallStatus { ... }

  void handleSnapshot(Map<String, dynamic> json) {
    // Parse agents array
    // Replace entire agent list (full snapshot semantics)
    // notifyListeners()
  }
}
```

`overallStatus` logic:
- If any agent is `running` → `running`
- If any agent is `errored` → `errored`
- If all agents are `completed` → `completed`
- If no agents → `unknown`

### LiveKitService integration

In `_handleDataReceived()` (around line 943), add a new topic branch BEFORE the existing `"relay"` check:

```dart
void _handleDataReceived(DataReceivedEvent event) {
  if (event.topic == 'sub-agents') {
    try {
      final json = jsonDecode(utf8.decode(event.data)) as Map<String, dynamic>;
      _subAgentService.handleSnapshot(json);
    } catch (e) {
      // Log warning, don't crash
    }
    return;
  }

  if (event.topic == 'relay') { ... }  // existing
  if (event.topic != 'ganglia-events') return;  // existing
  ...
}
```

Create `SubAgentService` as a field on `LiveKitService`, similar to how `RelayChatService` is managed. Expose it via a getter so `ConversationScreen` can listen to it.

### Completed agent rolloff (client-side)

Agents with `status: completed` or `status: errored` should be hidden from the UI 60 seconds after `completedAt`. This is client-side filtering in the service or widgets (TASK-090 may handle the UI side). The service should provide a `visibleAgents` getter that filters out rolled-off agents.

## Tests

### Model tests (`test/models/sub_agent_info_test.dart`)

1. `fromJson()` parses a complete, valid snapshot agent
2. `fromJson()` handles missing optional fields (model, lastOutput, completedAt)
3. `fromJson()` falls back to `unknown` for unrecognized status strings
4. `fromJson()` converts epoch ms to DateTime correctly
5. `fromJson()` converts durationMs to Duration correctly

### Service tests (`test/services/sub_agent_service_test.dart`)

1. `handleSnapshot()` populates agents list
2. `handleSnapshot()` replaces entire list on each call (full snapshot)
3. `handleSnapshot()` calls notifyListeners
4. `activeCount` returns count of running agents only
5. `hasAgents` returns true when agents present, false when empty
6. `overallStatus` returns running when any agent is running
7. `overallStatus` returns errored when any agent errored (none running)
8. `overallStatus` returns completed when all agents completed
9. `overallStatus` returns unknown when no agents
10. `handleSnapshot()` with empty agents array clears state
11. `handleSnapshot()` with malformed JSON does not crash (try/catch)
12. `visibleAgents` filters out completed agents older than 60s

## Acceptance Criteria

- [ ] `SubAgentInfo` model with `fromJson()` factory, handles all fields including optionals
- [ ] `SubAgentStatus` enum with 4 values
- [ ] `SubAgentService` processes snapshots and exposes `agents`, `activeCount`, `hasAgents`, `overallStatus`
- [ ] `LiveKitService._handleDataReceived()` routes `"sub-agents"` topic to `SubAgentService`
- [ ] `SubAgentService` exposed via getter on `LiveKitService`
- [ ] Malformed snapshots handled gracefully (logged, not crashed)
- [ ] All model and service tests pass
