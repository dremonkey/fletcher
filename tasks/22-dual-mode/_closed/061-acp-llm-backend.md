# Task 061: AcpLLM Backend + Remove OpenClaw HTTP

**Epic:** 22 — Dual-Mode Architecture
**Status:** [x]
**Depends on:** 060 (Extract Shared ACP Client)
**Blocks:** 062 (Voice Agent ACP Wiring)

## Goal

Create `AcpLLM` — a new ganglia LLM backend that connects to OpenClaw via ACP (JSON-RPC 2.0 over stdio) instead of HTTP/SSE. Register it as `GANGLIA_TYPE=acp` and make it the default. Simultaneously delete the OpenClaw HTTP backend (`OpenClawLLM`, `OpenClawClient`, `OpenClawChatStream`) and all OpenResponses code, since ACP replaces both transports.

## Context

### Why replace HTTP with ACP

The current `OpenClawLLM` uses HTTP POST + SSE streaming (`/v1/chat/completions` or `/v1/responses`). This is half-duplex — the server cannot push data to the client outside of an SSE stream, and the client cannot send data on an active stream. ACP is full-duplex JSON-RPC 2.0 that enables mid-turn push, real-time events, and multi-modal coordination.

The relay already uses ACP for chat mode. This task gives the voice agent its own ACP connection — both modes then speak the same protocol to OpenClaw.

### ACP protocol flow for voice agent

```
AcpLLM                               ACP Agent (OpenClaw)
──────                                ──────────────────
[first chat() call - lazy init]
  spawn subprocess ──────────────►
  initialize ────────────────────►  { protocolVersion, clientInfo }
                    ◄────────────  { caps, agentInfo }
  initialized ───────────────────►
  session/new {_meta} ───────────►  { session_key, room_name, ... }
                    ◄────────────  { sessionId }

[each user turn]
  session/prompt ────────────────►  { sessionId, prompt: [{text}] }
                    ◄────────────  session/update { agent_message_chunk }  ×N
                    ◄────────────  result { stopReason: "completed" }

[barge-in]
  session/cancel ────────────────►
```

### Wire format confirmed (field test 2026-03-12)

`session/update` uses **singular `update` object**, not `updates[]`:
```json
{
  "jsonrpc": "2.0", "method": "session/update",
  "params": {
    "sessionId": "<uuid>",
    "update": { "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "..." } }
  }
}
```

### What gets deleted

Files to delete from `packages/livekit-agent-ganglia/src/`:
- `llm.ts` — `OpenClawLLM`, `OpenClawChatStream`, `extractSessionFromContext`, `convertMessagesToInput`
- `llm.spec.ts` — all OpenClaw LLM tests
- `client.ts` — `OpenClawClient`, `generateSessionId`, `buildSessionHeaders`, `buildMetadataHeaders`, `applySessionKey`
- `client.spec.ts` — all OpenClaw client tests
- `types/index.ts` — `OpenClawConfig` (HTTP-specific), `OpenClawMessage`, `OpenClawChatOptions`, `OpenClawChatResponse`, `LiveKitSessionInfo`, `AuthenticationError`, `SessionError`, etc.
- `types/openresponses.ts` — all OpenResponses types and error classes

Files to keep (unchanged):
- `factory.ts` (updated), `ganglia-types.ts` (updated), `index.ts` (updated)
- `nanoclaw.ts`, `nanoclaw-client.ts`, `nanoclaw-client.spec.ts`, `nanoclaw.spec.ts`
- `session-routing.ts`, `session-routing.spec.ts`
- `pondering.ts`, `pondering.spec.ts`
- `events.ts`, `events.spec.ts`
- `tool-interceptor.ts`, `tool-interceptor.spec.ts`
- `logger.ts`
- `event-interceptor.ts`
- `transcript-manager.ts`, `metrics.ts`

## Implementation

### 1. Create AcpLLM class (`packages/livekit-agent-ganglia/src/acp-llm.ts`)

```typescript
class AcpLLM extends LLMBase implements GangliaLLM {
  private acpClient: AcpClient | null = null;
  private sessionId: string | null = null;
  private _sessionKey?: SessionKey;
  private _defaultSession?: GangliaSessionInfo;
  private _config: AcpConfig;
  private _initPromise: Promise<void> | null = null;
  private _onPondering?: (phrase: string | null, streamId: string) => void;
  private _onContent?: (delta: string, fullText: string, streamId: string) => void;
  private _nextStreamSeq = 0;

  // Lazy init: spawn + initialize + session/new on first chat()
  private async ensureInitialized(): Promise<void> { ... }

  chat({ chatCtx, toolCtx, connOptions }): AcpChatStream { ... }
  setDefaultSession(session: GangliaSessionInfo): void { ... }
  setSessionKey(sessionKey: SessionKey): void { ... }
  gangliaType(): string { return 'acp'; }
  label(): string { return 'acp'; }
}
```

Key design decisions:
- **Lazy init:** `ensureInitialized()` is idempotent — first `chat()` call triggers spawn + initialize + session/new. Subsequent calls are no-ops. Uses a `_initPromise` to coalesce concurrent calls.
- **Session key via `_meta`:** Passed to `session/new` as `{ _meta: { session_key, room_name, participant_identity } }`.
- **One subprocess per LLM instance:** AcpLLM owns the subprocess lifecycle. Subprocess dies when voice agent disconnects.
- **Pondering support:** Start pondering timer on `session/prompt`, stop on first `agent_message_chunk`.
- **Prompt timeout:** Configurable via `ACP_PROMPT_TIMEOUT_MS` env var (default: 120s). Rejects if `session/prompt` doesn't return within budget.

### 2. Create AcpChatStream (`packages/livekit-agent-ganglia/src/acp-stream.ts`)

```typescript
class AcpChatStream extends LLMStream {
  protected async run(): Promise<void> {
    // 1. Extract latest user message text from ChatContext
    // 2. Subscribe to session/update notifications (unsubscribe on completion)
    // 3. Start pondering timer
    // 4. Send session/prompt with user text
    // 5. Map agent_message_chunk → ChatChunk → queue.put()
    // 6. Stop pondering on first content chunk
    // 7. Unsubscribe on prompt completion or error
  }

  close(): void {
    // Barge-in: send session/cancel, then super.close()
  }
}
```

Mapping: `session/update { agent_message_chunk, content: { type: "text", text } }` → `ChatChunk { delta: { role: "assistant", content: text } }`.

Non-text update kinds (tool_call, usage_update, available_commands_update) are logged but not mapped to ChatChunks — they don't produce voice output.

### 3. Add AcpConfig to ganglia types (`ganglia-types.ts`)

```typescript
export interface AcpConfig {
  /** ACP subprocess command (e.g., "openclaw"). */
  command: string;
  /** ACP subprocess arguments (e.g., ["acp"]). */
  args?: string[];
  /** Additional environment variables for the subprocess. */
  env?: Record<string, string>;
  /** Prompt timeout in ms (default: 120000). */
  promptTimeoutMs?: number;
  /** Optional logger. */
  logger?: Logger;
  /** Pondering callback. */
  onPondering?: (phrase: string | null, streamId: string) => void;
  /** Content chunk callback. */
  onContent?: (delta: string, fullText: string, streamId: string) => void;
}

export type GangliaConfig =
  | { type: 'acp'; acp: AcpConfig; logger?: Logger }
  | { type: 'nanoclaw'; nanoclaw: NanoclawConfig; logger?: Logger };
```

### 4. Update factory (`factory.ts`)

- Add `acp` branch to `createGangliaFromEnv()`:
  - Reads `ACP_COMMAND` (default: `"openclaw"`), `ACP_ARGS` (default: `"acp"`), `ACP_PROMPT_TIMEOUT_MS`
  - Change default type from `'openclaw'` to `'acp'`
- Remove `openclaw` branch entirely
- Update type for `GANGLIA_TYPE` env var documentation

### 5. Register AcpLLM in factory

At the bottom of `acp-llm.ts`:
```typescript
registerGanglia('acp', async () => AcpLLM as any);
```

### 6. Update exports (`index.ts`)

- Remove all OpenClaw exports: `OpenClawLLM`, `OpenClawClient`, `buildSessionHeaders`, `buildMetadataHeaders`, `applySessionKey`, `generateSessionId`, `extractSessionFromContext`, `convertMessagesToInput`, OpenResponses types/errors
- Remove `openclaw` namespace export and `export default openclaw`
- Add AcpLLM exports: `AcpLLM`, `AcpConfig` type
- Add `acp` namespace: `export const acp = { LLM: AcpLLM }`
- Set `export default acp`

### 7. Delete OpenClaw files

Delete:
- `src/llm.ts`, `src/llm.spec.ts`
- `src/client.ts`, `src/client.spec.ts`
- `src/types/index.ts`, `src/types/openresponses.ts`

### 8. Add `@fletcher/acp-client` dependency

Add to `packages/livekit-agent-ganglia/package.json`:
```json
"dependencies": {
  "@fletcher/acp-client": "workspace:*",
  "debug": "^4.4.0"
}
```

### 9. Update factory.spec.ts

- Remove OpenClaw test cases
- Add AcpLLM registration test
- Add `createGangliaFromEnv()` test for `GANGLIA_TYPE=acp` (default)
- Test that `GANGLIA_TYPE=openclaw` throws "Unknown ganglia type"

### 10. Write AcpLLM tests (`acp-llm.spec.ts`)

Test cases:
- Lazy init: first `chat()` spawns subprocess + initialize + session/new
- Subsequent `chat()` calls skip init
- `session/prompt` sends user text from ChatContext
- `session/update` (agent_message_chunk) → ChatChunk mapping
- Non-text update kinds are ignored (no ChatChunk produced)
- `close()` sends `session/cancel`
- Subprocess crash → error propagated
- JSON-RPC error → error propagated
- Queue closed during put (user interruption) → graceful exit
- Session key passed via `_meta`
- Pondering timer starts/stops correctly
- Prompt timeout fires after configured duration

Use the mock ACP agent from `@fletcher/acp-client/test/mock-acpx` for testing.

## Not in scope

- WebSocket transport (stdio only)
- `_fletcher/voice/inject` and `_fletcher/voice/event` extensions
- Nanoclaw changes (untouched)
- Relay changes (relay has its own ACP client)

## Relates to

- Task 060 (Extract Shared ACP Client) — this task depends on it
- Task 062 (Voice Agent ACP Wiring) — this task blocks it
- `apps/relay/docs/acp-transport.md` — ACP protocol spec
- Task 052 (original task file) — superseded by this task

## Acceptance criteria

- [ ] `AcpLLM` class created in `packages/livekit-agent-ganglia/src/acp-llm.ts`
- [ ] `AcpChatStream` created in `packages/livekit-agent-ganglia/src/acp-stream.ts`
- [ ] Registered in factory as `GANGLIA_TYPE=acp` (default)
- [ ] Lazy init: spawn + initialize + session/new on first `chat()`
- [ ] `session/prompt` sends user text, receives streamed `session/update` text deltas mapped to `LLMStream` events
- [ ] `session/cancel` sent on `close()` (barge-in)
- [ ] Session key passed via `_meta` in `session/new`
- [ ] Configurable prompt timeout via `ACP_PROMPT_TIMEOUT_MS`
- [ ] Pondering callback integration (start/stop on content)
- [ ] OpenClaw HTTP backend fully deleted (no llm.ts, client.ts, types/index.ts, types/openresponses.ts)
- [ ] Factory default changed from 'openclaw' to 'acp'
- [ ] Exports updated (no OpenClaw references)
- [ ] Unit tests: lazy init, prompt→stream mapping, cancel, error handling, session key, pondering, timeout
- [ ] All ganglia tests pass: `bun test` in `packages/livekit-agent-ganglia/`
