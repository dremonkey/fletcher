## ⚠️ Architecture Update: Modal Separation — 2026-03-10

We have decided to move away from a "single hybrid agent" model to a clear **Modal Distinction** strategy. This simplifies the orchestration and aligns with standard AI application patterns.

- **Standard Tier (Chat Mode):** Handled by the **Fletcher Relay** as a lightweight LiveKit participant. This mode is the default for text, photo uploads, and asynchronous tasks. It uses request-response or data-channel JSON-RPC and is highly cost-efficient. Available to all users.
- **Premium Tier (Live Voice Mode):** Handled by the **Transient Voice Agent**. This mode is activated by explicit user cues (e.g., tapping the microphone). It enables the full STT/TTS/VAD stack and justifies the higher per-minute agent cost. **This could be part of a premium upgrade**, allowing us to keep the voice agent connected longer or persistent for paying users while the base tier remains free and reliable on text.
- **Mutual Exclusion:** When one mode is active, the other should be in a passive standby or disconnected state to avoid double-processing and resource waste.
- **Handoff:** The system will use Room Metadata or specific Data Channel signals to coordinate the "handover" between the text relay and the voice agent.
- **Business Model:** By making Live Voice a paid upgrade, we can justify keeping the voice agent mostly connected for premium users, eliminating many of the "transient agent" stability issues. The free tier stays rock-solid on the lightweight relay.

---

# EPIC: Claude Relay — Local Agent SDK over WebSocket

> **⚠️ Architecture pivot — 2026-03-10**
> Transport changed from raw WebSocket to **LiveKit data channel** (non-agent participant).
> Backend changed from Claude Agent SDK to **OpenClaw Gateway**.
> See `docs/architecture.md` for rationale. Tasks in this epic need revision before implementation.

**Status:** Not Started
**Owner:** Glitch

## Problem

We want to expose Claude Code's full agentic capabilities (tool use, sub-agents, file ops, questions) through a mobile interface. This requires bidirectional, async communication — the agent can push questions/updates at any time, and the user can send new instructions while agents work in the background.

HTTP REST is insufficient because it's request-response. We need **WebSocket + JSON-RPC 2.0** for full-duplex messaging.

## Solution

A standalone Bun project (`fletcher-relay`) that:

- Wraps `@anthropic-ai/claude-agent-sdk` behind a WebSocket server
- Uses JSON-RPC 2.0 as the wire protocol
- Intercepts `canUseTool` callbacks to push questions/approvals to the mobile client
- Supports streaming input so users can send messages into a running agent session
- Exposes thin HTTP endpoints for health/status

## Architecture

```
Mobile App  ←— WebSocket (JSON-RPC 2.0) —→  fletcher-relay (Bun)
                                                  │
                                                  ├─ Session Manager
                                                  │    └─ session map (id → state)
                                                  │
                                                  └─ Agent SDK
                                                       ├─ query() async generator
                                                       ├─ canUseTool callback → push question to client
                                                       └─ streaming input → accept user messages mid-task
```

## JSON-RPC Protocol

### Client → Server (requests)

| Method             | Params                          | Description                        |
|--------------------|---------------------------------|------------------------------------|
| `session/new`      | `{ prompt }`                    | Start a new agent session          |
| `session/message`  | `{ sessionId, content }`        | Send message to running session    |
| `session/resume`   | `{ sessionId, prompt }`         | Resume a previous session          |
| `session/cancel`   | `{ sessionId }`                 | Cancel running task                |
| `session/list`     | —                               | List active sessions               |

### Server → Client (notifications)

| Method              | Params                                      | Description                    |
|---------------------|---------------------------------------------|--------------------------------|
| `session/update`    | `{ sessionId, type, content }`              | Streaming text from agent      |
| `session/question`  | `{ sessionId, questions }`                  | Agent asks user a question     |
| `session/approval`  | `{ sessionId, tool, input }`                | Agent requests tool approval   |
| `session/complete`  | `{ sessionId, result }`                     | Agent task completed           |
| `session/error`     | `{ sessionId, error }`                      | Agent error                    |

## File Structure

```
apps/relay/
├── package.json
├── tsconfig.json
├── CLAUDE.md
├── src/
│   ├── index.ts              # Entry point — Bun.serve() with WS + HTTP
│   ├── rpc/
│   │   ├── handler.ts        # JSON-RPC dispatch (method → handler mapping)
│   │   ├── types.ts          # JSON-RPC type definitions
│   │   └── errors.ts         # Standard JSON-RPC error codes
│   ├── session/
│   │   ├── manager.ts        # Session lifecycle (create, resume, cancel, list)
│   │   ├── agent-bridge.ts   # Wraps Agent SDK query() ↔ JSON-RPC notifications
│   │   └── types.ts          # Session state types
│   └── http/
│       └── routes.ts         # GET /health, GET /sessions
└── test/
    └── echo.test.ts          # Basic WebSocket round-trip test
```

## Tasks

| #   | File                            | Summary                              | Depends On |
|-----|---------------------------------|--------------------------------------|------------|
| 001 | `001-scaffold-project.md`       | Init repo, deps, tsconfig, CLAUDE.md | —          |
| 002 | `002-jsonrpc-types-errors.md`   | JSON-RPC type defs and error codes   | 001        |
| 003 | `003-session-types.md`          | Session state types                  | 001        |
| 004 | `004-session-manager.md`        | Session lifecycle management         | 003        |
| 005 | `005-agent-bridge.md`           | Agent SDK ↔ JSON-RPC bridge          | 002, 004   |
| 006 | `006-rpc-handler.md`            | JSON-RPC dispatch layer              | 002, 004   |
| 007 | `007-http-routes.md`            | Health and status HTTP endpoints     | 004        |
| 008 | `008-websocket-server.md`       | Bun.serve() entry point wiring       | 006, 007   |
| 009 | `009-echo-test.md`              | WebSocket round-trip test            | 008        |
| 010 | `010-acpx-integration.md`       | ACPX Integration (OpenClaw Bridge)   | 005        |

## Acceptance Criteria

- `bun run src/index.ts` starts server on port 3000
- WebSocket connects at `/ws`, speaks JSON-RPC 2.0
- `session/new` starts an agent and streams `session/update` notifications
- `session/question` and `session/approval` push to client when agent needs input
- `session/message` feeds user responses back into the running agent
- `GET /health` returns 200, `GET /sessions` returns session list
- `bun test` passes round-trip echo test
