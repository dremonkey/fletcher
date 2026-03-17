# TASK-087: OpenClaw Passive Provider

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** TASK-085 (data model and provider interface)
**Blocked By:** TASK-085

## Description

Implement `OpenClawProvider` -- a `SubAgentProvider` that passively captures sub-agent status from ACP `session/update` events that already flow through `RelayBridge`. Unlike `ClaudeCodeProvider` (which watches the filesystem), this provider receives events via a `feedEvent()` method called from the bridge's `onUpdate` handler.

This provider is **per-bridge** -- each `RelayBridge` instance has its own `OpenClawProvider` (or shares one provider with per-room scoping). The provider does NOT open its own connection to OpenClaw; it piggybacks on the existing ACP event stream.

## Files

### Create

- `apps/relay/src/sub-agents/openclaw-provider.ts` — `OpenClawProvider` implementing `SubAgentProvider`, plus a `feedEvent(params: SessionUpdateParams)` method.

- `apps/relay/src/sub-agents/openclaw-provider.spec.ts` — Unit tests with sample `SessionUpdateParams` objects.

### Modify

- `apps/relay/src/sub-agents/index.ts` — Add export for `OpenClawProvider`.

## Implementation Notes

### Integration Approach

The provider exposes a `feedEvent(params)` method that the bridge calls from its `onUpdate` handler. This is the recommended approach from the architecture doc. The wiring happens in TASK-088, but the provider must be designed for it now.

```typescript
export class OpenClawProvider implements SubAgentProvider {
  readonly name = "openclaw";

  /** Called by RelayBridge's onUpdate handler to feed ACP events. */
  feedEvent(params: SessionUpdateParams): void {
    // Extract agent signals from update metadata
  }
}
```

### Event Detection Heuristics

The `SessionUpdateParams` type is imported from `@fletcher/acp-client` (see `apps/relay/src/bridge/relay-bridge.ts` line 10). The provider examines the `update.sessionUpdate` field:

- `"tool_call"` with sub-agent-related tool names → agent started or continuing. Extract tool name from `update.content` or `update.toolName`.
- `"agent_message_chunk"` → agent is actively generating (update `lastActivityAt`).
- `"end_turn"` → prompt completed, mark any running agents as `completed`.
- Other updates → ignore or use as heartbeat to update `lastActivityAt`.

### Graceful Degradation

If OpenClaw does not emit granular sub-agent metadata, the provider falls back to showing a **single "OpenClaw" agent** with coarse status:
- When `feedEvent()` is called with any update → status `"running"`.
- When the prompt completes (end_turn) → status `"completed"`.
- This is still useful -- it tells the user something is happening.

### Agent Lifecycle

- Agent sessions are scoped to a prompt turn. When a new `session/prompt` starts (detectable via a `feedEvent` call after an `end_turn`), the provider clears previous agents and starts fresh.
- Completed agents are retained for 60 seconds, matching `ClaudeCodeProvider` behavior.
- Agent IDs are prefixed with `openclaw-` plus a unique suffix (e.g., timestamp or random hex).

### Logging

- Use `rootLogger.child({ component: "openclaw-provider" })` for production logging.
- Log event type and status transitions at `debug` level.
- Log agent detected/completed at `info` level.

### Key Patterns

- The `start()` and `stop()` methods are lightweight since the provider doesn't own its data source. `start()` is a no-op or sets an `active` flag. `stop()` clears tracked agents and cancels any rolloff timers.
- The provider tracks a `Map<string, SubAgentInfo>` of current agents. `getAgents()` returns the values filtered for rolloff.
- The `onChange` callback fires after `feedEvent()` processes an event that changes agent state.

### SessionUpdateParams Structure

From examining `relay-bridge.ts` lines 167-219, the `onUpdate` handler receives `params` of type `SessionUpdateParams`. The key field is:
```typescript
const updateKind = (params as any).update?.sessionUpdate;
// Known values: "agent_message_chunk", "tool_call", "tool_call_update", "end_turn"
```

The provider should extract:
- `updateKind` for lifecycle transitions
- `(params as any).update?.content` for lastOutput/task description
- `(params as any).update?.toolName` for tool call identification

## Tests

### `apps/relay/src/sub-agents/openclaw-provider.spec.ts`

Use `bun:test`.

Test cases:
1. **No events** — `getAgents()` returns `[]` before any `feedEvent` calls.
2. **First event creates agent** — `feedEvent` with `tool_call` creates a running agent with `openclaw-` prefixed ID.
3. **Chunk events update lastActivityAt** — `agent_message_chunk` events update `lastActivityAt` without creating new agents.
4. **End turn completes agent** — `end_turn` event transitions running agent to `completed` with `completedAt` set.
5. **Coarse fallback** — when events lack granular sub-agent metadata, a single "OpenClaw" agent is shown with running/completed status.
6. **Completed agent rolloff** — completed agents removed from `getAgents()` after 60s.
7. **onChange fires on state change** — callback invoked when `feedEvent` changes agent state.
8. **onChange does NOT fire on no-op events** — callback not invoked when event doesn't change state (e.g., duplicate chunk).
9. **Stop clears state** — `stop()` clears all tracked agents and timers.
10. **New prompt resets state** — after `end_turn`, a subsequent `tool_call` starts a fresh agent session.

## Acceptance Criteria

- [ ] `OpenClawProvider` implements `SubAgentProvider` interface
- [ ] `feedEvent(params)` method processes `SessionUpdateParams` from ACP event stream
- [ ] Detects agent start from `tool_call` events and completion from `end_turn`
- [ ] Falls back to single "OpenClaw" agent with coarse status when granular metadata is unavailable
- [ ] Agent IDs prefixed with `openclaw-`
- [ ] Completed agents retained 60s then rolled off
- [ ] `onChange` callbacks fire on state changes
- [ ] `stop()` clears tracked agents and timers
- [ ] All unit tests pass with `bun test`
