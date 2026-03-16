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

## Key Files

### Relay (`apps/relay/src/sub-agents/`)
- `types.ts` — SubAgentInfo, SubAgentStatus, SubAgentSnapshot
- `provider.ts` — SubAgentProvider interface
- `registry.ts` — registerSubAgentProvider / createSubAgentProvider
- `claude-code-provider.ts` — filesystem watcher for Claude Code
- `openclaw-provider.ts` — passive event capture from ACP updates
- `index.ts` — barrel export + provider registration

### Flutter (`apps/mobile/lib/`)
- `models/sub_agent_info.dart` — SubAgentInfo model + SubAgentStatus enum
- `services/sub_agent_service.dart` — ChangeNotifier service
- `widgets/sub_agent_chip.dart` — DiagnosticsBar indicator
- `widgets/sub_agent_card.dart` — Individual agent row
- `widgets/sub_agent_panel.dart` — Bottom sheet list

## Wire Protocol

Topic: `"sub-agents"` on LiveKit data channel

```json
{
  "type": "sub_agent_snapshot",
  "agents": [{
    "id": "a960c162a710d7585",
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
