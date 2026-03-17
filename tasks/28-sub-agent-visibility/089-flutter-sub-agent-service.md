# TASK-089: Flutter SubAgentService and Data Model

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** None (client-side track, parallelizable with server tasks)
**Blocked By:** None

## Description

Create the Flutter-side data model (`SubAgentInfo`, `SubAgentStatus`) and `SubAgentService` (`ChangeNotifier`) that processes `sub_agent_snapshot` messages from the data channel. Wire the service into `LiveKitService`'s data handler so that snapshots arriving on the `"sub-agents"` topic are parsed and made available to widgets.

## Files

### Create

- `apps/mobile/lib/models/sub_agent_info.dart` — `SubAgentStatus` enum and `SubAgentInfo` model class with `fromJson()` factory.

- `apps/mobile/lib/services/sub_agent_service.dart` — `SubAgentService` extending `ChangeNotifier`. Exposes `agents`, `activeCount`, `hasAgents`, `overallStatus`.

- `apps/mobile/test/models/sub_agent_info_test.dart` — Unit tests for `SubAgentInfo.fromJson()`.

- `apps/mobile/test/services/sub_agent_service_test.dart` — Unit tests for `SubAgentService`.

### Modify

- `apps/mobile/lib/services/livekit_service.dart` — Add `SubAgentService` instance. Route `"sub-agents"` topic in `_handleDataReceived()`. Expose service to widgets.

## Implementation Notes

### SubAgentStatus Enum (`sub_agent_info.dart`)

```dart
enum SubAgentStatus { running, completed, errored, unknown }
```

Follow the same parsing pattern as `StatusAction._parseStatusAction()` in `apps/mobile/lib/models/conversation_state.dart` (lines 64-85) -- use a switch on the string value with a default fallback.

### SubAgentInfo Model (`sub_agent_info.dart`)

```dart
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
    return SubAgentInfo(
      id: json['id'] as String,
      task: json['task'] as String? ?? 'Unknown task',
      status: _parseStatus(json['status'] as String? ?? 'unknown'),
      startedAt: DateTime.fromMillisecondsSinceEpoch(json['startedAt'] as int),
      lastActivityAt: DateTime.fromMillisecondsSinceEpoch(json['lastActivityAt'] as int),
      completedAt: json['completedAt'] != null
          ? DateTime.fromMillisecondsSinceEpoch(json['completedAt'] as int)
          : null,
      duration: Duration(milliseconds: json['durationMs'] as int? ?? 0),
      model: json['model'] as String?,
      lastOutput: json['lastOutput'] as String?,
    );
  }
}
```

Use null-safe defaults for optional fields so malformed JSON doesn't crash the app.

### SubAgentService (`sub_agent_service.dart`)

```dart
class SubAgentService extends ChangeNotifier {
  List<SubAgentInfo> _agents = [];

  List<SubAgentInfo> get agents => _agents;
  int get activeCount => _agents.where((a) => a.status == SubAgentStatus.running).length;
  bool get hasAgents => _agents.isNotEmpty;

  SubAgentStatus get overallStatus {
    if (_agents.any((a) => a.status == SubAgentStatus.errored)) return SubAgentStatus.errored;
    if (_agents.any((a) => a.status == SubAgentStatus.running)) return SubAgentStatus.running;
    if (_agents.any((a) => a.status == SubAgentStatus.completed)) return SubAgentStatus.completed;
    return SubAgentStatus.unknown;
  }

  void handleSnapshot(Map<String, dynamic> json) {
    try {
      _agents = (json['agents'] as List)
          .map((a) => SubAgentInfo.fromJson(a as Map<String, dynamic>))
          .toList();
      notifyListeners();
    } catch (e) {
      debugPrint('[SubAgent] Failed to parse snapshot: $e');
      // Keep stale state rather than crashing
    }
  }

  void clear() {
    _agents = [];
    notifyListeners();
  }
}
```

### LiveKitService Integration (`livekit_service.dart`)

The service instance should be created and owned by `LiveKitService`, following the pattern of `RelayChatService` (see `_initRelayChatService()` at line 1684).

Add a `SubAgentService` field:
```dart
final SubAgentService subAgentService = SubAgentService();
```

In `_handleDataReceived()` (line 943), add a new topic branch BEFORE the `ganglia-events` check:

```dart
void _handleDataReceived(DataReceivedEvent event) {
  // Route by topic
  if (event.topic == 'sub-agents') {
    try {
      final json = jsonDecode(utf8.decode(event.data)) as Map<String, dynamic>;
      subAgentService.handleSnapshot(json);
    } catch (e) {
      debugPrint('[SubAgent] Failed to decode snapshot: $e');
    }
    return;
  }

  if (event.topic == 'relay') {
    // ... existing relay handling (lines 945-971) ...
  }

  if (event.topic != 'ganglia-events') return;
  // ... existing ganglia handling ...
}
```

This follows the exact routing pattern used for `relay` (line 945) and `ganglia-events` (line 974). The `sub-agents` branch should come first since it is the simplest (no interception needed).

### Exposing to Widgets

The `SubAgentService` must be accessible from `ConversationScreen`. Since `LiveKitService` is already accessible from the screen (it's the main service), the simplest approach is:
```dart
// In ConversationScreen build:
final subAgentService = _liveKitService.subAgentService;
```

If the EPIC determines that the service should be injected via `Provider` or `InheritedWidget` instead, that can be done later. For now, direct field access matches the existing pattern (`_liveKitService.healthService` -- see `conversation_screen.dart` line 88).

### Completed Agent Rolloff (Client-Side)

The architecture doc specifies that completed agents should roll off after 60 seconds on the client. However, the server already handles this. For the MVP, rely on server-side rolloff (the server stops including completed agents in snapshots after 60s). Client-side rolloff with a timer can be added as polish.

## Tests

### `apps/mobile/test/models/sub_agent_info_test.dart`

Test cases:
1. **Valid JSON** — `fromJson()` with all fields populated returns correct `SubAgentInfo`.
2. **Minimal JSON** — `fromJson()` with only required fields (`id`, `startedAt`, `lastActivityAt`) uses defaults for optional fields.
3. **Null completedAt** — running agent has `completedAt: null`.
4. **Status parsing** — each status string (`"running"`, `"completed"`, `"errored"`, `"unknown"`) maps to the correct enum value.
5. **Unknown status fallback** — unrecognized status string maps to `SubAgentStatus.unknown`.
6. **Missing fields** — JSON missing `task` or `model` uses defaults instead of crashing.

### `apps/mobile/test/services/sub_agent_service_test.dart`

Test cases:
1. **Initial state** — `agents` is empty, `hasAgents` is false, `activeCount` is 0.
2. **handleSnapshot with agents** — updates `agents` list, `hasAgents` is true.
3. **handleSnapshot updates** — second snapshot replaces first (full replacement semantics).
4. **activeCount** — correctly counts only running agents.
5. **overallStatus running** — returns `running` when any agent is running.
6. **overallStatus errored** — returns `errored` when any agent is errored (takes precedence over running).
7. **overallStatus completed** — returns `completed` when all agents are completed.
8. **notifyListeners** — listeners are notified on `handleSnapshot()`.
9. **Malformed snapshot** — `handleSnapshot()` with invalid JSON doesn't crash; retains previous state.
10. **Empty snapshot** — `handleSnapshot()` with `agents: []` clears the list.
11. **clear()** — resets to empty state and notifies listeners.

## Acceptance Criteria

- [ ] `SubAgentInfo` model with `fromJson()` factory and null-safe defaults
- [ ] `SubAgentStatus` enum with string parsing (running, completed, errored, unknown)
- [ ] `SubAgentService` (`ChangeNotifier`) with `handleSnapshot()`, `agents`, `activeCount`, `hasAgents`, `overallStatus`
- [ ] `_handleDataReceived()` in `LiveKitService` routes `"sub-agents"` topic to `SubAgentService`
- [ ] `SubAgentService` exposed from `LiveKitService` for widget access
- [ ] Malformed snapshots caught and logged without crashing
- [ ] All unit tests pass with `flutter test`
