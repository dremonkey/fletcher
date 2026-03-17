# TASK-088: Relay Bridge Integration

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** TASK-085 (registry), TASK-086 (Claude Code provider), TASK-087 (OpenClaw provider)
**Blocked By:** TASK-085, TASK-086, TASK-087

## Description

Wire the `SubAgentRegistry` and its providers into the relay's startup lifecycle, bridge creation, and shutdown flow. After this task, sub-agent snapshots are published to all connected rooms in real-time.

This is the integration task that connects all server-side pieces:
- Registry is created at relay startup with the `ClaudeCodeProvider`
- `OpenClawProvider` instances are connected to each bridge's ACP event stream
- Room lifecycle events (`addRoom`/`removeRoom`) are forwarded to the registry
- Shutdown cleans everything up

## Files

### Create

None -- this task wires existing components together.

### Modify

- `apps/relay/src/index.ts` — Create `SubAgentRegistry` with `ClaudeCodeProvider` and `RoomManager` reference at startup. Call `registry.start()` after `BridgeManager` creation. Add `registry.stop()` to graceful shutdown handler.

- `apps/relay/src/bridge/bridge-manager.ts` — Accept a `SubAgentRegistry` in the constructor (or as an optional dependency). When a bridge is created in `handleSessionBind()`, call `registry.addRoom(roomName)` and connect `OpenClawProvider.feedEvent()` to the bridge. When removing a room in `removeRoom()`, call `registry.removeRoom(roomName)`.

- `apps/relay/src/bridge/relay-bridge.ts` — Accept an optional `OpenClawProvider` reference in `RelayBridgeOptions`. In the `onUpdate` handler (line 167), call `this.openClawProvider?.feedEvent(params)` after existing forwarding logic.

## Implementation Notes

### Relay Startup (`index.ts`)

The relay entry point (`apps/relay/src/index.ts`) currently creates `RoomManager` (line 15) and `BridgeManager` (line 26). Add the registry between them:

```typescript
import { SubAgentRegistry, ClaudeCodeProvider } from "./sub-agents";

const claudeCodeProvider = new ClaudeCodeProvider();
const subAgentRegistry = new SubAgentRegistry(roomManager, [claudeCodeProvider]);

const bridgeManager = new BridgeManager(
  roomManager,
  acpCommand,
  acpArgs,
  undefined, // logger
  undefined, // options
  subAgentRegistry, // new parameter
);

// After bridgeManager creation, start the registry
await subAgentRegistry.start();
```

In the graceful shutdown handler (lines 69-78), add `subAgentRegistry.stop()`:

```typescript
process.on(signal, async () => {
  log.info("Shutting down...");
  bridgeManager.stopIdleTimer();
  bridgeManager.stopDiscoveryTimer();
  await subAgentRegistry.stop(); // before shutdownAll so providers stop first
  await bridgeManager.shutdownAll();
  server.stop();
  process.exit(0);
});
```

### BridgeManager Changes (`bridge-manager.ts`)

The `BridgeManager` constructor (line 45) needs a new optional `subAgentRegistry` parameter:

```typescript
constructor(
  private roomManager: RoomManager,
  private acpCommand: string,
  private acpArgs: string[],
  logger?: Logger,
  options?: BridgeManagerOptions,
  private subAgentRegistry?: SubAgentRegistry,
)
```

In `handleSessionBind()` (line 140), after creating the bridge:
1. Create a new `OpenClawProvider` for this bridge
2. Pass it to the bridge's `RelayBridgeOptions`
3. Register the room with the registry
4. Start the provider

```typescript
// After bridge.start() on line 188:
if (this.subAgentRegistry) {
  this.subAgentRegistry.addRoom(roomName);
}
```

In `removeRoom()` (line 95):
```typescript
// Before bridge.stop():
if (this.subAgentRegistry) {
  this.subAgentRegistry.removeRoom(roomName);
}
```

In `shutdownAll()` (line 267), clear all rooms from the registry.

### RelayBridge Changes (`relay-bridge.ts`)

Add `openClawProvider` to `RelayBridgeOptions` (line 18):
```typescript
export interface RelayBridgeOptions {
  // ... existing fields ...
  /** Optional OpenClaw sub-agent provider to feed ACP events into. */
  openClawProvider?: OpenClawProvider;
}
```

In the `onUpdate` handler (line 167), add a call after the existing forwarding logic but before the catch-up dedup logic:
```typescript
this.acpClient.onUpdate((params: SessionUpdateParams) => {
  // Feed sub-agent provider (before any early returns from catch-up logic)
  this.options.openClawProvider?.feedEvent(params);

  // ... existing onUpdate logic (lines 168-219) ...
});
```

**Important:** The `feedEvent()` call should happen BEFORE the catch-up dedup logic (lines 179-205) because we want the provider to see all events, including catch-up replays. The provider's own dedup (if needed) is its responsibility.

### OpenClawProvider Lifecycle

Two options for where to create `OpenClawProvider` instances:

**Option A (recommended): Per-bridge provider**
- Each bridge creates its own `OpenClawProvider` instance.
- The provider is registered with the registry when the bridge starts.
- The provider is unregistered when the bridge stops.
- This requires `SubAgentRegistry.addProvider()` and `removeProvider()` methods (add to registry API in TASK-085 if not already there, or add here).

**Option B: Shared provider with feedEvent routing**
- A single `OpenClawProvider` is created at startup.
- All bridges call `feedEvent()` on the same instance.
- The provider disambiguates by room name or session ID.
- Simpler but less clean separation.

The architecture doc recommends Option A (per-bridge). If the registry's current API only supports constructor-time providers, extend it with dynamic `addProvider()`/`removeProvider()` methods as part of this task.

### Testing Strategy

Since this is a wiring/integration task, the primary verification is:
1. Existing relay tests still pass (no regressions in `bridge-manager.spec.ts`, `relay-bridge.spec.ts`).
2. Manual verification that snapshots are published when a Claude Code session is active.
3. The individual provider and registry unit tests from TASK-085/086/087 cover the component logic.

## Tests

No new test file needed, but verify existing tests pass:

- `bun test apps/relay/src/bridge/bridge-manager.spec.ts` — no regressions from new constructor parameter
- `bun test apps/relay/src/bridge/relay-bridge.spec.ts` — no regressions from new options field

If `bridge-manager.spec.ts` or `relay-bridge.spec.ts` need updates for the new parameters, update them to pass `undefined` for the new optional fields.

Optionally, add a focused integration test:
- Create a mock `RoomManager`, a mock provider, and a registry.
- Simulate a bridge start → provider emits agents → verify `sendToRoomOnTopic` called with correct snapshot.

## Acceptance Criteria

- [ ] `SubAgentRegistry` created at relay startup with `ClaudeCodeProvider`
- [ ] `OpenClawProvider` created per bridge and connected to ACP event stream
- [ ] Registry `addRoom`/`removeRoom` called on bridge lifecycle
- [ ] `feedEvent()` called in `RelayBridge.onUpdate` handler
- [ ] Registry `stop()` called during graceful shutdown
- [ ] Existing relay tests pass without regression
- [ ] Snapshots published on `"sub-agents"` topic when agents are active
