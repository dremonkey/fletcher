# TASK-088: Relay Bridge Integration

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** 085, 086, 087
**Blocked By:** 085, 086, 087

## Description

Wire the `SubAgentRegistry` and its providers into the relay lifecycle: create the registry at startup, connect `ClaudeCodeProvider` on boot, hook `OpenClawProvider.feedEvent()` into the bridge's `onUpdate` handler, and manage room publish targets through `BridgeManager`.

## Files

### Modify

- `apps/relay/src/index.ts` — Create registry and ClaudeCodeProvider at startup, pass registry to BridgeManager
- `apps/relay/src/bridge/bridge-manager.ts` — Accept registry in constructor, call `registry.addRoom()`/`removeRoom()` on bridge lifecycle, create OpenClawProvider per bridge
- `apps/relay/src/bridge/relay-bridge.ts` — Accept optional OpenClawProvider, call `feedEvent()` in `onUpdate` handler

## Implementation Notes

### Relay entry point (`index.ts`)

After RoomManager creation (line 15-19), before BridgeManager creation (line 26-30):

```typescript
import { SubAgentRegistry } from "./sub-agents/registry";
import { ClaudeCodeProvider } from "./sub-agents/claude-code-provider";

const claudeCodeProvider = new ClaudeCodeProvider({ logger: log.child({ component: "claude-code-provider" }) });
const subAgentRegistry = new SubAgentRegistry({
  roomManager,
  logger: log.child({ component: "sub-agent-registry" }),
  providers: [claudeCodeProvider],
});
await subAgentRegistry.start();
```

Pass `subAgentRegistry` to `BridgeManager` constructor.

In shutdown hooks (lines 69-78), add `await subAgentRegistry.stop()` before `bridgeManager.shutdownAll()`.

### BridgeManager integration (`bridge-manager.ts`)

Constructor change (line 45): add optional `subAgentRegistry?: SubAgentRegistry` parameter after existing params. This avoids breaking existing call sites.

In bridge creation flow (lines 177-188):
1. Create an `OpenClawProvider` for this bridge
2. Register it with the registry
3. Pass it to `RelayBridge` constructor

When a room is added (`addRoom`, line 72-89):
- Call `subAgentRegistry?.addRoom(roomName)`

When a bridge is stopped/removed:
- Call `subAgentRegistry?.removeRoom(roomName)`
- Stop the bridge's OpenClawProvider

### RelayBridge `onUpdate` hook (`relay-bridge.ts`)

In the `onUpdate` handler (lines 167-219), add the `feedEvent()` call BEFORE the routing logic:

```typescript
this.acpClient.onUpdate((params: SessionUpdateParams) => {
  // Feed to OpenClaw provider for sub-agent visibility
  this.openClawProvider?.feedEvent(params);

  // ... existing routing logic (lines 170-218) ...
});
```

The `feedEvent()` call must happen before catch-up dedup logic so the provider sees ALL events including catch-up replays.

### Constructor change for RelayBridge

Add optional `openClawProvider?: OpenClawProvider` to `RelayBridgeOptions` (line 100-113).

## Tests

No new test file needed — integration is validated by:
1. Existing `relay-bridge.spec.ts` tests continue passing (no regressions)
2. Existing `bridge-manager.spec.ts` tests continue passing
3. Manual integration test: start relay, verify snapshots publish on data channel

Add a focused test to `relay-bridge.spec.ts`:
- `feedEvent()` is called on the OpenClawProvider when an ACP update arrives

## Acceptance Criteria

- [ ] Registry created at relay startup with ClaudeCodeProvider
- [ ] Registry stopped in shutdown hooks
- [ ] BridgeManager accepts optional registry, wires room add/remove
- [ ] OpenClawProvider created per bridge and registered with registry
- [ ] `feedEvent()` called in RelayBridge's `onUpdate` handler before routing
- [ ] All existing relay tests continue passing
- [ ] Graceful behavior when registry is not provided (optional parameter)
