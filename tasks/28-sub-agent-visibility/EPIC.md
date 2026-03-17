# Epic 28: Sub-Agent Visibility

Monitor backend sub-agents (Claude Code, OpenClaw) and display their status in the Flutter app.

## Architecture

```
Flutter App ◄── "sub-agents" topic ── Relay ◄── SubAgentProvider (per backend)
```

- **Relay**: Provider pattern watches for sub-agent activity, pushes full snapshots via data channel
- **Flutter**: SubAgentService parses snapshots, SubAgentChip in DiagnosticsBar, SubAgentPanel bottom sheet

## Tasks

- [ ] 085: Sub-agent data model, provider interface, and registry
- [ ] 086: Claude Code filesystem provider (JSONL watcher)
- [ ] 087: OpenClaw passive provider (session/update events)
- [ ] 088: Relay bridge integration (wire provider into start/stop)
- [ ] 089: Flutter SubAgentService + data model
- [ ] 090: Flutter sub-agent UI widgets (chip, card, panel)
- [ ] 091: Architecture docs + task tracking

## Dependency Graph

```
085 (types + registry)
 ├──> 086 (Claude Code provider)
 ├──> 087 (OpenClaw provider)
 └──> 088 (relay integration) ←── 086, 087

089 (Flutter service + model) ←── independent, parallelizable with 085-088
 └──> 090 (Flutter UI widgets)

091 (docs) ←── 088, 090 (after all implementation)
```

Server track (085-088) and client track (089-090) can be developed in parallel.

## Integration Points (from code review)

### Relay (server)
- `apps/relay/src/index.ts` — Registry created at startup (between RoomManager and BridgeManager)
- `apps/relay/src/bridge/bridge-manager.ts` — Accepts registry; calls `addRoom`/`removeRoom` on bridge lifecycle; creates per-bridge OpenClawProvider in `handleSessionBind()`
- `apps/relay/src/bridge/relay-bridge.ts` — `onUpdate` handler (line 167) calls `openClawProvider?.feedEvent(params)` before existing forwarding logic
- `apps/relay/src/livekit/room-manager.ts` — `sendToRoomOnTopic(roomName, "sub-agents", snapshot)` used by registry for publishing

### Flutter (client)
- `apps/mobile/lib/services/livekit_service.dart` — `_handleDataReceived()` (line 943) gets new `"sub-agents"` topic branch before existing `"relay"` and `"ganglia-events"` routing
- `apps/mobile/lib/screens/conversation_screen.dart` — `DiagnosticsBar.trailing` (line 102) changes from single widget to `Row` containing artifact button + SubAgentChip
- `apps/mobile/lib/widgets/diagnostics_bar.dart` — No changes needed; `trailing: Widget?` accepts a `Row`

## Key Files

### Create: Relay (`apps/relay/src/sub-agents/`)
- `types.ts` — SubAgentInfo, SubAgentStatus, SubAgentSnapshot
- `provider.ts` — SubAgentProvider interface
- `registry.ts` — SubAgentRegistry (aggregation, debounce, publish)
- `claude-code-provider.ts` — filesystem watcher for Claude Code
- `openclaw-provider.ts` — passive event capture from ACP updates
- `index.ts` — barrel exports
- `registry.spec.ts` — registry unit tests
- `claude-code-provider.spec.ts` — provider unit tests
- `openclaw-provider.spec.ts` — provider unit tests

### Create: Flutter (`apps/mobile/lib/`)
- `models/sub_agent_info.dart` — SubAgentInfo model + SubAgentStatus enum
- `services/sub_agent_service.dart` — ChangeNotifier service
- `widgets/sub_agent_chip.dart` — DiagnosticsBar indicator (pulsing dot + count)
- `widgets/sub_agent_card.dart` — Individual agent row (task, status, model, elapsed, lastOutput)
- `widgets/sub_agent_panel.dart` — Bottom sheet list with TuiHeader

### Create: Tests (`apps/mobile/test/`)
- `models/sub_agent_info_test.dart`
- `services/sub_agent_service_test.dart`
- `widgets/sub_agent_chip_test.dart`
- `widgets/sub_agent_panel_test.dart`

### Modify
- `apps/relay/src/index.ts` — create registry, start/stop lifecycle
- `apps/relay/src/bridge/bridge-manager.ts` — accept registry, addRoom/removeRoom
- `apps/relay/src/bridge/relay-bridge.ts` — accept OpenClawProvider, feedEvent in onUpdate
- `apps/mobile/lib/services/livekit_service.dart` — route "sub-agents" topic
- `apps/mobile/lib/screens/conversation_screen.dart` — compose trailing Row

## Wire Protocol

Topic: `"sub-agents"` on LiveKit data channel

```json
{
  "type": "sub_agent_snapshot",
  "agents": [{
    "id": "claude-code-a960c162",
    "task": "Fix login bug in auth.ts",
    "status": "running",
    "startedAt": 1710600000000,
    "lastActivityAt": 1710600045000,
    "completedAt": null,
    "durationMs": 45000,
    "model": "claude-sonnet-4-6",
    "lastOutput": "Reading auth.ts..."
  }]
}
```

Full snapshots (not diffs) — typically 0-5 agents, <500 bytes each.

## Technical Notes

- Registry debounce: 1 second. Timer is `unref()`-ed to not block process exit.
- Publish to all active rooms (not per-room scoping). Bandwidth negligible.
- Provider errors isolated: if `getAgents()` throws, partial snapshot published.
- Completed agent rolloff: 60s on server, chip fade-out 30s on client.
- Max 20 agents per provider. Oldest completed evicted first.
- OpenClawProvider `feedEvent()` called BEFORE catch-up dedup logic in onUpdate handler (provider needs to see all events).
- Logging: `rootLogger.child({ component: "..." })` pattern from `apps/relay/src/utils/logger.ts`.
