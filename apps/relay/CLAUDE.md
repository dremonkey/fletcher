# Fletcher Relay

Unified AI gateway for Fletcher. Bridges both the text path (mobile → LiveKit data channel) and the voice path (livekit-agent → Ganglia) to a swappable backend. Connects to LiveKit as a non-agent participant for text sessions; exposes an OpenAI-compatible HTTP endpoint for voice sessions via Ganglia.

Part of the Fletcher monorepo (`apps/relay`). See `docs/architecture.md` for the full design rationale and `tasks/22-dual-mode/EPIC.md` (repo root) for the dual-mode architecture epic.

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict mode)
- **Protocol:** JSON-RPC 2.0 over LiveKit data channel (WebRTC)
- **Transport:** `@livekit/rtc-node` (non-agent participant)
- **Backend:** Swappable via `RELAY_BACKEND` — `openclaw` (OpenClaw Gateway) or `claude` (Claude Agent SDK)

## Commands

- `bun run src/index.ts` — Start the server (default port 3000)
- `bun test` — Run tests
- `tsc --noEmit` — Type check without emitting

## Project Structure

- `src/index.ts` — Entry point, Bun.serve() with WS + HTTP
- `src/rpc/` — JSON-RPC types, errors, and dispatch handler
- `src/session/` — Session manager, state types, agent bridge
- `src/http/` — Health and status HTTP endpoints
- `test/` — Integration tests

## Conventions

- All WebSocket messages use JSON-RPC 2.0 format
- Sessions are identified by short UUIDs (8 chars)
- Agent SDK interactions are isolated in agent-bridge.ts
- Commit often with descriptive messages
