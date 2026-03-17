# Epic 28: Sub-Agent Visibility

Monitor backend sub-agents (Claude Code, OpenClaw) and display their status in the Flutter app.

## Architecture

```
Claude Code ──JSONL──> ClaudeCodeProvider ──┐
                                            ├──> SubAgentRegistry ──> RoomManager ──> Data Channel ──> Flutter
OpenClaw ──ACP events──> OpenClawProvider ──┘
                                                    debounce 1s            topic: "sub-agents"
```

- **Relay**: Provider pattern watches for sub-agent activity, pushes full snapshots via data channel
- **Flutter**: SubAgentService parses snapshots, SubAgentChip in DiagnosticsBar, SubAgentPanel bottom sheet
- **Architecture doc**: `docs/architecture/sub-agent-visibility.md`

## Technical Notes (from CTO review)

**Provider lifecycle ownership:** The `ClaudeCodeProvider` is room-independent (watches a filesystem path). The `OpenClawProvider` is per-bridge (hooks into ACP event stream). The registry manages both, but they have different scoping:
- `ClaudeCodeProvider`: Created once at relay startup, lives for the process lifetime
- `OpenClawProvider`: Receives events via `feedEvent()` called from `RelayBridge.onUpdate()` handler

**Room scoping:** The registry publishes snapshots to ALL active rooms (sub-agent work is not inherently room-scoped). This simplifies the implementation and matches the "ambient awareness" design.

**OpenClaw provider integration:** The provider MUST hook into `RelayBridge`'s existing `acpClient.onUpdate()` callback. It cannot be a standalone watcher. TASK-087 depends on understanding the bridge's event forwarding internals.

**DiagnosticsBar trailing slot:** Currently accepts a single `Widget?`. TASK-090 must compose both the artifact button and sub-agent chip in a `Row` at the `ConversationScreen` level, rather than changing the `DiagnosticsBar` API.

## Tasks

- [ ] 085: Sub-agent data model, provider interface, and registry
- [ ] 086: Claude Code filesystem provider (JSONL watcher)
- [ ] 087: OpenClaw passive provider (session/update events)
- [ ] 088: Relay bridge integration (wire providers into start/stop, publish snapshots)
- [ ] 089: Flutter SubAgentService + data model
- [ ] 090: Flutter sub-agent UI widgets (chip, card, panel)
- [ ] 091: Architecture docs + task tracking

**Parallelism:** 085-088 (server) and 089-090 (client) can proceed in parallel.
**Dependencies:** 086, 087 depend on 085. 088 depends on 085, 086, 087. 090 depends on 089.

## Key Files

### Relay (`apps/relay/src/sub-agents/`)
- `types.ts` -- SubAgentInfo, SubAgentStatus, SubAgentSnapshot
- `provider.ts` -- SubAgentProvider interface
- `registry.ts` -- SubAgentRegistry: aggregation, debounce, publishing
- `claude-code-provider.ts` -- filesystem watcher for Claude Code JSONL logs
- `openclaw-provider.ts` -- passive event capture from ACP updates via `feedEvent()`
- `index.ts` -- barrel exports

### Relay integration points
- `apps/relay/src/bridge/relay-bridge.ts` -- Add `openClawProvider.feedEvent(params)` call in `onUpdate` handler
- `apps/relay/src/bridge/bridge-manager.ts` -- Wire registry into bridge lifecycle
- `apps/relay/src/index.ts` -- Create registry and ClaudeCodeProvider at startup

### Flutter (`apps/mobile/lib/`)
- `models/sub_agent_info.dart` -- SubAgentInfo model + SubAgentStatus enum
- `services/sub_agent_service.dart` -- ChangeNotifier service
- `widgets/sub_agent_chip.dart` -- DiagnosticsBar indicator
- `widgets/sub_agent_card.dart` -- Individual agent row
- `widgets/sub_agent_panel.dart` -- Bottom sheet list

### Flutter integration points
- `services/livekit_service.dart` -- Add `"sub-agents"` topic branch in `_handleDataReceived()`
- `screens/conversation_screen.dart` -- Compose chip + artifact button in DiagnosticsBar trailing slot

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

Full snapshots (not diffs) -- typically 0-5 agents, <500 bytes each. Max 1/second (debounced). Reconnection is self-correcting (next snapshot has full state).
