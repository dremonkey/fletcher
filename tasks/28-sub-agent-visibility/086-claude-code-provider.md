# TASK-086: Claude Code Filesystem Provider

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** TASK-085 (data model and provider interface)
**Blocked By:** TASK-085

## Description

Implement `ClaudeCodeProvider` -- a `SubAgentProvider` that watches Claude Code JSONL output files to detect sub-agent activity. Claude Code writes structured JSONL logs to `~/.claude/projects/*/logs/*.jsonl`. This provider watches the log directory with `fs.watch()`, parses new lines to extract agent activity, and exposes them via `getAgents()`.

This provider is **room-independent** -- it watches the filesystem regardless of LiveKit room state. It is created at relay startup and runs for the lifetime of the relay process.

## Files

### Create

- `apps/relay/src/sub-agents/claude-code-provider.ts` — `ClaudeCodeProvider` implementing `SubAgentProvider`.

- `apps/relay/src/sub-agents/claude-code-provider.spec.ts` — Unit tests with JSONL fixture data.

### Modify

- `apps/relay/src/sub-agents/index.ts` — Add export for `ClaudeCodeProvider`.

## Implementation Notes

### File Detection

- Default path: `~/.claude/projects/` (configurable via `CLAUDE_CODE_LOG_DIR` env var).
- Use `fs.watch()` on the log directory for file creation and modification events.
- Fall back to polling (5s interval) if `fs.watch()` is unreliable (set `CLAUDE_CODE_POLL_INTERVAL_MS` env var to override, or detect failure and switch automatically).
- Each distinct JSONL log file represents a separate agent session.

### State Machine per Agent Session

Each agent session is identified by its log file path. The provider maintains a `Map<string, AgentSession>` keyed by file path.

```
File created/modified → RUNNING
  ├── New assistant entry with tool_use → update lastOutput (tool name + summary)
  ├── Entry with stop_reason: "end_turn" → COMPLETED
  ├── No new entries for 60s → COMPLETED (timeout)
  └── Parse error / file deleted → ERRORED
```

### Agent ID Construction

Prefix with `claude-code-` plus a hash or truncation of the file path:
```typescript
const id = `claude-code-${createHash("sha256").update(filePath).digest("hex").slice(0, 12)}`;
```

### Defensive Parsing

The JSONL format is undocumented and may change:
- Ignore unknown fields and unexpected entry types.
- Wrap all `JSON.parse` calls in try/catch.
- Log parse failures at debug level using the `debug` library (`import dbg from "debug"`), not at error level, to avoid log noise.
- Use `lastOutput` as a best-effort summary, not a guaranteed field.

### Resource Management

- `fs.watch()` handles are closed on `stop()`.
- Completed agents are retained for 60 seconds, then removed from `getAgents()` results. Use a periodic cleanup timer (e.g., 10s interval).
- Maximum 20 tracked agents per provider. If exceeded, evict the oldest completed agents first.
- The cleanup timer should be `unref()`-ed.
- Only read appended JSONL lines (track file offset per session), not the full file. Use `fs.stat()` to detect file size changes and `fs.createReadStream({ start: lastOffset })` to read new content.

### Logging

- Use `rootLogger.child({ component: "claude-code-provider" })` for production-level logging (info/warn/error).
- Agent detected, agent completed, provider start/stop at `info` level.
- Parse failures at `debug` level.
- Follow the two-tier logging pattern from CLAUDE.md: `logger` for production, `dbg.*` for verbose tracing.

### Key Patterns

- Constructor should accept an optional `logDir` override and optional `Logger` for testability.
- The `onChange` callback list should be a simple `() => void` array. When agent state changes, iterate and call each callback.
- `getAgents()` should filter out expired completed agents before returning.

## Tests

### `apps/relay/src/sub-agents/claude-code-provider.spec.ts`

Use `bun:test` with temporary directories for JSONL fixture files.

Test cases:
1. **No log directory** — `start()` succeeds silently; `getAgents()` returns `[]`.
2. **Parse valid JSONL** — write a fixture JSONL file with assistant entries; verify `getAgents()` returns a running agent with correct fields.
3. **Detect completion** — append an entry with `stop_reason: "end_turn"`; verify agent status transitions to `completed`.
4. **Timeout to completed** — agent with no new entries for 60s transitions to `completed` (use fake timers).
5. **Parse error resilience** — write malformed JSON; verify provider continues and `getAgents()` returns the last valid state.
6. **Agent ID uniqueness** — two different log files produce agents with different IDs.
7. **Completed agent rolloff** — completed agents are removed from `getAgents()` after 60 seconds.
8. **Max agent cap** — with 21 agents, oldest completed agent is evicted.
9. **onChange callback** — verify `onChange` callbacks are invoked when agent state changes.
10. **Stop cleanup** — `stop()` closes watchers and clears timers.

## Acceptance Criteria

- [ ] `ClaudeCodeProvider` implements `SubAgentProvider` interface
- [ ] Watches JSONL log directory with `fs.watch()` (configurable via `CLAUDE_CODE_LOG_DIR`)
- [ ] Parses JSONL entries to detect agent start, activity updates, and completion
- [ ] Agent IDs are prefixed with `claude-code-` and globally unique
- [ ] Defensive parsing: malformed JSON is caught and logged at debug level
- [ ] Completed agents retained for 60s then rolled off
- [ ] Maximum 20 tracked agents (oldest completed evicted first)
- [ ] `stop()` cleans up all file watchers and timers
- [ ] All unit tests pass with `bun test`
