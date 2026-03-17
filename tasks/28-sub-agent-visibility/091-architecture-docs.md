# TASK-091: Architecture Docs + Task Tracking

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** 088, 090
**Blocked By:** 088, 090

## Description

Update architecture documentation to reflect the implemented sub-agent visibility feature. Ensure `docs/architecture/sub-agent-visibility.md` matches the final implementation, and update cross-referenced docs (`data-channel-protocol.md`, `mobile-client.md`, `system-overview.md`). Close out Epic 28 task tracking.

This is the final task — it runs after all implementation tasks are complete.

## Files

### Modify

- `docs/architecture/sub-agent-visibility.md` — Review and update to match actual implementation (may already be accurate from planning phase)
- `docs/architecture/data-channel-protocol.md` — Add `"sub-agents"` topic to the documented topic list, add `sub_agent_snapshot` message type
- `docs/architecture/mobile-client.md` — Add `SubAgentService` to service architecture diagram, add SubAgentChip/Panel to widget overview
- `docs/architecture/system-overview.md` — Add `sub-agents/` module to relay package listing if not present
- `tasks/28-sub-agent-visibility/EPIC.md` — Mark all tasks `[x]`, update status
- `tasks/SUMMARY.md` — Update Epic 28 status

## Implementation Notes

### data-channel-protocol.md updates

Add to the Transport Channels section:

| Topic | Transport | Direction | Description |
|-------|-----------|-----------|-------------|
| `sub-agents` | Data Channel | Relay → Flutter | Sub-agent status snapshots |

Add a new section "Sub-Agent Snapshots" documenting:
- Message format (`sub_agent_snapshot`)
- `SubAgentInfo` field definitions
- Delivery semantics (full snapshot, max 1/s, reliable)
- Size characteristics (<2.5KB typical)

### mobile-client.md updates

Add `SubAgentService` to the service architecture section:
- Brief description: ChangeNotifier processing sub-agent snapshots
- Relationship to LiveKitService (receives data via topic routing)
- Public API: `agents`, `activeCount`, `hasAgents`, `overallStatus`

Add to widget overview:
- `SubAgentChip` — DiagnosticsBar trailing indicator
- `SubAgentPanel` — Bottom sheet detail view
- `SubAgentCard` — Per-agent row in panel

### system-overview.md updates

If the relay package listing doesn't include `sub-agents/`, add it:
```
apps/relay/src/
  sub-agents/       -- Sub-agent provider framework and visibility
```

### Task tracking

After all implementation is verified:
1. Mark all tasks 085-091 as `[x]` in EPIC.md
2. Move completed task files to `tasks/28-sub-agent-visibility/_closed/`
3. Update `tasks/SUMMARY.md` with Epic 28 status

## Acceptance Criteria

- [ ] `sub-agent-visibility.md` accurately reflects the implemented system
- [ ] `data-channel-protocol.md` documents the `"sub-agents"` topic and `sub_agent_snapshot` message
- [ ] `mobile-client.md` documents `SubAgentService` and UI widgets
- [ ] `system-overview.md` lists the `sub-agents/` relay module
- [ ] All task files marked complete and moved to `_closed/`
- [ ] `SUMMARY.md` reflects Epic 28 completion
