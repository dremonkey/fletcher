# PRD: Sub-Agent Visibility

**Epic:** 28
**Status:** Draft
**Author:** Planning Agent
**Date:** 2026-03-16

## 1. Overview

Add real-time sub-agent monitoring to Fletcher. When backend agents (Claude Code, OpenClaw) are spawned to handle work, surface their status in the Flutter mobile app so the user knows what is happening, how long it has been happening, and when it finishes.

The feature spans three layers: server-side providers that watch for agent activity, a wire protocol that transmits snapshots, and client-side UI that renders them.

## 2. Goals and Non-Goals

### Goals

- G1: Users can see at a glance whether sub-agents are running (chip indicator in DiagnosticsBar)
- G2: Users can tap to see per-agent detail (task, status, model, duration, last output)
- G3: Provider framework is extensible -- adding a new agent type requires one new provider class
- G4: Zero impact to voice pipeline latency
- G5: Graceful degradation -- if a provider fails or a backend does not emit events, the UI simply shows fewer or less-detailed agents

### Non-Goals

- NG1: User control over agents (start, stop, cancel, reprioritize)
- NG2: Push notifications or alerts on agent completion
- NG3: Persistent history of past agent runs (snapshots are ephemeral, in-memory only)
- NG4: Multi-user / global agent view (scoped to current session)
- NG5: Agent log streaming (last output is a summary line, not a scrolling log)

## 3. User Experience

### 3.1 Entry Point: DiagnosticsBar Chip

When one or more sub-agents are active, a compact chip appears in the DiagnosticsBar trailing slot (right side, same position as the artifact counter button).

```
[SYS: OK | VAD: 0.85 | RT: 128ms | TOK: 35K]     [2 agents]
```

**Chip states:**

| State | Visual | Text |
|-------|--------|------|
| No agents | Hidden | -- |
| 1+ running | Pulsing green dot + count | `1 agent` / `3 agents` |
| 1+ errored, rest done | Pulsing red dot + count | `1 agent` / `3 agents` |
| All completed | Static green dot + count (fades out after 30s) | `2 done` |

The chip is tappable. Tapping opens the Sub-Agent Panel.

**Coexistence with artifact counter:** When both the artifact counter and the sub-agent chip are present, they share the trailing slot as a `Row`. The artifact counter takes priority (leftmost); the agent chip sits to its right. If space is constrained, the agent chip truncates to just the dot (no text).

### 3.2 Sub-Agent Panel (Bottom Sheet)

A bottom sheet (55% screen height, matching HealthPanel) showing one card per agent.

**Panel header:**
```
+--[ SUB-AGENTS ]---------------------+
```

**Per-agent card layout:**

```
+--------------------------------------+
| Fix login bug in auth.ts             |  <- task (truncated to 1 line)
| STATUS: RUNNING  |  MODEL: sonnet    |  <- status + model
| ELAPSED: 45s     |  LAST: Reading... |  <- duration + last output
+--------------------------------------+
```

**Card fields:**

| Field | Source | Formatting |
|-------|--------|------------|
| Task | `agent.task` | Single line, ellipsis overflow |
| Status | `agent.status` | Uppercase. Color: green=running, cyan=completed, red=errored, gray=unknown |
| Model | `agent.model` | Short name (strip `claude-` prefix, e.g. "sonnet-4-6") |
| Elapsed | `now - agent.startedAt` | Live-updating: `12s`, `2m 30s`, `1h 5m` |
| Last | `agent.lastOutput` | Single line, ellipsis overflow, monospace |

**Sort order:** Running agents first (sorted by startedAt ascending), then completed/errored (sorted by completedAt descending).

**Empty state:** When no agents are present, the panel shows:
```
No active sub-agents.
```

**Completed agent rolloff:** Completed agents remain visible for 60 seconds after `completedAt`, then fade out. If the panel is open, they stay visible until the panel closes.

### 3.3 Interaction Flow

```
User asks: "Fix the login bug"
  |
  v
Voice agent dispatches to Claude Code
  |
  v
[2s] Claude Code provider detects new JSONL entry
  |
  v
[<1s] Relay pushes snapshot to Flutter via data channel
  |
  v
[immediately] SubAgentChip appears: pulsing green dot, "1 agent"
  |
  v
User taps chip -> SubAgentPanel opens
  |
  v
Card shows: "Fix login bug in auth.ts" / RUNNING / sonnet / 12s / "Reading auth.ts..."
  |
  v
[updates every 3s] Last output changes: "Editing auth.ts..." -> "Running tests..."
  |
  v
Agent completes -> status: COMPLETED -> chip: "1 done"
  |
  v
[30s] Chip fades out
```

## 4. Data Model

### 4.1 SubAgentInfo (shared across relay and Flutter)

```typescript
interface SubAgentInfo {
  /** Unique identifier for this agent instance. */
  id: string;

  /** Human-readable description of what the agent is doing. */
  task: string;

  /** Current lifecycle status. */
  status: SubAgentStatus;

  /** When the agent started working (epoch ms). */
  startedAt: number;

  /** When the agent last produced output or changed state (epoch ms). */
  lastActivityAt: number;

  /** When the agent finished (epoch ms). Null if still running. */
  completedAt: number | null;

  /** Wall-clock duration in ms (server-computed for consistency). */
  durationMs: number;

  /** Model identifier, if known (e.g. "claude-sonnet-4-6"). */
  model: string | null;

  /** Most recent output line or status message. */
  lastOutput: string | null;
}

type SubAgentStatus = "running" | "completed" | "errored" | "unknown";
```

### 4.2 SubAgentSnapshot (wire format)

```typescript
interface SubAgentSnapshot {
  type: "sub_agent_snapshot";
  agents: SubAgentInfo[];
}
```

Sent on the `"sub-agents"` LiveKit data channel topic. Full replacement semantics -- each snapshot contains the complete current state. The client replaces its entire agent list on each snapshot.

### 4.3 Flutter Model

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
}
```

## 5. Architecture

### 5.1 Server Side (Relay)

```
apps/relay/src/sub-agents/
  types.ts           -- SubAgentInfo, SubAgentStatus, SubAgentSnapshot
  provider.ts        -- SubAgentProvider interface
  registry.ts        -- provider registration and snapshot aggregation
  claude-code-provider.ts  -- watches Claude Code JSONL output
  openclaw-provider.ts     -- captures session/update events passively
  index.ts           -- barrel exports
```

**SubAgentProvider interface:**

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

**SubAgentRegistry:**

- Holds registered providers
- Aggregates `getAgents()` across all providers into a single snapshot
- On any provider change, debounces (1s) and publishes snapshot to data channel
- Wired into `RelayBridge.start()` / `RelayBridge.stop()`

### 5.2 Claude Code Provider

Claude Code writes structured JSONL to a known path (typically `~/.claude/projects/*/logs/*.jsonl`). The provider watches this directory with `fs.watch()` and parses new lines to extract agent activity.

**Detection heuristics:**
- New JSONL entry with `type: "assistant"` = agent started or continuing
- Entry with tool calls = update `lastOutput` with tool name + args summary
- Entry with `stop_reason: "end_turn"` = agent completed
- No new entries for >60s after last activity = mark as completed (timeout)

**Limitations:**
- Path detection is best-effort; configurable via `CLAUDE_CODE_LOG_DIR` env var
- JSONL format is undocumented and may change; provider uses defensive parsing
- Multiple concurrent Claude Code sessions are disambiguated by log file path

### 5.3 OpenClaw Provider

The OpenClaw provider is passive -- it listens to `session/update` events that already flow through the relay bridge and extracts sub-agent information from update metadata.

**Detection heuristics:**
- `sessionUpdate: "agent_started"` events (if OpenClaw emits them)
- `sessionUpdate: "tool_call"` with sub-agent tool names
- `sessionUpdate: "end_turn"` = agent completed
- Falls back to coarse "session is active" / "session is idle" if granular events are unavailable

**Limitations:**
- Depends on OpenClaw emitting structured sub-agent metadata (may only provide coarse signals)
- Provider degrades gracefully to showing a single "OpenClaw" agent with running/completed status

### 5.4 Client Side (Flutter)

**SubAgentService** (`ChangeNotifier`):
- Receives `sub_agent_snapshot` messages from `LiveKitService` data channel handler
- Parses JSON into `List<SubAgentInfo>`
- Exposes `agents`, `activeCount`, `hasAgents`, `overallStatus`
- Notifies listeners on every snapshot

**Widget tree:**
```
DiagnosticsBar
  trailing: SubAgentChip (from SubAgentService)
    onTap: -> SubAgentPanel (bottom sheet)
      children: SubAgentCard * N
```

### 5.5 Data Flow

```
Claude Code writes JSONL
  -> ClaudeCodeProvider.onChange()
  -> SubAgentRegistry.onProviderChange()
  -> [debounce 1s]
  -> registry.buildSnapshot()
  -> roomManager.sendToRoomOnTopic(roomName, "sub-agents", snapshot)
  -> LiveKit data channel
  -> LiveKitService.onDataReceived("sub-agents")
  -> SubAgentService.handleSnapshot(data)
  -> SubAgentChip rebuilds
  -> [user taps] SubAgentPanel shows cards
```

## 6. Wire Protocol Detail

### 6.1 Topic

`"sub-agents"` on the LiveKit data channel (same transport as `"ganglia-events"` and `"relay"`).

### 6.2 Message Format

```json
{
  "type": "sub_agent_snapshot",
  "agents": [
    {
      "id": "a960c162a710d7585",
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

### 6.3 Delivery Semantics

- **Full snapshot replacement.** Each message contains the complete agent list. The client does not need to reconcile diffs.
- **Frequency.** Max 1 snapshot per second (debounced in registry). During active work, expect one every 1-3 seconds.
- **Reliability.** Sent as `reliable: true` on the data channel. Missed snapshots are self-correcting (next snapshot contains full state).
- **Size.** Typical snapshot: 200-2500 bytes (0-5 agents at ~500 bytes each). Well below the 14KB chunking threshold.
- **Empty snapshots.** When all agents have completed and rolled off, an empty `agents: []` snapshot is sent so the client can hide the chip.

## 7. Acceptance Criteria

### 7.1 Server Side

- [ ] `SubAgentProvider` interface defined with `start()`, `stop()`, `getAgents()`, `onChange()`
- [ ] `SubAgentRegistry` aggregates providers, debounces changes, publishes snapshots
- [ ] `ClaudeCodeProvider` detects new agent sessions from JSONL, tracks status through completion
- [ ] `OpenClawProvider` extracts agent status from session/update events
- [ ] Providers start/stop with relay bridge lifecycle
- [ ] Snapshot published on `"sub-agents"` topic with correct JSON schema
- [ ] Unit tests for registry aggregation, debounce, and both providers

### 7.2 Client Side

- [ ] `SubAgentInfo` Dart model with JSON parsing and `SubAgentStatus` enum
- [ ] `SubAgentService` (`ChangeNotifier`) processes snapshots from data channel
- [ ] `SubAgentChip` shows in DiagnosticsBar trailing slot when agents are present
- [ ] Chip displays correct count, status dot color, and pulsing animation
- [ ] `SubAgentPanel` bottom sheet opens on chip tap
- [ ] `SubAgentCard` renders task, status, model, elapsed time, and last output
- [ ] Elapsed time updates live (1s timer while panel is open)
- [ ] Completed agents fade out after 60s
- [ ] Chip fades out 30s after all agents complete
- [ ] Empty state shown when no agents
- [ ] Unit tests for model parsing, service state management, and widget rendering

### 7.3 Integration

- [ ] End-to-end: Claude Code agent start -> chip appears in Flutter app within 5 seconds
- [ ] Survives reconnection: snapshots resume after LiveKit reconnect
- [ ] No regressions: voice pipeline latency unaffected (data channel is async)

## 8. Task Breakdown

| Task | Scope | Depends On |
|------|-------|------------|
| 085: Data model, provider interface, registry | Relay types + registry + tests | -- |
| 086: Claude Code filesystem provider | JSONL watcher + parsing + tests | 085 |
| 087: OpenClaw passive provider | session/update event capture + tests | 085 |
| 088: Relay bridge integration | Wire providers into start/stop, publish snapshots | 085, 086, 087 |
| 089: Flutter SubAgentService + data model | Dart model + ChangeNotifier service + tests | -- |
| 090: Flutter sub-agent UI widgets | Chip, card, panel + tests | 089 |
| 091: Architecture docs + task tracking | Update data-channel-protocol.md, mobile-client.md | 088, 090 |

Tasks 085-088 (server) and 089-090 (client) can be developed in parallel.

## 9. Future Considerations

These are explicitly out of scope for Epic 28 but worth noting for future work:

- **Agent control actions.** Cancel a stuck agent, retry a failed one. Requires bidirectional protocol and relay-side agent management.
- **Persistent agent history.** SQLite-backed log of past agent runs, queryable in the app. Depends on local persistence infrastructure (Epic 3, task 005).
- **Agent output preview.** Show the agent's full output (diffs, files written) in the panel. Overlaps with the existing ArtifactViewer; may need artifact-agent association.
- **Multi-session view.** Show agents across all active sessions, not just the current one. Useful for multi-device scenarios.
- **Cost tracking.** Show estimated token/compute cost per agent run. Depends on upstream cost reporting from OpenClaw/Claude Code.
