# TASK-091: Architecture Docs and Task Tracking

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** TASK-088 (relay integration), TASK-090 (Flutter UI)
**Blocked By:** TASK-088, TASK-090

## Description

Update architecture documentation to reflect the sub-agent visibility feature. This is the final task in the epic -- all implementation must be complete before docs are finalized.

The architecture doc `docs/architecture/sub-agent-visibility.md` was created during planning (Stage 2). After implementation, review it against the actual code and update any discrepancies. Also update adjacent architecture docs that reference or are affected by this feature.

## Files

### Modify

- `docs/architecture/sub-agent-visibility.md` — Review and update to match actual implementation. Verify all code snippets, file paths, interface signatures, and behavioral descriptions are accurate.

- `docs/architecture/data-channel-protocol.md` — Add the `"sub-agents"` topic to the Transport Channels table (currently only lists `lk.transcription` and `ganglia-events`). Document the `SubAgentSnapshot` message format and delivery semantics.

- `docs/architecture/mobile-client.md` — Add `SubAgentService` to the service architecture section. Add `SubAgentChip`, `SubAgentCard`, and `SubAgentPanel` to the widget catalog.

- `docs/architecture/system-overview.md` — If the relay section doesn't mention sub-agent monitoring, add a brief mention of the provider framework.

- `docs/architecture/README.md` — Verify `sub-agent-visibility.md` is listed in the document index.

- `tasks/28-sub-agent-visibility/EPIC.md` — Mark all completed tasks as `[x]`. Verify Key Files section matches actual file paths.

- `tasks/SUMMARY.md` — Add Epic 28 entry with task status.

## Implementation Notes

### Architecture Doc Review Checklist

After implementation, review `docs/architecture/sub-agent-visibility.md` against:

1. **Interface signatures** — Does `SubAgentProvider` still have exactly `name`, `start()`, `stop()`, `getAgents()`, `onChange()`? Or were methods added/changed?
2. **Registry behavior** — Is the debounce interval still 1s? Is the room-scoping still "publish to all active rooms"?
3. **Wire protocol** — Is the topic name still `"sub-agents"`? Is the snapshot format unchanged?
4. **Claude Code Provider** — What path pattern is actually used? Is `fs.watch()` the primary mechanism or did polling become the default? What's the actual timeout value?
5. **OpenClaw Provider** — Is `feedEvent()` the actual method name? What events does it actually process?
6. **Flutter widgets** — Do the widget names and locations match? Is the bottom sheet height still 55%?
7. **Failure modes** — Were any new failure modes discovered during implementation? Any that were documented but turned out to be non-issues?

### Data Channel Protocol Update

Add a new row to the Transport Channels table in `data-channel-protocol.md`:

```markdown
| `sub-agents` | LiveKit Data Channel | Relay → Client | Sub-agent snapshot (full replacement, debounced 1s) |
```

Add a new section documenting the snapshot format, matching the style of the existing "Ganglia Events" section.

### Mobile Client Update

The mobile-client architecture doc should include:
- `SubAgentService` in the services section (similar to how `HealthService`, `RelayChatService` are documented)
- Widget hierarchy: `SubAgentChip` in DiagnosticsBar → `SubAgentPanel` → `SubAgentCard`

### SUMMARY.md Update

Add Epic 28 to the epics list:

```markdown
### 28. [Sub-Agent Visibility](./28-sub-agent-visibility) 🔄
Monitor backend sub-agents (Claude Code, OpenClaw) and display their status in the Flutter app.

**Tasks:**
- [x] 085: Sub-agent data model, provider interface, and registry
- [x] 086: Claude Code filesystem provider
- [x] 087: OpenClaw passive provider
- [x] 088: Relay bridge integration
- [x] 089: Flutter SubAgentService + data model
- [x] 090: Flutter sub-agent UI widgets
- [x] 091: Architecture docs + task tracking
```

## Tests

No new tests. This is a documentation task.

## Acceptance Criteria

- [ ] `docs/architecture/sub-agent-visibility.md` reflects actual implementation (no stale snippets or paths)
- [ ] `docs/architecture/data-channel-protocol.md` includes `"sub-agents"` topic documentation
- [ ] `docs/architecture/mobile-client.md` includes SubAgentService and widget descriptions
- [ ] `docs/architecture/README.md` lists the sub-agent-visibility doc
- [ ] `tasks/28-sub-agent-visibility/EPIC.md` has all tasks marked `[x]`
- [ ] `tasks/SUMMARY.md` includes Epic 28 with accurate status
