# TASK-086: Claude Code Filesystem Provider

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** 085
**Blocked By:** 085

## Description

Implement `ClaudeCodeProvider` — a `SubAgentProvider` that watches Claude Code's JSONL log output to detect sub-agent sessions, track their status, and report activity.

This provider is **room-independent**: it watches a filesystem path and lives for the relay process lifetime. It does not need to know about rooms or bridges.

## Files

### Create

- `apps/relay/src/sub-agents/claude-code-provider.ts` — Provider implementation
- `apps/relay/src/sub-agents/claude-code-provider.spec.ts` — Unit tests

### Modify

- `apps/relay/src/sub-agents/index.ts` — Add export

## Implementation Notes

### File detection

- Default path: `~/.claude/projects/*/logs/*.jsonl` (override via `CLAUDE_CODE_LOG_DIR` env var)
- Use `fs.watch()` on the log directory for file creation and modification events
- If `fs.watch()` is unreliable (known issue on some Linux filesystems), fall back to polling at 5-second intervals

### State machine per agent session

Each JSONL log file maps to one agent session. Track state per file:

```
File created/modified → RUNNING
  ├── New assistant entry with tool_use → update lastOutput (tool name + args summary)
  ├── Entry with stop_reason: "end_turn" → COMPLETED
  ├── No new entries for 60s → COMPLETED (timeout)
  └── Parse error / file deleted → ERRORED
```

### Agent ID

Prefix with provider name for global uniqueness: `claude-code-<hash>` where `<hash>` is derived from the log file path.

### Task extraction

The `task` field should be the first user message or a summary of what the agent was asked to do. Extract from the first JSONL entry with `role: "user"`.

### Model extraction

Look for entries with `model` field in the JSONL. Claude Code typically includes the model in assistant entries.

### Defensive parsing

- Wrap all `JSON.parse()` in try/catch
- Ignore unknown fields and entry types
- Log parse failures at `debug` level (not error)
- `lastOutput` is best-effort — if parsing fails, use a generic "Working..." message

### Resource management

- Close `fs.watch()` handles on `stop()`
- Completed agents retained for 60 seconds, then removed from `getAgents()` results
- Maximum 20 tracked agents (oldest completed evicted first)
- Track file read positions to only parse new lines (not re-read entire file)

## Tests

File: `apps/relay/src/sub-agents/claude-code-provider.spec.ts`

1. Detects new agent session from JSONL file creation
2. Extracts task from first user message entry
3. Updates lastOutput on tool_use entries
4. Transitions to COMPLETED on end_turn entry
5. Transitions to COMPLETED on 60s inactivity timeout
6. Transitions to ERRORED on file deletion
7. Handles malformed JSONL lines gracefully (skips, no crash)
8. Agent ID is prefixed with `claude-code-`
9. Completed agents removed after 60s retention
10. `stop()` cleans up file watchers

Use temp directories with fixture JSONL files for testing.

## Acceptance Criteria

- [ ] Provider watches Claude Code log directory and detects new sessions
- [ ] Task field extracted from user message in JSONL
- [ ] Status transitions follow the state machine (RUNNING → COMPLETED/ERRORED)
- [ ] lastOutput updates on tool_use entries
- [ ] Inactivity timeout (60s) marks agent as completed
- [ ] Defensive parsing: malformed entries skipped without crash
- [ ] Agent IDs globally unique with `claude-code-` prefix
- [ ] Completed agents roll off after 60s
- [ ] `stop()` closes all file watchers
- [ ] All 10 tests pass
