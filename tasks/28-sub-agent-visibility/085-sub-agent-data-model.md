# TASK-085: Sub-Agent Data Model, Provider Interface, and Registry

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** None
**Blocked By:** None

## Description

Define the shared data types (`SubAgentInfo`, `SubAgentStatus`, `SubAgentSnapshot`), the `SubAgentProvider` interface, and the `SubAgentRegistry` that aggregates providers into unified snapshots. This is the foundation task -- everything else in Epic 28 depends on these types and the registry.

The registry is responsible for:
- Holding registered providers
- Aggregating `getAgents()` across all providers into a single `SubAgentSnapshot`
- Debouncing provider change notifications (1-second window)
- Publishing snapshots to all active rooms via `RoomManager.sendToRoomOnTopic()`

## Files

### Create

- `apps/relay/src/sub-agents/types.ts` — `SubAgentInfo` interface, `SubAgentStatus` type (`"running" | "completed" | "errored" | "unknown"`), `SubAgentSnapshot` interface with `type: "sub_agent_snapshot"` discriminator. Include a `durationMs` computation helper.

- `apps/relay/src/sub-agents/provider.ts` — `SubAgentProvider` interface with `name: string`, `start(): Promise<void>`, `stop(): Promise<void>`, `getAgents(): SubAgentInfo[]`, `onChange(callback: () => void): void`.

- `apps/relay/src/sub-agents/registry.ts` — `SubAgentRegistry` class. Constructor takes a `RoomManager` reference and an array of providers. Wires each provider's `onChange` to trigger debounced snapshot rebuild. Exposes `start()`, `stop()`, `addRoom(roomName)`, `removeRoom(roomName)`, `buildSnapshot(): SubAgentSnapshot`.

- `apps/relay/src/sub-agents/index.ts` — Barrel exports for all sub-agent types, interfaces, and the registry.

- `apps/relay/src/sub-agents/registry.spec.ts` — Unit tests for the registry.

### Modify

None in this task. The registry is not wired into the relay yet (that is TASK-088).

## Implementation Notes

### Type Design

```typescript
// types.ts
export type SubAgentStatus = "running" | "completed" | "errored" | "unknown";

export interface SubAgentInfo {
  id: string;                    // Unique, provider-prefixed (e.g. "claude-code-a960c162")
  task: string;                  // Human-readable description
  status: SubAgentStatus;
  startedAt: number;             // Epoch ms
  lastActivityAt: number;        // Epoch ms
  completedAt: number | null;    // Epoch ms, null if running
  durationMs: number;            // Server-computed wall clock
  model: string | null;          // e.g. "claude-sonnet-4-6"
  lastOutput: string | null;     // Summary line
}

export interface SubAgentSnapshot {
  type: "sub_agent_snapshot";
  agents: SubAgentInfo[];
}
```

### Registry Design

- The registry maintains a `Set<string>` of active room names (populated via `addRoom`/`removeRoom`).
- On each provider `onChange` callback, the registry starts a 1-second debounce timer. When the timer fires, it calls `buildSnapshot()` and publishes to all active rooms.
- `buildSnapshot()` calls `getAgents()` on each provider and concatenates. If a provider throws, catch the error, log a warning, and omit that provider's agents from the snapshot.
- Publishing uses `this.roomManager.sendToRoomOnTopic(roomName, "sub-agents", snapshot)` -- the same method used by `RelayBridge.forwardToMobile()` and `forwardToVoiceAgent()` (see `apps/relay/src/bridge/relay-bridge.ts` lines 679, 716).
- Use `rootLogger.child({ component: "sub-agent-registry" })` for logging, following the pattern in `apps/relay/src/bridge/bridge-manager.ts` line 52.
- The debounce timer should be `unref()`-ed so it doesn't prevent process exit, matching the pattern in `bridge-manager.ts` lines 83-85.

### Key Patterns to Follow

- **Lifecycle:** Mirror `BridgeManager.shutdownAll()` (line 267-284 of `bridge-manager.ts`) -- the registry's `stop()` calls each provider's `stop()`.
- **Logger:** Import `rootLogger` and `type Logger` from `../utils/logger` (see `apps/relay/src/utils/logger.ts`).
- **Error isolation:** Each `getAgents()` call wrapped in try/catch so one broken provider doesn't take down the whole snapshot.

## Tests

### `apps/relay/src/sub-agents/registry.spec.ts`

Use `bun:test` (`describe`, `it`, `expect`) following the pattern in `apps/relay/src/bridge/bridge-manager.spec.ts`.

Test cases:
1. **Empty registry** — `buildSnapshot()` returns `{ type: "sub_agent_snapshot", agents: [] }` when no providers are registered.
2. **Single provider** — registry aggregates agents from one provider.
3. **Multiple providers** — registry concatenates agents from two providers.
4. **Provider error isolation** — if one provider's `getAgents()` throws, the other provider's agents are still included and a warning is logged.
5. **Debounce** — multiple rapid `onChange` calls result in a single `sendToRoomOnTopic` call (use `setTimeout` mock or `Bun.sleep`).
6. **Room management** — `addRoom`/`removeRoom` controls which rooms receive snapshots.
7. **No rooms** — when no rooms are registered, `onChange` fires but no publish happens.
8. **Start/stop lifecycle** — calling `start()` starts all providers, `stop()` stops all providers and clears the debounce timer.
9. **Empty snapshot after rolloff** — snapshot with `agents: []` is published when all agents have completed and rolled off.

## Acceptance Criteria

- [ ] `SubAgentInfo`, `SubAgentStatus`, and `SubAgentSnapshot` types defined in `types.ts`
- [ ] `SubAgentProvider` interface defined in `provider.ts` with `start()`, `stop()`, `getAgents()`, `onChange()`
- [ ] `SubAgentRegistry` aggregates providers, debounces changes (1s), publishes snapshots to rooms
- [ ] Registry catches provider errors in `getAgents()` and publishes partial snapshots
- [ ] Registry uses `sendToRoomOnTopic(roomName, "sub-agents", snapshot)` for publishing
- [ ] Barrel exports in `index.ts`
- [ ] All unit tests pass with `bun test`
