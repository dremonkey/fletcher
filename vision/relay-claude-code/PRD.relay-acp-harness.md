# PRD: Relay ACP Harness — Claude Code Migration

**Status:** Draft
**Initiative:** relay-claude-code
**Depends on:** Relay text-mode ACP bridge (complete), Claude Code CLI availability

---

## 1. Background and Motivation

Fletcher's Relay bridges mobile text-mode chat to an ACP agent subprocess over stdio. The current subprocess is `openclaw acp`. OpenClaw's ACP implementation has three documented reliability issues:

- **Inconsistent reasoning tag streaming** — `<think>` blocks arrive as malformed fragments, causing parse errors in the mobile content renderer.
- **Missing/delayed tool-call events** — `tool_call` and `tool_call_update` session updates are sometimes absent during active tool execution (BUG-051, patched but fragile).
- **30-second timeout cascade** — the mobile app's inactivity timer expects at least one `session/update` every 30 seconds. Silent tool execution and stalled reasoning streams cause false timeouts.

Claude Code (`claude` CLI / `@anthropic-ai/claude-agent-sdk`) is Anthropic's reference ACP implementation. It provides reliable `session/update` event streams including `tool_call`, `tool_call_update`, `agent_message_chunk`, and `agent_thought_chunk`. Migrating the Relay's ACP backend from OpenClaw to Claude Code should eliminate these reliability issues.

The Relay is designed as a transparent ACP bridge — it forwards `session/update` notifications to mobile without parsing their content. This means the migration is primarily a configuration and compatibility exercise, not a rewrite.

---

## 2. Functional Requirements

### FR1: Environment Setup for Claude Code as ACP Backend

The Relay must be able to spawn the `claude` binary as its ACP subprocess instead of `openclaw`.

**Requirements:**
- `claude` binary is installed and available on `$PATH` (or at an absolute path specified by `ACP_COMMAND`)
- `ANTHROPIC_API_KEY` environment variable is set and available to the spawned subprocess
- The Relay's subprocess spawner passes environment variables through to the child process
- Document the required env vars in `apps/relay/.env.example`

**Acceptance criteria:**
- `ACP_COMMAND=claude ACP_ARGS="--acp"` (or equivalent flags) successfully spawns a Claude Code process that accepts JSON-RPC on stdin and emits on stdout
- The subprocess inherits `ANTHROPIC_API_KEY` from the Relay's environment

### FR2: Relay Bridge Config Update

The Relay's ACP subprocess configuration must support Claude Code without code changes.

**Requirements:**
- `ACP_COMMAND` env var accepts `claude` as a value (currently defaults to `openclaw`)
- `ACP_ARGS` env var accepts Claude Code's ACP-mode flags (TBD — likely `--acp` or similar)
- No hardcoded assumptions about the ACP backend being OpenClaw
- Fallback: `ACP_COMMAND=openclaw ACP_ARGS=acp` continues to work unchanged

**Acceptance criteria:**
- Switching between OpenClaw and Claude Code backends requires only `.env` changes, zero code changes
- Both backends can be tested by toggling env vars

### FR3: Session Config Negotiation Compatibility

The Relay's ACP handshake (`initialize` + `session/new`) must succeed with Claude Code's response format.

**Requirements:**
- The Relay's `initialize` call must be compatible with Claude Code's expected `clientInfo` and `clientCapabilities` shape
- Claude Code's `initialize` response (`agentCapabilities`, `agentInfo`) must not cause the Relay to error — the Relay should accept any valid ACP `InitializeResponse`
- `session/new` with `_meta` routing metadata must not be rejected by Claude Code. If Claude Code ignores `_meta`, that is acceptable (conversation persistence becomes a separate concern)
- The Relay must extract `sessionId` from Claude Code's `session/new` response and use it for subsequent `session/prompt` calls
- Document any differences in Claude Code's `agentCapabilities` vs. OpenClaw's (e.g., `loadSession`, `promptCapabilities`)

**Acceptance criteria:**
- `initialize` → `initialized` → `session/new` handshake completes without errors
- `sessionId` is returned and used correctly in subsequent prompts
- Relay logs the `agentInfo` from Claude Code for debugging

### FR4: Tool-Call Pulse Verification

Claude Code's `session/update` events must keep the mobile app's 30-second inactivity timer alive during tool execution.

**Requirements:**
- During tool use, Claude Code emits `tool_call` (when a tool is invoked) and `tool_call_update` (as execution progresses) session updates
- These events are forwarded by the Relay to mobile over the data channel
- The mobile app receives at least one `session/update` event within any 30-second window during active agent processing
- Verify pulse rate across common tool-use scenarios: file read, file write, code search, multi-step tool chains

**Acceptance criteria:**
- Zero 30s timeout events during a 10-turn conversation involving 3+ tool calls
- Relay logs show `tool_call` and `tool_call_update` events passing through the bridge
- Mobile receives these events and resets its inactivity timer

### FR5: Real-Time Reasoning Stream Delivery

Claude Code's extended thinking must stream to mobile as `agent_thought_chunk` events.

**Requirements:**
- When Claude Code uses extended thinking, `session/update` notifications with `sessionUpdate: "agent_thought_chunk"` stream in real time
- The Relay forwards these events without modification
- The mobile app receives them and can display reasoning content (even if the UI treatment is minimal — the events must arrive)
- No `<think>` tag parsing required — Claude Code emits structured `agent_thought_chunk` events, not raw XML tags in message content

**Acceptance criteria:**
- A prompt that triggers extended thinking produces visible `agent_thought_chunk` events in the Relay's forwarding log
- Mobile receives these events on the data channel
- No malformed content blocks or parse errors related to reasoning tags

---

## 3. Non-Functional Requirements

### NFR1: Latency

First-token latency (time from `session/prompt` to first `agent_message_chunk`) must not regress compared to the OpenClaw baseline. Target: < 3 seconds p95.

### NFR2: Subprocess Lifecycle

The Relay's existing subprocess management (spawn on room join, kill on room leave / idle timeout) must work with `claude` the same way it works with `openclaw`. No orphan processes after Relay shutdown.

### NFR3: Resource Usage

Claude Code's subprocess memory and CPU usage should be profiled during Phase 1. If significantly higher than OpenClaw, document the delta and assess whether it impacts single-machine deployment.

### NFR4: Logging

The Relay must log the ACP backend identity (`agentInfo.name` from `initialize` response) at startup so operators can confirm which backend is active without checking `.env`.

---

## 4. Out of Scope

| Item | Rationale |
|------|-----------|
| Voice agent migration to Claude Code | Separate initiative. Voice agent has its own ACP connection and different requirements (extensions like `_fletcher/voice/inject`). |
| Mobile UI changes | The Relay is transparent. Mobile already handles `session/update` events. No UI work needed unless Claude Code emits new event types that need rendering. |
| OpenClaw deprecation | OpenClaw remains the fallback backend and continues to serve the voice agent. No removal planned. |
| Conversation persistence across backend switches | If a session starts on OpenClaw and switches to Claude Code (or vice versa), history continuity is not guaranteed. This is acceptable for the test/staging phases. |
| New ACP event types | If Claude Code emits `session/update` kinds that the mobile app does not recognize, they are silently ignored (existing behavior). No new mobile-side parsing. |
| WebSocket transport for Claude Code | The Relay uses stdio transport for local deployment. WebSocket transport for Claude Code is not in scope. |
| `available_commands_update` parity | Claude Code may not emit the same slash-command discovery events as OpenClaw. This affects macro shortcuts (Epic 15) but not core chat functionality. |

---

## 5. Dependencies

| Dependency | Status | Impact if missing |
|------------|--------|-------------------|
| `claude` CLI binary | Available (`@anthropic-ai/claude-code` npm package) | Cannot proceed. Core dependency. |
| `ANTHROPIC_API_KEY` | Requires valid API key with appropriate model access | Claude Code subprocess fails to authenticate. |
| Claude Code ACP mode | Must support stdio JSON-RPC (ACP over stdin/stdout) | Cannot use as subprocess backend. Verify with `claude --help` or docs. |
| ACP spec compatibility | Claude Code must implement `initialize`, `session/new`, `session/prompt`, `session/update`, `session/cancel` | Partial: any missing method blocks the corresponding feature. |
| Relay transparent forwarding | Complete (current architecture) | N/A — already working. |
| Mobile 30s inactivity timer | Exists in current mobile app | N/A — this is the problem we are solving, not a dependency. |

---

## 6. Acceptance Criteria

### Gate 1: Local Smoke Test (Phase 1)

- [ ] `ACP_COMMAND=claude` spawns successfully and completes ACP handshake
- [ ] A single-turn text prompt returns a streamed response to mobile
- [ ] A multi-turn conversation with tool calls produces no 30s timeouts
- [ ] `session/cancel` from mobile cancels the in-flight prompt
- [ ] Relay logs show `agentInfo.name` identifying Claude Code

### Gate 2: Stability Soak (Phase 2)

- [ ] 48-hour staging run with periodic automated prompts
- [ ] Zero unexpected subprocess crashes
- [ ] Zero 30s timeout events during tool-use conversations
- [ ] First-token latency within 20% of OpenClaw baseline
- [ ] `agent_thought_chunk` events observed during extended-thinking prompts
- [ ] Relay idle disconnect + reconnect cycle works (fresh ACP session on rejoin)

### Gate 3: Production Ready (Phase 3)

- [ ] All Gate 2 criteria sustained over 1 week
- [ ] Documented rollback procedure (switch `ACP_COMMAND` back to `openclaw`)
- [ ] `.env.example` updated with Claude Code configuration
- [ ] Team has run real conversations on Claude Code backend without issues

---

## 7. Phased Rollout Plan

### Phase 1: Local Validation (1-2 days)

**Goal:** Prove the Relay can spawn and communicate with Claude Code over ACP stdio.

- Install `claude` CLI in the dev environment
- Set `ACP_COMMAND=claude`, determine correct `ACP_ARGS` for ACP mode
- Run the Relay, verify `initialize` + `session/new` handshake
- Send test prompts from mobile, observe `session/update` events
- Document any session config differences (FR3)
- Profile subprocess resource usage (NFR3)

### Phase 2: Staging Soak (2-3 days)

**Goal:** Validate reliability under sustained use.

- Deploy Claude Code backend on staging instance
- Run automated prompt sequences (tool use, cancellation, idle timeout recovery)
- Monitor for timeout events, subprocess stability, memory leaks
- Compare latency metrics against OpenClaw baseline
- Verify extended thinking streams (FR5)

### Phase 3: Production Switch (1 day)

**Goal:** Make Claude Code the default text-mode backend.

- Update production `.env` to `ACP_COMMAND=claude`
- Monitor first 24 hours for regressions
- Keep OpenClaw config documented as rollback option
- Update `apps/relay/.env.example` and `apps/relay/CLAUDE.md`

**Total estimated timeline: 4-6 days.**
