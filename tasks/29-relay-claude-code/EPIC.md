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
- Environment setup: `claude` binary, `ANTHROPIC_API_KEY`
- Determine Claude Code's ACP-mode flags
- Update `acp-session-config.json` for Claude Code compatibility
- Validate ACP handshake (`initialize`, `session/new`)
- Verify tool-call pulse events prevent 30s timeouts
- Verify reasoning stream delivery (`agent_thought_chunk`)
- Measure first-token latency and resource usage vs OpenClaw baseline
- Staging soak test (48h)
- Update `.env.example` and relay documentation
- Production switch (config change only)

**Out of scope:**
- Voice agent migration to Claude Code (separate initiative)
- Mobile UI changes (transparent forwarding — no rendering changes needed)
- OpenClaw deprecation (remains as fallback and voice backend)
- Conversation persistence across backend switches
- New ACP event type rendering on mobile
- `available_commands_update` parity (macro shortcuts, Epic 15)

## Tasks

- [ ] T29.1 — Environment setup: install `claude` CLI, configure `ANTHROPIC_API_KEY` in Relay environment
- [ ] T29.2 — Determine Claude Code ACP mode flags (`--acp`, `--stdio`, etc.) and validate subprocess spawns
- [ ] T29.3 — Update `acp-session-config.json` with Claude Code section; handle config negotiation based on `agentInfo.name`
- [ ] T29.4 — Test `initialize` + `session/new` handshake with Claude Code; document `agentCapabilities` and `_meta` behavior
- [ ] T29.5 — Verify tool-call pulse events (FR4): `tool_call` and `tool_call_update` during multi-tool conversations; zero 30s timeouts
- [ ] T29.6 — Verify reasoning stream delivery (FR5): `agent_thought_chunk` events arrive during extended thinking
- [ ] T29.7 — Measure first-token latency vs OpenClaw baseline (target: <3s p95, no regression)
- [ ] T29.8 — Profile subprocess resource usage: startup time, idle RSS, active RSS
- [ ] T29.9 — Staging soak test: 48h with periodic automated prompts, idle timeout recovery, cancellation
- [ ] T29.10 — Update `apps/relay/.env.example`, relay `CLAUDE.md`, and rollback procedure documentation
- [ ] T29.11 — Production switch: set `ACP_COMMAND=claude` in production `.env`

## Dependencies

| Dependency | Status | Impact |
|------------|--------|--------|
| `claude` CLI binary (`@anthropic-ai/claude-code`) | Available | Core dependency — cannot proceed without it |
| `ANTHROPIC_API_KEY` with appropriate model access | Required | Claude Code subprocess fails to authenticate without it |
| Claude Code ACP stdio mode | Must support JSON-RPC 2.0 over stdin/stdout | Cannot use as subprocess backend if unavailable |
| Relay transparent forwarding (Epic 24) | Complete | Foundation — no changes needed |
| Mobile ACP client (Epic 22, task 054) | Complete | Consumer — no changes needed |

## Acceptance Criteria

### Gate 1: Local Smoke Test (T29.1-T29.8)

- [ ] `ACP_COMMAND=claude` spawns successfully and completes ACP handshake
- [ ] Relay logs `agentInfo.name` identifying Claude Code at startup
- [ ] Single-turn text prompt returns a streamed response to mobile
- [ ] Multi-turn conversation with 3+ tool calls produces zero 30s timeouts
- [ ] `session/cancel` from mobile cancels the in-flight prompt
- [ ] `agent_thought_chunk` events observed during extended-thinking prompts
- [ ] First-token latency within 20% of OpenClaw baseline
- [ ] Subprocess resource usage documented

### Gate 2: Stability Soak (T29.9)

- [ ] 48-hour staging run with periodic automated prompts
- [ ] Zero unexpected subprocess crashes
- [ ] Zero 30s timeout events during tool-use conversations
- [ ] Relay idle disconnect + reconnect cycle works (fresh ACP session on rejoin)
- [ ] `tool_call_update` pulse rate: at least one `session/update` per 5s during active tool use

### Gate 3: Production Ready (T29.10-T29.11)

- [ ] All Gate 2 criteria sustained over 1 week
- [ ] `.env.example` updated with Claude Code configuration and `ANTHROPIC_API_KEY`
- [ ] Rollback procedure documented (switch `ACP_COMMAND` back to `openclaw`)
- [ ] Team has run real conversations on Claude Code backend without issues
