# TASK-087: OpenClaw Passive Provider

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** 085
**Blocked By:** 085

## Description

Implement `OpenClawProvider` — a `SubAgentProvider` that passively captures sub-agent information from ACP `session/update` events flowing through `RelayBridge`.

Unlike the Claude Code provider, this provider does NOT watch a separate data source. It receives events via a `feedEvent()` method called from the bridge's existing `onUpdate` handler.

## Files

### Create

- `apps/relay/src/sub-agents/openclaw-provider.ts` — Provider implementation
- `apps/relay/src/sub-agents/openclaw-provider.spec.ts` — Unit tests

### Modify

- `apps/relay/src/sub-agents/index.ts` — Add export

## Implementation Notes

### Integration approach

The provider exposes a `feedEvent(params: SessionUpdateParams)` method. This is called from `RelayBridge`'s `onUpdate` handler (wired in TASK-088). The provider does NOT create its own connections.

```typescript
class OpenClawProvider implements SubAgentProvider {
  feedEvent(params: SessionUpdateParams): void {
    // Extract sub-agent signals from params
    // Update internal agent state
    // Call onChange callback if state changed
  }
}
```

### Event detection heuristics

Extract the update kind from `(params as any).update?.sessionUpdate`:

- `"tool_call"` with sub-agent tool names → agent started or continuing
- `"agent_message_chunk"` → agent is actively producing output (already detected at relay-bridge.ts line 173)
- `"end_turn"` → agent completed
- Any activity without specific sub-agent metadata → fall back to showing a single "OpenClaw" agent

### Graceful degradation

If OpenClaw does not emit granular sub-agent metadata (which is the current state), the provider degrades to:
- Show a single agent with `id: "openclaw-session"`, `task: "Processing request"`, `status: "running"`
- Transition to `completed` when no events received for 10 seconds after last activity
- This still provides value — it tells the user something is happening

### Agent ID

Use `openclaw-<sessionKey>` or `openclaw-<requestId>` depending on available metadata.

### Resource management

- No file watchers or connections to clean up
- `stop()` clears internal state and any timeout timers
- Use `.unref()` on timeout timers

## Tests

File: `apps/relay/src/sub-agents/openclaw-provider.spec.ts`

1. `feedEvent()` with tool_call creates a new agent entry
2. `feedEvent()` with agent_message_chunk updates lastActivityAt
3. `feedEvent()` with end_turn transitions agent to COMPLETED
4. Multiple feed events update the same agent (not create duplicates)
5. Inactivity timeout (10s) marks agent as completed
6. Graceful degradation: shows single coarse agent when no sub-agent metadata present
7. `getAgents()` returns current state
8. `onChange` callback fires on state change
9. `stop()` clears state and timers
10. Unknown event types are ignored without error

## Acceptance Criteria

- [ ] Provider implements `SubAgentProvider` interface
- [ ] `feedEvent()` method accepts `SessionUpdateParams` and extracts agent signals
- [ ] Agent status transitions: running → completed on end_turn or inactivity
- [ ] Graceful degradation to single coarse "OpenClaw" agent when metadata is sparse
- [ ] Agent IDs prefixed with `openclaw-`
- [ ] Timeout timers use `.unref()`
- [ ] `stop()` cleans up all state and timers
- [ ] All 10 tests pass
