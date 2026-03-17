# Sub-Agent Visibility

Real-time monitoring of backend sub-agents (Claude Code, OpenClaw) with status display in the Flutter mobile app. This feature adds a read-only observation layer that shows what sub-agents are doing, how long they have been working, and when they finish -- without any control actions.

## Design Rationale

When Fletcher dispatches work to sub-agents, the user currently sees nothing. The sub-agent visibility feature turns this black box into a glass box through ambient indicators in the existing UI. The design is shaped by three key constraints:

1. **Zero voice pipeline impact.** Sub-agent data flows on a separate data channel topic, completely decoupled from the audio pipeline. No new connections, no new auth, no blocking operations.

2. **Full snapshot semantics.** Each update contains the complete agent list rather than diffs. This eliminates synchronization bugs, makes reconnection trivial (the next snapshot is the full state), and keeps the client simple at negligible bandwidth cost (0-5 agents at ~500 bytes each).

3. **Provider-based extensibility.** Different backends expose agent activity through different mechanisms (filesystem logs, event streams, API polling). A `SubAgentProvider` interface allows each backend to implement its own detection strategy while the registry handles aggregation and publishing.

## Architecture Overview

```
Claude Code ──JSONL──> ClaudeCodeProvider ──┐
                                            ├──> SubAgentRegistry ──> RoomManager ──> Data Channel ──> Flutter
OpenClaw ──ACP events──> OpenClawProvider ──┘
                                                    debounce 1s            topic: "sub-agents"
```

The feature spans three layers:

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Provider framework | `apps/relay/src/sub-agents/` | Detect agent activity from backends, maintain per-provider agent state |
| Wire protocol | LiveKit data channel, topic `"sub-agents"` | Transport full snapshots from relay to Flutter |
| Client rendering | `apps/mobile/lib/` | Parse snapshots, display chip indicator and detail panel |

## Server Side (Relay)

### Module Structure

```
apps/relay/src/sub-agents/
  types.ts                  -- SubAgentInfo, SubAgentStatus, SubAgentSnapshot
  provider.ts               -- SubAgentProvider interface
  registry.ts               -- SubAgentRegistry: aggregation, debounce, publishing
  claude-code-provider.ts   -- Filesystem watcher for Claude Code JSONL logs
  openclaw-provider.ts      -- Passive event capture from ACP session/update events
  index.ts                  -- Barrel exports
```

### SubAgentProvider Interface

```typescript
interface SubAgentProvider {
  /** Unique name for this provider (e.g. "claude-code", "openclaw"). */
  readonly name: string;

  /** Start watching for agent activity. */
  start(): Promise<void>;

  /** Stop watching. Clean up watchers, timers, etc. */
  stop(): Promise<void>;

  /** Return current known agents from this provider. */
  getAgents(): SubAgentInfo[];

  /** Register a callback for state changes. */
  onChange(callback: () => void): void;
}
```

This interface mirrors the lifecycle pattern used by other relay components (`RelayBridge.start()/stop()`, `BridgeManager.addRoom()/removeRoom()`). The `onChange` callback is a simple notification -- the registry pulls the current state via `getAgents()` rather than receiving pushed data, which keeps provider implementations simple and avoids partial-update bugs.

### SubAgentRegistry

The registry aggregates providers into unified snapshots and manages publishing:

- **Registration:** Providers are registered at relay startup. Each provider's `onChange` callback is wired to trigger a snapshot rebuild.
- **Aggregation:** `buildSnapshot()` calls `getAgents()` on each provider and concatenates the results. Agent IDs must be globally unique (providers should prefix with their name, e.g. `claude-code-<id>`).
- **Debounce:** Provider changes are debounced to 1 second to prevent burst publishing during rapid JSONL writes or event storms.
- **Publishing:** After debounce, the registry calls `roomManager.sendToRoomOnTopic(roomName, "sub-agents", snapshot)` for each active room. This uses the same `publishData` path as existing `"relay"` and `"ganglia-events"` topics.
- **Lifecycle:** The registry's `start()` and `stop()` methods call through to each provider. These are invoked from `BridgeManager` or the relay entry point, aligning with the existing shutdown-all pattern.

### Room-Scoping Decision

A critical architectural question: should the registry publish to all rooms, or only to the room that initiated the sub-agent work?

**Recommendation: Publish to all active rooms.** Sub-agent work (especially Claude Code) is not inherently scoped to a single LiveKit room. A user may be in a different room than the one that triggered the work. Broadcasting to all rooms is simpler and matches the "ambient awareness" design principle. The bandwidth cost is negligible (one small JSON message per room per second, max).

If per-room scoping is desired later (e.g., multi-user scenarios), the registry can filter by associating provider agents with room names. The snapshot format already supports this via the `id` field.

### Claude Code Provider

Watches Claude Code JSONL output files to detect agent activity.

**File detection:**
- Default path: `~/.claude/projects/*/logs/*.jsonl` (configurable via `CLAUDE_CODE_LOG_DIR` env var)
- Uses `fs.watch()` on the log directory for new file creation and modification
- Falls back to polling (5s interval) if `fs.watch()` is unreliable (known issue on some Linux filesystems)

**State machine per agent session (identified by log file):**

```
File created/modified → RUNNING
  ├── New assistant entry with tool_use → update lastOutput (tool name + summary)
  ├── Entry with stop_reason: "end_turn" → COMPLETED
  ├── No new entries for 60s → COMPLETED (timeout)
  └── Parse error / file deleted → ERRORED
```

**Defensive parsing:** The JSONL format is undocumented and may change. The provider:
- Ignores unknown fields and unexpected entry types
- Wraps all JSON.parse calls in try/catch
- Logs parse failures at debug level (not error) to avoid log noise
- Uses `lastOutput` as a best-effort summary, not a guaranteed field

**Resource management:**
- `fs.watch()` handles are closed on `stop()`
- Completed agents are retained for 60 seconds, then removed from `getAgents()` results
- Maximum 20 tracked agents per provider (oldest completed agents evicted first)

### OpenClaw Provider

Passive event capture from ACP `session/update` events that already flow through `RelayBridge`.

**Integration approach:** The OpenClaw provider does NOT watch a separate data source. Instead, it receives events by hooking into the `RelayBridge.acpClient.onUpdate()` callback chain. This requires the registry to pass a reference to the provider when the bridge is created, or (preferably) to expose a `feedEvent(params)` method on the provider that the bridge calls.

**Implementation option (recommended):** Add a thin hook in `RelayBridge`'s `onUpdate` handler:

```typescript
// In RelayBridge.start(), after existing onUpdate handler:
this.acpClient.onUpdate((params) => {
  // ... existing forwarding logic ...
  this.openClawProvider?.feedEvent(params);
});
```

This avoids a separate connection to OpenClaw and reuses the existing ACP event stream. The provider extracts agent signals from update metadata:

- `sessionUpdate: "tool_call"` with sub-agent tool names → agent started or continuing
- `sessionUpdate: "end_turn"` → agent completed
- Falls back to coarse "session active" / "session idle" if granular events are unavailable

**Graceful degradation:** If OpenClaw does not emit sub-agent metadata, the provider shows a single "OpenClaw" agent with `running` / `completed` status based on whether an ACP request is active. This is still useful -- it tells the user *something* is happening.

### Relay Lifecycle Integration

The registry and providers are wired into the relay startup:

```
Relay starts
  └─> BridgeManager created
        └─> SubAgentRegistry created with providers
              ├─> ClaudeCodeProvider (watches filesystem)
              └─> OpenClawProvider (receives bridge events)

Bridge for room X starts
  └─> Registry told about room X (adds to publish target list)
  └─> OpenClawProvider connected to bridge's ACP event stream

Bridge for room X stops
  └─> Registry removes room X from publish targets

Relay shuts down
  └─> Registry.stop() → all providers stopped
```

## Wire Protocol

### Topic

`"sub-agents"` on the LiveKit data channel. This is a new topic alongside the existing `"ganglia-events"`, `"relay"`, `"voice-acp"`, and `"lk.transcription"` topics.

### Message Format

```json
{
  "type": "sub_agent_snapshot",
  "agents": [
    {
      "id": "claude-code-a960c162",
      "task": "Fix login bug in auth.ts",
      "status": "running",
      "startedAt": 1710600000000,
      "lastActivityAt": 1710600045000,
      "completedAt": null,
      "durationMs": 45000,
      "model": "claude-sonnet-4-6",
      "lastOutput": "Reading auth.ts..."
    }
  ]
}
```

### Data Model

```typescript
interface SubAgentInfo {
  id: string;                    // Unique, provider-prefixed
  task: string;                  // Human-readable description
  status: SubAgentStatus;        // "running" | "completed" | "errored" | "unknown"
  startedAt: number;             // Epoch ms
  lastActivityAt: number;        // Epoch ms
  completedAt: number | null;    // Epoch ms, null if running
  durationMs: number;            // Server-computed wall clock
  model: string | null;          // e.g. "claude-sonnet-4-6"
  lastOutput: string | null;     // Summary line
}

interface SubAgentSnapshot {
  type: "sub_agent_snapshot";
  agents: SubAgentInfo[];
}
```

### Delivery Semantics

| Property | Value |
|----------|-------|
| Transport | LiveKit data channel, `reliable: true` |
| Semantics | Full snapshot replacement (not diffs) |
| Max frequency | 1 snapshot/second (debounced) |
| Typical frequency | Every 1-3 seconds during active work |
| Typical size | 200-2500 bytes (0-5 agents at ~500 bytes each) |
| Chunking | Not needed (well below the 14KB threshold) |
| Empty state | `agents: []` sent when all agents have rolled off |
| Reconnection | Self-correcting -- next snapshot contains full state |

## Client Side (Flutter)

### SubAgentInfo Model

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

  factory SubAgentInfo.fromJson(Map<String, dynamic> json) { ... }
}
```

Location: `apps/mobile/lib/models/sub_agent_info.dart`

### SubAgentService

A `ChangeNotifier` service that processes snapshots from the data channel and exposes agent state to widgets.

```dart
class SubAgentService extends ChangeNotifier {
  List<SubAgentInfo> _agents = [];

  List<SubAgentInfo> get agents => _agents;
  int get activeCount => _agents.where((a) => a.status == SubAgentStatus.running).length;
  bool get hasAgents => _agents.isNotEmpty;
  SubAgentStatus get overallStatus { ... }

  void handleSnapshot(Map<String, dynamic> json) {
    _agents = (json['agents'] as List).map((a) => SubAgentInfo.fromJson(a)).toList();
    notifyListeners();
  }
}
```

Location: `apps/mobile/lib/services/sub_agent_service.dart`

**Integration with LiveKitService:** The service receives data via a new topic branch in `LiveKitService._handleDataReceived()`:

```dart
void _handleDataReceived(DataReceivedEvent event) {
  if (event.topic == 'sub-agents') {
    final json = jsonDecode(utf8.decode(event.data)) as Map<String, dynamic>;
    _subAgentService.handleSnapshot(json);
    return;
  }
  // ... existing relay and ganglia-events handling ...
}
```

This follows the same pattern as the existing `relay` topic routing. The `SubAgentService` instance is created and owned by `LiveKitService`, mirroring how `RelayChatService` is managed today.

**Completed agent rolloff:** Agents with `status: completed` or `status: errored` are removed from the display 60 seconds after `completedAt`. This is client-side logic driven by a periodic timer, independent of the server snapshot (which may retain agents longer for reliability). The chip itself fades out 30 seconds after all agents complete.

### Widget Tree

```
ConversationScreen
  └─> DiagnosticsBar
        trailing: Row [
          ArtifactsButton (existing),
          SubAgentChip (new)
        ]
          onTap: showModalBottomSheet(SubAgentPanel)
            children: SubAgentCard * N
```

### SubAgentChip

A compact indicator in the `DiagnosticsBar` trailing slot.

| State | Visual |
|-------|--------|
| No agents | Hidden (chip not rendered) |
| 1+ running | Pulsing green dot + count ("1 agent" / "3 agents") |
| 1+ errored, rest done | Pulsing red dot + count |
| All completed | Static green dot + count ("2 done"), fades out after 30s |

**Coexistence with artifact button:** When both are present, they share the trailing slot as a `Row`. The artifact button takes priority (leftmost); the agent chip sits to its right. If space is constrained, the agent chip truncates to just the dot (no text). This requires changing the `trailing` parameter from a single `Widget?` to support multiple widgets, or (simpler) composing both in the `ConversationScreen` build method.

Location: `apps/mobile/lib/widgets/sub_agent_chip.dart`

### SubAgentPanel

A bottom sheet (55% screen height, matching `HealthPanel`) showing per-agent cards.

- Header: `TuiHeader(label: 'SUB-AGENTS')` using existing `tui_widgets.dart`
- Cards sorted: running first (by `startedAt` ascending), then completed/errored (by `completedAt` descending)
- Empty state: "No active sub-agents."
- Elapsed time: Live-updating via a 1-second `Timer.periodic` while the panel is open (same pattern as `_DiagnosticsModal._uptimeTimer`)

Location: `apps/mobile/lib/widgets/sub_agent_panel.dart`

### SubAgentCard

Per-agent card within the panel.

| Field | Source | Formatting |
|-------|--------|------------|
| Task | `agent.task` | Single line, ellipsis overflow |
| Status | `agent.status` | Uppercase. Green=running, cyan=completed, red=errored, gray=unknown |
| Model | `agent.model` | Strip `claude-` prefix (e.g. "sonnet-4-6") |
| Elapsed | `now - agent.startedAt` | Live-updating: `12s`, `2m 30s`, `1h 5m` |
| Last | `agent.lastOutput` | Single line, ellipsis, monospace |

Location: `apps/mobile/lib/widgets/sub_agent_card.dart`

## Failure Modes

### Provider Failures

| Failure | Impact | Recovery |
|---------|--------|----------|
| Claude Code log dir missing | ClaudeCodeProvider shows no agents | Provider starts silently; begins tracking if logs appear later |
| JSONL parse error | Individual entry skipped | Provider continues watching for new entries |
| `fs.watch()` stops firing | Agent state goes stale | Polling fallback (5s) or timeout (60s marks agent completed) |
| OpenClaw emits no sub-agent metadata | OpenClawProvider shows coarse status only | Degrades to single "OpenClaw" agent with running/completed |
| Provider throws in `getAgents()` | That provider's agents omitted from snapshot | Registry catches error, logs warning, publishes partial snapshot |

### Data Channel Failures

| Failure | Impact | Recovery |
|---------|--------|----------|
| Data channel drops | Client stops receiving snapshots | On reconnection, next snapshot restores full state (snapshot semantics) |
| `publishData` times out | Single snapshot lost | Next debounce cycle publishes fresh snapshot |
| Room disconnect | Provider data continues accumulating | On room rejoin, next snapshot includes accumulated state |

### Client Failures

| Failure | Impact | Recovery |
|---------|--------|----------|
| Malformed JSON snapshot | Snapshot ignored | `try/catch` in `handleSnapshot`, stale state displayed |
| Missing fields in agent JSON | Agent omitted or shows defaults | `fromJson` uses null-safe defaults for optional fields |
| Clock skew between server and client | Elapsed time may be inaccurate | `durationMs` is server-computed (not derived from client clock) |

## Performance Considerations

**Data channel overhead:** At worst case (5 agents, 1 snapshot/second), sub-agent data adds ~2.5 KB/s to the data channel. This is negligible compared to audio data (~24 kbps) and well below the practical limit. The separate `"sub-agents"` topic ensures no interference with `"ganglia-events"` or `"relay"` message handling.

**Flutter rebuild frequency:** `SubAgentService.notifyListeners()` fires at most once per second (debounced on the server side). The chip rebuilds are lightweight (text + dot). The panel, when open, has a 1-second timer for elapsed time updates -- this is the same pattern used by `_DiagnosticsModal` for uptime and does not cause performance issues.

**Filesystem watcher overhead:** `fs.watch()` on a single directory is cheap. The provider reads and parses only appended JSONL lines (not the full file), keeping I/O minimal.

**Memory:** Each `SubAgentInfo` is ~200 bytes in Dart. With a 20-agent cap and 60-second rolloff, peak memory for this feature is under 5 KB.

## Security Considerations

- **No PII in snapshots.** Agent `task` and `lastOutput` fields may contain file paths or command summaries from the user's codebase. These are visible only to the user who initiated the work, through their authenticated LiveKit connection. No new exposure beyond what already flows through `ganglia-events`.
- **No new auth surface.** The `"sub-agents"` topic uses the same LiveKit data channel as existing topics. No new endpoints, no new tokens, no new connections.
- **Filesystem access.** The Claude Code provider reads log files from a known directory. It does not follow symlinks, write to the filesystem, or execute any commands. The path is configurable but defaults to the user's own Claude Code log directory.

## Testability

Each component is independently testable:

| Component | Test Strategy |
|-----------|---------------|
| `SubAgentProvider` interface | Mock providers returning canned `SubAgentInfo[]` arrays |
| `SubAgentRegistry` | Unit test aggregation, debounce timing, snapshot format with mock providers and mock `RoomManager` |
| `ClaudeCodeProvider` | Unit test JSONL parsing with fixture files; integration test with `fs.watch()` on a temp directory |
| `OpenClawProvider` | Unit test `feedEvent()` with sample `SessionUpdateParams` objects |
| `SubAgentInfo.fromJson()` | Unit test with valid, partial, and malformed JSON |
| `SubAgentService` | Unit test `handleSnapshot()` state transitions and `notifyListeners()` calls |
| `SubAgentChip` | Widget test with different agent counts and statuses |
| `SubAgentPanel` | Widget test with mock service, verify sort order and elapsed time formatting |

## Observability

- **Relay logs:** Registry logs snapshot publish events at `info` level: `{ event: "sub_agent_snapshot_published", agentCount, roomCount }`. Provider lifecycle events (start, stop, agent detected, agent completed) logged at `info`. Parse failures logged at `debug`.
- **Client logs:** `SubAgentService` logs snapshot receipt at `debug` level: `[SubAgent] Snapshot received: N agents`. Parse failures logged as warnings.
- **Health check:** The relay's `/health` endpoint already reports active rooms. Sub-agent provider status (started, agent count) can be added to the health response for monitoring.

## Related Documents

- [Data Channel Protocol](data-channel-protocol.md) -- transport layer and existing topic conventions
- [Mobile Client](mobile-client.md) -- service architecture and widget patterns
- [System Overview](system-overview.md) -- relay role in the deployment topology
