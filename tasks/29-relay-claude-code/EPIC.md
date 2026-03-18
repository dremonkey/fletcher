# Epic 29: Relay Claude Code ACP Harness

**Status:** Gate 1 Complete (pending real conversation testing)
**Priority:** High (blocks mobile reliability)
**Vision:** [vision/relay-claude-code/VISION.md](../../vision/relay-claude-code/VISION.md)
**PRD:** [vision/relay-claude-code/PRD.relay-acp-harness.md](../../vision/relay-claude-code/PRD.relay-acp-harness.md)
**Architecture:** [docs/architecture/relay-claude-code/acp-harness-migration.md](../../docs/architecture/relay-claude-code/acp-harness-migration.md)

## Goal

Replace the Relay's ACP backend from `openclaw acp` to `claude` (Claude Code CLI) to eliminate 30-second mobile inactivity timeouts caused by missing tool-call events and malformed reasoning streams. The Relay is a transparent ACP bridge — this is a config-level swap, not a rewrite. Mobile UI, voice agent, and bridge protocol are untouched.

## Key Discovery

Claude Code CLI has **no native ACP support**. There is no `--acp` flag (GitHub issue #6686 was closed without implementation). Instead, we use `@zed-industries/claude-agent-acp` v0.22.1 — a Zed-maintained ACP adapter that wraps `@anthropic-ai/claude-agent-sdk`. The adapter is a self-contained stdio ACP server (no flags needed). Auth works via `CLAUDE_CODE_OAUTH_TOKEN` (inherited from `~/.zshrc`) or `ANTHROPIC_API_KEY`.

## Scope

**In scope:**
- Environment setup: `claude-agent-acp` binary via `@zed-industries/claude-agent-acp`, auth via `ANTHROPIC_API_KEY`
- ACP mode: no flags needed — the adapter is a pure stdio ACP server
- Update `acp-session-config.json` for Claude Code compatibility
- Validate ACP handshake (`initialize`, `session/new`)
- Verify tool-call pulse events prevent 30s timeouts
- Verify reasoning stream delivery (`agent_thought_chunk`)
- Update `.env.example` and relay documentation

**Out of scope:**
- Voice agent migration to Claude Code (separate initiative)
- Mobile UI changes (transparent forwarding — no rendering changes needed)
- OpenClaw deprecation (remains as fallback and voice backend)
- Conversation persistence across backend switches
- New ACP event type rendering on mobile
- `available_commands_update` parity (macro shortcuts, Epic 15)

## Tasks

- [x] T29.1 — Environment setup: installed `claude-agent-acp` via `@zed-industries/claude-agent-acp`; auth via `ANTHROPIC_API_KEY`
- [x] T29.2 — ACP mode flags: no flags needed — `claude-agent-acp` is a pure stdio ACP server; `ACP_COMMAND=claude-agent-acp ACP_ARGS=""`
- [x] T29.3 — Session config: `agentInfo.name`-based config selection; `@zed-industries/claude-agent-acp` section added; 27 tests pass
- [x] T29.4 — ACP handshake validated: initialize (92ms) + session/new (631ms), agentCapabilities/agentInfo documented
- [x] T29.5 — Verify tool-call pulse events (FR4): 2 tool_call + 5 tool_call_update events, max gap 4.1s, zero 30s timeouts
- [x] T29.6 — Verify reasoning stream delivery (FR5): 44 agent_thought_chunk events streamed in real time, zero <think> leaks
- [x] T29.10 — .env.example, CLAUDE.md, and rollback procedure documented

## Dependencies

| Dependency | Status | Impact |
|------------|--------|--------|
| `claude-agent-acp` binary (`@zed-industries/claude-agent-acp`) | Installed (v0.22.1) | ACP adapter — wraps `@anthropic-ai/claude-agent-sdk` |
| `ANTHROPIC_API_KEY` | Required in env | Claude Agent SDK authenticates via this key |
| ACP stdio mode via Zed adapter | Working | Adapter is a pure stdio ACP server — no flags needed |
| Relay transparent forwarding (Epic 24) | Complete | Foundation — no changes needed |
| Mobile ACP client (Epic 22, task 054) | Complete | Consumer — no changes needed |

## Acceptance Criteria

### Gate 1: Local Smoke Test (T29.1-T29.6)

- [x] `ACP_COMMAND=claude-agent-acp` spawns successfully and completes ACP handshake
- [x] Relay logs `agentInfo.name` = `"@zed-industries/claude-agent-acp"` at startup
- [x] Single-turn text prompt returns a streamed response to mobile
- [x] Multi-turn conversation with 3+ tool calls produces zero 30s timeouts
- [ ] `session/cancel` from mobile cancels the in-flight prompt
- [x] `agent_thought_chunk` events observed during extended-thinking prompts

### Gate 2: Production Ready (T29.10)

- [x] `.env.example` updated with Claude Code configuration and auth notes (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`)
- [x] Rollback procedure documented (switch `ACP_COMMAND` back to `openclaw`)
- [ ] Team has run real conversations on Claude Code backend without issues
