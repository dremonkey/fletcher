# Fletcher Relay

Thin ACP bridge for Fletcher. Joins LiveKit rooms as a non-agent participant, forwards JSON-RPC messages between mobile (data channel) and an ACP agent subprocess (stdio). The relay is a transparent bridge — it doesn't interpret content, just forwards.

Part of the Fletcher monorepo (`apps/relay`). See `docs/architecture.md` for the full design rationale.

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict mode)
- **Protocol:** ACP (Agent Client Protocol) — JSON-RPC 2.0
- **Transport:** `@livekit/rtc-node` (non-agent participant) ↔ stdio (ACPX subprocess)
- **Backend:** Any ACP-compatible agent via `ACP_COMMAND` (e.g., ACPX → OpenClaw, Claude Code)

## Commands

- `bun run src/index.ts` — Start the relay (default port 7890, localhost only)
- `bun test` — Run tests
- `tsc --noEmit` — Type check without emitting

## Environment

```bash
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
ACP_COMMAND=acpx              # Command to spawn ACP agent
ACP_ARGS=                     # Optional args (space-separated)
RELAY_HTTP_PORT=7890           # HTTP server port (localhost only)
RELAY_IDLE_TIMEOUT_MS=300000   # Idle room timeout (5 minutes)
```

## Project Structure

- `src/index.ts` — Entry point, Bun.serve() HTTP only (no WebSocket)
- `src/livekit/room-manager.ts` — LiveKit room connections, data channel pub/sub
- `src/acp/client.ts` — ACP client over stdio (spawns subprocess)
- `src/acp/types.ts` — ACP protocol types
- `src/bridge/relay-bridge.ts` — Wires data channel ↔ ACP (per-room)
- `src/bridge/bridge-manager.ts` — Manages multiple bridges, idle timeout
- `src/http/routes.ts` — HTTP endpoints (`/health`, `/rooms`, `/relay/join`)
- `src/rpc/types.ts` — JSON-RPC 2.0 type definitions
- `src/rpc/errors.ts` — Error code constants
- `src/utils/logger.ts` — Structured JSON logging
- `test/mock-acpx.ts` — Mock ACP agent for testing

## Conventions

- Data channel messages use ACP JSON-RPC 2.0 on topic `"relay"`
- One ACP subprocess per room (each room gets its own session)
- Tests colocated with source (e.g., `src/acp/client.spec.ts`)
- Structured JSON logging via `createLogger(component)`
- Commit often with descriptive messages
