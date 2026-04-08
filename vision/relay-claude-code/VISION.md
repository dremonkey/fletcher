# Relay Claude Code ACP Harness — Vision

## Problem Statement

Fletcher is an open-source mobile ACP client — any ACP-compatible agent plugs in via `ACP_COMMAND`. The Relay bridges mobile chat to the ACP agent over stdio. The initial backend was OpenClaw's `openclaw acp` subprocess. This works but has three reliability problems:

1. **Reasoning tag streaming is inconsistent.** OpenClaw's ACP implementation emits `<think>` tags in ways that break downstream parsing — sometimes mid-chunk, sometimes as separate fragments, sometimes not at all. The mobile app receives malformed content blocks.
2. **Tool-call update events are unreliable.** BUG-051 documented missing or delayed `tool_call` and `tool_call_update` session updates. The patch landed but the underlying event-emission code is fragile — it depends on OpenClaw's internal LLM-response parser correctly identifying tool boundaries in real time.
3. **These gaps trigger 30-second inactivity timeouts.** The mobile app resets a 30s timer on every valid `session/update`. When tool calls run silently (no `tool_call_update` pulses) or reasoning blocks stall (no `agent_thought_chunk`), the timer expires and the app shows a timeout error — even though the agent is actively working.

The root cause is that OpenClaw's ACP implementation is a custom build that does not track the evolving ACP specification closely. It reimplements streaming, event emission, and session lifecycle from scratch rather than consuming a reference implementation.

## Vision

Replace the Relay's ACP backend with the official Claude Code binary (`claude` CLI / `@anthropic-ai/claude-agent-sdk`). Claude Code is Anthropic's reference ACP implementation — it is the canonical source of ACP event streams, maintained by the same team that writes the spec.

The Relay remains a transparent ACP bridge. It does not parse `session/update` content. It forwards events from the ACP agent to mobile over the LiveKit data channel. By swapping the subprocess from `openclaw acp` to `claude`, the Relay inherits Claude Code's mature, well-tested event stream without any changes to the bridge logic itself.

This is a **backend swap, not a user-facing feature change**. Mobile UI, voice agent, and the Relay's bridge protocol are untouched. The user sees the same chat interface — it just stops timing out.

## ICP

Power users and developers running Fletcher for voice/text AI assistance on mobile. They use text-mode chat for multi-turn conversations that involve tool use (file reads, code generation, memory lookups). They need real-time streaming that does not stall or drop events during tool execution.

## Value Proposition

- **Reliability:** Claude Code emits `tool_call`, `tool_call_update`, `agent_message_chunk`, and `agent_thought_chunk` events consistently. The mobile 30s inactivity timeout stops firing during normal tool-use conversations.
- **Reasoning visibility:** Extended thinking streams arrive as `agent_thought_chunk` events in real time, keeping the mobile UI alive and giving users visibility into the agent's reasoning process.
- **Spec compliance:** As Anthropic maintains both the ACP spec and the Claude Code implementation, protocol drift is minimized. Future ACP features arrive in Claude Code first.
- **Simplicity:** The Relay's transparent forwarding design means the swap is a config change (`ACP_COMMAND` + `ACP_ARGS`) plus session-negotiation compatibility work — not a rewrite.

## Positioning

This initiative is **infrastructure hardening**, not a new feature. From the user's perspective, nothing changes except that text-mode chat becomes more reliable. There is no new UI, no new capability, no marketing moment. The value is negative: things that currently break will stop breaking.

Within Fletcher's product arc:
- Voice mode (shipped) — uses its own ACP connection to OpenClaw
- Text mode (shipped) — uses Relay ACP bridge to OpenClaw
- **Text mode hardened (this)** — same Relay bridge, Claude Code backend
- Voice mode migration (future, out of scope) — voice agent switches to Claude Code

## Success Metrics

| Metric | Target | How measured |
|--------|--------|--------------|
| 30s timeout events during tool-use conversations | Zero | Mobile error logs / session recordings |
| Reasoning stream delivery | Visible `agent_thought_chunk` events in mobile transcript | Manual verification in test env |
| Tool-call pulse rate | At least one `session/update` event per 5s during active tool use | Relay stdout log analysis |
| First-token latency | No regression vs. OpenClaw baseline (< 3s p95) | Timestamp diff: `session/prompt` sent to first `agent_message_chunk` received |
| Session initialization | Successful `initialize` + `session/new` handshake | Relay startup logs |

## Launch Narrative

**Phase 1: Test environment (local dev)**
Stand up Claude Code as the ACP backend in a local Fletcher instance. Verify the `initialize` / `session/new` handshake succeeds, `session/update` events stream correctly, and mobile receives them without parsing errors. Run through a standard tool-use conversation (file read, code edit, memory search) and confirm zero timeouts.

**Phase 2: Staging (extended soak)**
Run Claude Code backend for all text-mode sessions on a staging instance for 48+ hours. Monitor for edge cases: long-running tool calls, rapid prompt cancellation (`session/cancel`), session reconnection after Relay idle timeout. Compare event pulse rate and latency against OpenClaw baseline.

**Phase 3: Production (default backend)**
Switch the production Relay's `ACP_COMMAND` from `openclaw` to `claude`. OpenClaw remains available as a fallback (`ACP_COMMAND=openclaw ACP_ARGS=acp` in .env). No code deployment required — config change only.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude Code's ACP session config differs from OpenClaw's (different capabilities, different `session/new` response shape) | Relay or mobile fails to initialize | FR3: verify session config negotiation in test env before staging. The Relay is transparent — it only cares about `sessionId` in the response. |
| Claude Code does not support `_meta.session_key` routing for conversation persistence | Conversations reset on every Relay reconnect | Test `_meta` passthrough. If unsupported, implement conversation persistence at the Claude Code level (system prompt injection or `session/load`). |
| Claude Code subprocess startup is slower than OpenClaw | Higher first-turn latency | Measure in Phase 1. If significant, explore pre-warming or persistent subprocess (keep-alive instead of spawn-per-session). |
| Claude Code requires `ANTHROPIC_API_KEY` — different auth model than OpenClaw | Deployment config change | Document env var requirements. Non-blocking — just a config addition. |
| OpenClaw-specific ACP extensions (`available_commands_update` with OpenClaw command set) may not exist in Claude Code | Macro shortcuts (Epic 15) lose dynamic command discovery | Out of scope for this initiative. Macros can fall back to hardcoded defaults. |
| Voice agent still uses OpenClaw — two different ACP backends in the same system | Conversation state divergence if both write to the same session | Voice agent migration is explicitly out of scope. Session routing via `session_key` is backend-agnostic — both OpenClaw and Claude Code can share the same conversation if they respect the key. |
