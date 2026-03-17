# TASK-085: Sub-Agent Data Model, Provider Interface, and Registry

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** —
**Blocked By:** —

## Description

Define the shared types (`SubAgentInfo`, `SubAgentStatus`, `SubAgentSnapshot`), the `SubAgentProvider` interface, and the `SubAgentRegistry` class that aggregates providers and publishes snapshots to LiveKit data channels.

This is the foundation task — all other relay-side tasks depend on it.

## Files

### Create

- `apps/relay/src/sub-agents/types.ts` — `SubAgentInfo`, `SubAgentStatus`, `SubAgentSnapshot` interfaces and a `isSubAgentSnapshot()` type guard
- `apps/relay/src/sub-agents/provider.ts` — `SubAgentProvider` interface with `name`, `start()`, `stop()`, `getAgents()`, `onChange()`
- `apps/relay/src/sub-agents/registry.ts` — `SubAgentRegistry` class
- `apps/relay/src/sub-agents/registry.spec.ts` — Unit tests for registry
- `apps/relay/src/sub-agents/index.ts` — Barrel exports

## Implementation Notes

### SubAgentProvider interface

```typescript
interface SubAgentProvider {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getAgents(): SubAgentInfo[];
  onChange(callback: () => void): void;
}
```

Follow the lifecycle pattern from `RelayBridge.start()/stop()`. The `onChange` callback is notification-only — the registry pulls state via `getAgents()` to avoid partial-update bugs.

### SubAgentRegistry

- Constructor accepts: `roomManager: RoomManager`, `logger: Logger`, `providers: SubAgentProvider[]`
- `start()`: calls `provider.start()` for each provider, wires `onChange` callbacks
- `stop()`: calls `provider.stop()` for each provider, clears debounce timer
- `addRoom(roomName)` / `removeRoom(roomName)`: manages the set of rooms to publish to
- `buildSnapshot()`: aggregates `getAgents()` from all providers into a `SubAgentSnapshot`
- On provider change: debounce 1 second, then call `publishSnapshot()`
- `publishSnapshot()`: calls `roomManager.sendToRoomOnTopic(roomName, "sub-agents", snapshot)` for each active room

### Debounce timer

Must use `.unref()` to avoid blocking process exit — follow the pattern from `bridge-manager.ts` (lines 367-369, 400-402):

```typescript
this.debounceTimer = setTimeout(() => { ... }, 1000);
this.debounceTimer.unref();
```

### Error handling

- If a provider throws in `getAgents()`, catch the error, log a warning, and omit that provider's agents from the snapshot (publish a partial snapshot rather than failing entirely)
- If `publishSnapshot()` fails for one room, log the error and continue to next room

## Tests

File: `apps/relay/src/sub-agents/registry.spec.ts`

1. `buildSnapshot()` aggregates agents from multiple providers
2. `buildSnapshot()` returns empty agents array when no providers have agents
3. Provider `onChange` triggers debounced snapshot publish
4. Debounce coalesces rapid provider changes into one publish
5. `addRoom()` / `removeRoom()` controls publish targets
6. Snapshot published to ALL active rooms (not just one)
7. Provider error in `getAgents()` results in partial snapshot (not failure)
8. `stop()` clears debounce timer and stops all providers
9. `start()` calls `start()` on all providers

## Acceptance Criteria

- [ ] `SubAgentInfo`, `SubAgentStatus`, `SubAgentSnapshot` types exported from `types.ts`
- [ ] `isSubAgentSnapshot()` type guard works for valid and invalid payloads
- [ ] `SubAgentProvider` interface exported from `provider.ts`
- [ ] `SubAgentRegistry` aggregates providers, debounces changes, publishes to data channel
- [ ] Debounce timer uses `.unref()` pattern
- [ ] Partial snapshot published when one provider errors
- [ ] All 9 tests pass
