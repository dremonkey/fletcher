# Epic 29: Relay Claude Code ACP Harness

**Status:** Planning
**Priority:** High (blocks mobile reliability)
**Vision:** [vision/relay-claude-code/VISION.md](../../vision/relay-claude-code/VISION.md)
**PRD:** [vision/relay-claude-code/PRD.relay-acp-harness.md](../../vision/relay-claude-code/PRD.relay-acp-harness.md)
**Architecture:** [docs/architecture/relay-claude-code/acp-harness-migration.md](../../docs/architecture/relay-claude-code/acp-harness-migration.md)

## Goal

Replace the Relay's ACP backend from `openclaw acp` to `claude` (Claude Code CLI) to eliminate 30-second mobile inactivity timeouts caused by missing tool-call events and malformed reasoning streams. The Relay is a transparent ACP bridge — this is a config-level swap, not a rewrite. Mobile UI, voice agent, and bridge protocol are untouched.

## Scope

**In scope:**
- Environment setup: `claude` binary, auth via `CLAUDE_CODE_OAUTH_TOKEN`
- Determine Claude Code's ACP-mode flags
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

- [ ] T29.1 — Environment setup: install `claude` CLI, verify `CLAUDE_CODE_OAUTH_TOKEN` auth in Relay environment
- [ ] T29.2 — Determine Claude Code ACP mode flags (`--acp`, `--stdio`, etc.) and validate subprocess spawns
- [ ] T29.3 — Update `acp-session-config.json` with Claude Code section; handle config negotiation based on `agentInfo.name`
- [ ] T29.4 — Test `initialize` + `session/new` handshake with Claude Code; document `agentCapabilities` and `_meta` behavior
- [ ] T29.5 — Verify tool-call pulse events (FR4): `tool_call` and `tool_call_update` during multi-tool conversations; zero 30s timeouts
- [ ] T29.6 — Verify reasoning stream delivery (FR5): `agent_thought_chunk` events arrive during extended thinking
- [ ] T29.10 — Update `apps/relay/.env.example`, relay `CLAUDE.md`, and rollback procedure documentation

## Dependencies

| Dependency | Status | Impact |
|------------|--------|--------|
| `claude` CLI binary (`@anthropic-ai/claude-code`) | Available | Core dependency — cannot proceed without it |
| `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`) | Available (`~/.zshrc`) | Claude Code subprocess fails to authenticate without it |
| Claude Code ACP stdio mode | Must support JSON-RPC 2.0 over stdin/stdout | Cannot use as subprocess backend if unavailable |
| Relay transparent forwarding (Epic 24) | Complete | Foundation — no changes needed |
| Mobile ACP client (Epic 22, task 054) | Complete | Consumer — no changes needed |

## Acceptance Criteria

### Gate 1: Local Smoke Test (T29.1-T29.6)

- [ ] `ACP_COMMAND=claude` spawns successfully and completes ACP handshake
- [ ] Relay logs `agentInfo.name` identifying Claude Code at startup
- [ ] Single-turn text prompt returns a streamed response to mobile
- [ ] Multi-turn conversation with 3+ tool calls produces zero 30s timeouts
- [ ] `session/cancel` from mobile cancels the in-flight prompt
- [ ] `agent_thought_chunk` events observed during extended-thinking prompts

### Gate 2: Production Ready (T29.10)

- [ ] `.env.example` updated with Claude Code configuration and auth notes (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`)
- [ ] Rollback procedure documented (switch `ACP_COMMAND` back to `openclaw`)
- [ ] Team has run real conversations on Claude Code backend without issues
