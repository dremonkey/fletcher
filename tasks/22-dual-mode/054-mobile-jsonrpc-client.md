# Task 054: Mobile ACP Client (JSON-RPC over Data Channel)

**Epic:** 22 — Dual-Mode Architecture
**Status:** [~]
**Depends on:** 053 (Dual-Mode Split)

## Goal

Implement a full ACP client in the Flutter mobile app that speaks JSON-RPC 2.0 over the LiveKit data channel (`"relay"` topic). The relay is a **transparent passthrough** — it forwards ACP messages between the mobile app and the ACP agent (OpenClaw) without interpreting them (aside from injecting `sessionId`). This means the mobile app is effectively an ACP client, speaking the same protocol the voice agent uses.

## Context

The relay bridges two transports:
```
Mobile (data channel, topic "relay") ←→ Relay ←→ ACP agent (stdio)
```

The relay handles ACP lifecycle internally (`initialize`, `session/new`) and injects `sessionId` into outbound `session/prompt` requests. Everything else passes through verbatim. The mobile app needs to understand and handle the ACP messages that arrive.

**Protocol reference:** `apps/relay/docs/data-channel-protocol.md`, `apps/relay/docs/acp-transport.md`

## ACP Methods — Mobile Sends

### `session/prompt` (Request — expects response)

Send user text to the ACP agent. The relay injects `sessionId` before forwarding.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/prompt",
  "params": {
    "prompt": [
      { "type": "text", "text": "What's the weather like?" }
    ]
  }
}
```

**`params.prompt`** is `ContentPart[]`:
- `{ "type": "text", "text": "..." }` — text message

The response arrives after all `session/update` notifications have been sent:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "stopReason": "completed"
  }
}
```

**`stopReason` values:**
- `"completed"` — agent finished normally
- `"cancelled"` — cancelled via `session/cancel`

### `session/cancel` (Notification — no response)

Cancel an in-flight `session/prompt`. Used when: user starts typing while response is streaming, user taps cancel, user switches modes.

```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {}
}
```

The pending `session/prompt` resolves with `{ "stopReason": "cancelled" }`.

## ACP Methods — Mobile Receives

### `session/update` (Notification — streaming)

Arrives zero or more times between sending `session/prompt` and receiving the response. Each notification contains one or more updates.

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "updates": [
      {
        "kind": "content_chunk",
        "content": { "type": "text", "text": "The weather is" }
      }
    ]
  }
}
```

**`Update` shape:**
```
{
  kind: string;        // update type discriminator
  content?: ContentPart;
  [key: string]: unknown;  // extensible — unknown kinds should be ignored
}
```

**Known `kind` values the mobile must handle:**

| `kind` | Payload | Mobile behavior |
|---|---|---|
| `content_chunk` | `content: { type: "text", text: "..." }` | Append text delta to current agent message in ChatTranscript. This is the primary streaming mechanism. |
| (future: `tool_call`) | TBD | Display tool execution status (e.g., "Searching..."). Not implemented in ACP agent yet. |
| (future: `artifact`) | TBD | Render inline artifact below message. Not implemented yet — currently artifacts flow via `ganglia-events` in voice mode only. |

**Important:** `kind` is an open string. The mobile must ignore unknown `kind` values gracefully — new update types may be added to the ACP agent without requiring a mobile update.

### Prompt result (Response to `session/prompt`)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "stopReason": "completed" }
}
```

Signals the end of streaming for this prompt. The mobile should:
- Finalize the agent message (mark as complete, stop streaming indicator)
- Re-enable input if it was locked during streaming

### Error response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": { "reason": "LLM backend unavailable" }
  }
}
```

**Error codes the mobile should handle:**

| Code | Meaning | Mobile behavior |
|---|---|---|
| `-32003` | Voice mode active | Relay rejected because agent is handling requests. Show "Voice mode active" or silently retry via agent path. |
| `-32010` | ACP connection lost | Relay can't reach OpenClaw. Show "Backend unavailable — retrying..." |
| `-32011` | Session not ready | Relay hasn't finished ACP handshake. Retry after short delay. |
| `-32600` | Invalid request | Client sent malformed JSON-RPC. Log error, don't surface to user. |
| `-32601` | Method not found | Client sent unknown method. Log error. |
| `-32603` | Internal error | Generic server error. Show "Something went wrong — try again." |

## Implementation

### 1. JSON-RPC 2.0 codec (`lib/services/relay/json_rpc.dart`)

Low-level JSON-RPC framing:
- `JsonRpcRequest` — `{ jsonrpc, id, method, params }`
- `JsonRpcNotification` — `{ jsonrpc, method, params }` (no `id`)
- `JsonRpcResponse` — discriminated by presence of `result` vs `error`
- Auto-incrementing `id` for request correlation
- Encode to `Uint8List` (UTF-8 JSON), decode from `Uint8List`

### 2. ACP client service (`lib/services/relay/acp_client.dart`)

Application-level ACP client:
- `sendPrompt(String text)` → sends `session/prompt`, returns a `Stream<AcpEvent>` that yields `ContentDelta`, `PromptComplete`, or `PromptError`
- `cancelPrompt()` → sends `session/cancel`
- Internally: tracks pending request IDs, routes incoming messages to the correct completer/stream
- Handles interleaving: `session/update` notifications arrive between request and response

### 3. Data channel wiring (`LiveKitService` changes)

- Subscribe to `"relay"` topic in the existing `DataReceivedEvent` handler
- Route `"relay"` messages to `AcpClient`
- Provide `publishRelay(Uint8List data)` method for `AcpClient` to send outbound messages
- Detect relay participant presence (identity starts with `"relay-"`) for health/status

### 4. UI integration (`ConversationBloc` / `ChatTranscript`)

- `content_chunk` updates append to an in-progress agent message (same rendering as voice mode agent messages)
- Prompt complete finalizes the message
- Error responses show inline error card in transcript
- Streaming indicator (thinking spinner) shown between sending prompt and first `content_chunk`

## Message flow example

```
User types "Hello"
    │
    ├─ Mobile sends session/prompt {id:1, prompt:[{type:"text", text:"Hello"}]}
    │  on topic "relay"
    │
    ├─ UI shows thinking spinner
    │
    │  ← Relay forwards session/update {content_chunk: "Hi"}
    │     UI appends "Hi" to agent message, hides spinner
    │
    │  ← Relay forwards session/update {content_chunk: " there!"}
    │     UI appends " there!" to agent message
    │
    │  ← Relay forwards result {id:1, stopReason:"completed"}
    │     UI finalizes agent message
    │
    └─ Input re-enabled
```

## Not in scope

- TTS playback of relay responses (task 043)
- Mode switch UI / state machine (task 053)
- Relay-side changes (relay already implements the protocol)
- Chunking protocol (messages >16 KB) — defer until needed
- `x/voice/*` extensions — voice-agent-only, not relevant for chat mode

## Relates to

- Task 042 (Relay Integration for Chat Mode) — this is the concrete implementation
- `apps/relay/docs/data-channel-protocol.md` — canonical protocol spec
- `apps/relay/docs/acp-transport.md` — full ACP spec (voice agent perspective, same protocol)
- `apps/relay/src/acp/types.ts` — TypeScript ACP types (reference for Dart equivalents)

## Acceptance criteria

- [x] JSON-RPC 2.0 codec with request/notification/response types
- [x] `AcpClient` service sends `session/prompt`, receives streamed `session/update`, handles `session/cancel`
- [x] Request ID correlation — responses matched to their originating request
- [x] Unknown `update.kind` values ignored gracefully
- [x] `content_chunk` text deltas render in ChatTranscript in real time
- [x] Prompt completion finalizes agent message
- [~] Error responses surfaced in UI (system event, not inline card yet)
- [x] Relay-specific errors handled: `-32003` (voice mode), `-32010` (ACP lost), `-32011` (not ready)
- [x] Thinking spinner between prompt send and first content chunk
- [~] `session/cancel` sent on user interruption (cancel method exists; not wired to UI cancel button yet)
- [x] Unit tests: JSON-RPC encode/decode, request correlation, update routing, error handling (30 tests)
