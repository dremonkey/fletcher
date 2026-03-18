# Fletcher Relay

Thin ACP bridge for Fletcher. Auto-joins LiveKit rooms via webhook when a participant connects, forwards JSON-RPC messages between mobile (data channel) and an ACP agent subprocess (stdio). The relay is a transparent bridge — it doesn't interpret content, just forwards.

Part of the Fletcher monorepo (`apps/relay`). See `docs/architecture.md` for the full design rationale.

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict mode)
- **Protocol:** ACP (Agent Client Protocol) — JSON-RPC 2.0
- **Transport:** `@livekit/rtc-node` (non-agent participant) ↔ stdio (ACP agent subprocess)
- **Backend:** Default `openclaw acp` (OpenClaw gateway). Also supports `claude-agent-acp` (Claude Agent ACP adapter). Override via `ACP_COMMAND`/`ACP_ARGS` env vars.

## Commands

- `bun run src/index.ts` — Start the relay (default port 7890, localhost only)
- `bun test` — Run tests
- `tsc --noEmit` — Type check without emitting

## Environment

```bash
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
ACP_COMMAND=openclaw           # Command to spawn ACP agent (default: openclaw). Also: claude-agent-acp
ACP_ARGS=acp                   # Args for ACP_COMMAND (default: acp). Session key passed via _meta in session/new.
RELAY_HTTP_PORT=7890           # HTTP server port (localhost only)
RELAY_IDLE_TIMEOUT_MS=1800000  # Idle room timeout (30 minutes)
```

## Project Structure

- `src/index.ts` — Entry point, Bun.serve() HTTP only (no WebSocket)
- `src/livekit/room-manager.ts` — LiveKit room connections, data channel pub/sub
- `src/livekit/participant-filter.ts` — Shared participant classification (human vs relay vs agent)
- `src/livekit/room-discovery.ts` — Startup room discovery: auto-rejoin orphaned rooms
- `src/acp/client.ts` — ACP client over stdio (spawns subprocess)
- `src/acp/types.ts` — ACP protocol types
- `src/bridge/relay-bridge.ts` — Wires data channel ↔ ACP (per-room)
- `src/bridge/bridge-manager.ts` — Manages multiple bridges, idle timeout
- `src/http/routes.ts` — HTTP endpoints (`/health`, `/rooms`, `/relay/join`, `/relay/prompt`, `/webhooks/livekit`)
- `src/http/webhook.ts` — LiveKit webhook handler (auto-joins rooms on `participant_joined`)
- `src/rpc/types.ts` — JSON-RPC 2.0 type definitions
- `src/rpc/errors.ts` — Error code constants
- `src/utils/logger.ts` — Structured JSON logging
- `src/utils/url.ts` — URL helpers (ws→http conversion for RoomServiceClient)
- `test/mock-acpx.ts` — Mock ACP agent for testing

## Claude Code Backend (claude-agent-acp)

The relay supports `@zed-industries/claude-agent-acp` as an alternative ACP backend to OpenClaw. This is Zed's ACP adapter wrapping the Claude Agent SDK.

**Setup:**
```bash
npm install -g @zed-industries/claude-agent-acp
export ACP_COMMAND=claude-agent-acp
export ACP_ARGS=""  # no args needed
```

**Auth:** Inherits `CLAUDE_CODE_OAUTH_TOKEN` from the environment (set in `~/.zshrc`). Also accepts `ANTHROPIC_API_KEY`.

**Key differences from OpenClaw:**
- `agentInfo.name`: `"@zed-industries/claude-agent-acp"` (logged at startup)
- Config options: `mode` (permission mode) and `model` (AI model selector) — no `thought_level`/`verbose_level`
- Emits `tool_call`, `tool_call_update`, `agent_thought_chunk`, `agent_message_chunk` reliably
- Session key passed via `_meta.session_key` in `session/new` (silently ignored — no cross-session persistence)
- `initialized` notification triggers a stderr warning (harmless, drained silently)

**Rollback to OpenClaw:**
```bash
export ACP_COMMAND=openclaw
export ACP_ARGS=acp
# Restart the relay — no code changes needed
```

## Conventions

- Data channel messages use ACP JSON-RPC 2.0 on topic `"relay"`
- One ACP subprocess per room (each room gets its own session)
- Tests colocated with source (e.g., `src/acp/client.spec.ts`)
- Structured JSON logging via `createLogger(component)`
- Commit often with descriptive messages
- See `docs/troubleshooting.md` for common issues (session routing, protocol quirks)
