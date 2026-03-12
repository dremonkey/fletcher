# Task 052: ACP Backend for Ganglia (`GANGLIA_TYPE=acp`)

**Epic:** 22 — Dual-Mode Architecture
**Status:** [ ]
**Depends on:** Fletcher Relay ACP spec (`apps/relay/docs/acp-transport.md`)

## Goal

Create a new `LLM` backend in `livekit-agent-ganglia` that connects to OpenClaw via ACP (Agent Communication Protocol) instead of the current HTTP/SSE completions API. This replaces the half-duplex HTTP transport with full-duplex JSON-RPC 2.0, enabling mid-turn push, real-time event streaming, and multi-modal coordination for the voice agent.

## Context

Today, `GangliaLLM` (via `OpenClawLLM`) calls the OpenClaw Gateway completions API directly over HTTP POST + SSE streaming. This is half-duplex — the server cannot push unsolicited messages to the client, and the client cannot send data on an active SSE stream. This breaks down when:

1. An external controller needs to push instructions mid-turn (inject context, cancel, redirect)
2. Real-time pipeline events (STT interim transcripts, EOU, TTS status, tool calls) need to flow without polling
3. Multi-modal flows require immediate incorporation of new data mid-turn

ACP solves all three via full-duplex JSON-RPC 2.0 over stdio or WebSocket. The relay already uses ACP for chat mode (`apps/relay/src/acp/client.ts`). This task gives the voice agent its own ACP connection — both modes then speak the same protocol to OpenClaw, sharing `session_key` for conversation continuity.

Full spec: `apps/relay/docs/acp-transport.md`

## Scope

- New `AcpLLM` class in `packages/livekit-agent-ganglia` (registered as `GANGLIA_TYPE=acp`)
- ACP client: spawns subprocess (stdio) or connects via WebSocket, performs `initialize` → `session/new` handshake
- Maps `session/prompt` → streamed `session/update` responses → `LLMStream`-compatible events (text deltas, tool calls, artifacts)
- Voice-specific ACP extensions: `x/voice/inject` (backend pushes instructions), `x/voice/event` (pipeline state)
- Session management via `session_key` in `session/new` `_meta` — same key as relay uses
- Env var config: `ACP_TRANSPORT` (stdio/websocket), `ACP_COMMAND`, `ACP_ARGS`, `ACP_URL`

## Not in scope

- Relay changes (relay already has its own ACP client)
- Mobile-side changes (mobile talks to relay, not to ganglia directly)
- TTS integration (unchanged — voice agent continues to use server-side TTS)

## Relates to

- `apps/relay/src/acp/client.ts` — reference ACP client implementation (can reuse patterns)
- `apps/relay/docs/acp-transport.md` — canonical ACP spec with `AcpLLM` class design
- Task 053 (Dual-Mode Split) — depends on this for voice mode to use ACP

## Confirmed OpenClaw ACP wire format (from field test 2026-03-12)

`session/update` notification from OpenClaw uses a **singular `update` object**, not an array:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "<uuid>",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "type": "text", "text": "..." }
    }
  }
}
```

Other `sessionUpdate` kinds observed: `available_commands_update` (emitted on `session/new`, no content).
The relay bridge translates this to `{ updates: [{ kind: "content_chunk", content }] }` for mobile.
`AcpLLM` should consume the same raw format — **do not assume `updates[]`**.

## Acceptance criteria

- [ ] `AcpLLM` class created, registered in ganglia factory as `GANGLIA_TYPE=acp`
- [ ] ACP client handles `initialize` → `session/new` lifecycle (stdio transport)
- [ ] `session/prompt` sends user text, receives streamed `session/update` text deltas mapped to `LLMStream` events
- [ ] `session/cancel` interrupts in-flight completions
- [ ] `x/voice/inject` extension handled (backend can push instructions mid-turn)
- [ ] Session key passed via `_meta` in `session/new` (same `resolveSessionKey()` logic)
- [ ] Unit tests covering: ACP handshake, prompt→stream mapping, cancel, error handling, session key routing
