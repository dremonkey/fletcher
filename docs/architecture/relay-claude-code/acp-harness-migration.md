# Architecture: Relay ACP Harness Migration (OpenClaw to Claude Code)

**Initiative:** relay-claude-code
**Vision:** [vision/relay-claude-code/VISION.md](../../../vision/relay-claude-code/VISION.md)
**PRD:** [vision/relay-claude-code/PRD.relay-acp-harness.md](../../../vision/relay-claude-code/PRD.relay-acp-harness.md)

---

## 1. Decision Context

The Relay bridges mobile text-mode chat to an ACP agent subprocess over stdio. The current backend is `openclaw acp`. OpenClaw has three documented reliability issues that cascade into 30-second mobile inactivity timeouts:

- Reasoning tag streaming emits malformed `<think>` fragments
- `tool_call` / `tool_call_update` events are missing or delayed during active tool execution (BUG-051)
- Silent processing gaps exceed the mobile app's 30s inactivity timer

Claude Code (`claude` CLI) is Anthropic's reference ACP implementation. It emits `tool_call`, `tool_call_update`, `agent_message_chunk`, and `agent_thought_chunk` events consistently. Swapping the Relay's ACP backend from OpenClaw to Claude Code eliminates these reliability issues at the source.

The Relay is a transparent ACP bridge — it forwards `session/update` notifications without parsing content. This architectural property makes the swap a config-level change rather than a rewrite.

## 2. Architecture Changes

### Subprocess Swap

The only runtime change is the ACP subprocess command:

```
# Before
ACP_COMMAND=openclaw
ACP_ARGS=acp

# After (using @zed-industries/claude-agent-acp adapter)
ACP_COMMAND=claude-agent-acp
ACP_ARGS=              # empty — the adapter is a pure stdio ACP server, no flags needed
```

> **Note:** Claude Code CLI has no native ACP support (no `--acp` flag). The `claude-agent-acp` binary is a third-party Zed-maintained ACP adapter (`@zed-industries/claude-agent-acp` v0.22.1) that wraps `@anthropic-ai/claude-agent-sdk`. It is installed globally via npm.

The `AcpClient` in `packages/acp-client/` spawns whatever binary `ACP_COMMAND` resolves to and communicates via newline-delimited JSON-RPC 2.0 over stdin/stdout. The transport is backend-agnostic.

### Relay Bridge Logic

`apps/relay/src/bridge/relay-bridge.ts` requires no code changes. It:

1. Spawns the ACP subprocess via `AcpClient`
2. Sends `initialize` and receives `agentCapabilities` / `agentInfo`
3. Sends `session/new` with `_meta.session_key` and receives `sessionId`
4. Forwards `session/prompt` from mobile to ACP
5. Forwards `session/update` notifications from ACP to mobile (opaque — content not parsed)
6. Forwards `session/cancel` from mobile to ACP

All six steps are protocol-level, not implementation-specific. Claude Code implements the same ACP JSON-RPC methods.

### Session Config Negotiation

The Relay currently negotiates session config using `acp-session-config.json`:

```json
{
  "openclaw": {
    "thought_level": "adaptive",
    "agent_thought_chunk": "enabled",
    "verbose_level": "full"
  }
}
```

These are OpenClaw-specific config options sent via `session/set_config_option`. Claude Code has its own capabilities and may not recognize these keys. The config file needs a Claude Code section with its supported options, or the Relay must gracefully handle rejection of unknown config keys.

Options:
- **A (preferred):** Add a `"claude-code"` section to `acp-session-config.json` with Claude Code's supported options. The Relay selects the section based on `agentInfo.name` from the `initialize` response.
- **B (fallback):** Skip `session/set_config_option` entirely for Claude Code if it does not support config negotiation. Extended thinking and tool-call events are on by default in Claude Code.

### `_meta.session_key` Handling

The Relay passes `_meta: { session_key: "<key>" }` in `session/new` to enable conversation persistence. Claude Code may:

- Support `_meta` passthrough (ideal — conversation persistence works)
- Ignore `_meta` silently (acceptable — each session starts fresh)
- Reject `_meta` as an unknown field (requires investigation)

T29.4 validates which behavior occurs. If Claude Code ignores `_meta`, conversation persistence across Relay restarts becomes a separate concern (system prompt injection or `session/load`).

### Environment Variables

New requirement: `ANTHROPIC_API_KEY` must be set in the Relay's environment and inherited by the `claude-agent-acp` subprocess. The Zed adapter authenticates via this key through `@anthropic-ai/claude-agent-sdk`. OpenClaw authenticates differently (it runs locally with its own auth). This is a deployment config addition, not a code change.

```bash
# Required when ACP_COMMAND=claude-agent-acp
ANTHROPIC_API_KEY=sk-ant-...
```

## 3. Component Impact Analysis

| Component | Change | Details |
|-----------|--------|---------|
| `packages/acp-client/` | None | stdio transport is backend-agnostic. JSON-RPC 2.0 framing unchanged. |
| `apps/relay/` | Config only | `.env` (`ACP_COMMAND`, `ACP_ARGS`, `ANTHROPIC_API_KEY`), `acp-session-config.json` |
| `apps/relay/src/bridge/relay-bridge.ts` | None | Transparent forwarding. No content parsing. |
| `apps/mobile/` | None | Receives `session/update` events via data channel. Backend-agnostic. |
| `packages/ganglia/` | None | Voice agent is out of scope. Continues to use its own ACP connection. |
| `docs/` | Addition | This architecture doc. |
| `tasks/` | Addition | EPIC 29 task tracking. |

## 4. Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Session config incompatibility — Claude Code rejects `openclaw`-specific `set_config_option` calls | High | Low | The Relay already handles config rejection gracefully (logs warning, continues). Add Claude Code config section to `acp-session-config.json`. |
| `_meta.session_key` not supported | Medium | Medium | Test in T29.4. If unsupported, conversations start fresh per session — acceptable for MVP. Persistence via `session/load` is a follow-up. |
| Claude Code subprocess startup latency | Medium | Medium | Measure in T29.7. If >3s, explore pre-warming (persistent subprocess instead of spawn-per-session). |
| Different error/notification shapes | Low | Low | The Relay forwards errors opaquely. Mobile already handles unknown `session/update` kinds by ignoring them. |
| Resource footprint delta | Medium | Low | Profile in T29.8. Claude Code may use more memory than OpenClaw. Document and assess for single-machine deployment. |
| `available_commands_update` not emitted by Claude Code | High | Low | Affects macro shortcuts (Epic 15) only. Macros fall back to hardcoded defaults. Out of scope. |
| Voice agent still uses OpenClaw — two ACP backends coexist | N/A | N/A | By design. Voice migration is a separate initiative. Session routing via `session_key` is backend-agnostic. |

## 5. Rollback Strategy

Revert `.env` to the OpenClaw configuration:

```
ACP_COMMAND=openclaw
ACP_ARGS=acp
```

No code rollback required. No database migration. No mobile app update. The Relay restarts and spawns OpenClaw as before.

`acp-session-config.json` changes (adding a `claude-code` section) are additive and do not affect OpenClaw operation.

## 6. Verification Approach

### Local Smoke Test (Phase 1)

1. Set `ACP_COMMAND=claude-agent-acp`, start the Relay
2. Verify `initialize` response contains valid `agentInfo` and `agentCapabilities`
3. Verify `session/new` returns a `sessionId`
4. Send a single-turn prompt from mobile, confirm streamed response
5. Send a multi-turn prompt with tool use, confirm zero 30s timeouts
6. Send `session/cancel`, confirm in-flight prompt is cancelled
7. Check Relay logs for `agentInfo.name` identifying Claude Code (NFR4)

### Staging Soak (Phase 2)

1. Deploy Claude Code backend on staging for 48+ hours
2. Run periodic automated prompts: tool use, cancellation, idle timeout recovery
3. Monitor for:
   - Unexpected subprocess crashes
   - 30s timeout events
   - Memory leaks (subprocess RSS over time)
4. Compare first-token latency against OpenClaw baseline (target: no regression, <3s p95)
5. Verify `agent_thought_chunk` events arrive during extended-thinking prompts

### Metrics Comparison

| Metric | OpenClaw Baseline | Claude Code Target |
|--------|-------------------|-------------------|
| First-token latency (p95) | <3s | <3s |
| 30s timeout events per 100 tool-use turns | >0 (known issue) | 0 |
| `tool_call_update` pulse rate during tool execution | Inconsistent | At least 1 per 5s |
| `agent_thought_chunk` delivery | Malformed fragments | Structured events |
| Subprocess RSS (idle) | ~X MB (measure) | ~Y MB (measure) |
| Subprocess startup time | ~Z ms (measure) | ~W ms (measure) |
