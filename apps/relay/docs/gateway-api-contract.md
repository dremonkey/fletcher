# OpenClaw Gateway API Contract

**Status:** ✅ Verified against Ganglia client implementation  
**Date:** 2026-03-10  
**Purpose:** Exact HTTP endpoints, request/response schemas, session management for Fletcher Relay → OpenClaw Gateway integration.

---

## Base URL

Default: `http://localhost:18791` (OpenClaw Gateway HTTP API port)

Configurable via environment:
- `OPENCLAW_GATEWAY_URL` — Full base URL
- Fallback: `http://localhost:8080` (older deployments)

---

## Authentication

**Header:** `Authorization: Bearer {api_key}`

**Source:**
- `OPENCLAW_API_KEY` environment variable
- Optional for single-user localhost deployments
- Required for multi-user or remote deployments

**Error responses:**
- `401 Unauthorized` — Missing or invalid API key
- `403 Forbidden` — Valid key but insufficient permissions

---

## Endpoints

### 1. Chat Completions (OpenAI-Compatible)

**Endpoint:** `POST /v1/chat/completions`

**Purpose:** Send messages to OpenClaw, receive streaming or non-streaming responses.

**Request Headers:**
```http
Authorization: Bearer {api_key}
Content-Type: application/json
x-openclaw-session-key: {session_key}     # Optional: for owner session routing
X-OpenClaw-Room-SID: {room_sid}           # Optional: LiveKit room metadata
X-OpenClaw-Room-Name: {room_name}         # Optional: LiveKit room metadata
X-OpenClaw-Participant-Identity: {identity} # Optional: LiveKit participant metadata
X-OpenClaw-Participant-SID: {participant_sid} # Optional: LiveKit participant metadata
```

**Request Body:**
```json
{
  "model": "openclaw-gateway",
  "messages": [
    {
      "role": "system" | "user" | "assistant" | "tool",
      "content": "string",
      "tool_calls": [...],      // Optional: for assistant role with tool calls
      "tool_call_id": "string", // Optional: for tool role
      "name": "string"          // Optional: function name for tool role
    }
  ],
  "stream": true,               // Default: false
  "tools": [...],               // Optional: tool definitions
  "tool_choice": "auto" | "none" | {...}, // Optional
  "user": "guest_{identity}" | "room_{room_name}" // Optional: for guest/room session routing
}
```

**Session Routing Rules:**
- **Owner session:** Use header `x-openclaw-session-key: main` (or custom key)
- **Guest session:** Use body field `user: "guest_{identity}"`
- **Room session:** Use body field `user: "room_{room_name}"`
- Metadata headers (Room-SID, Participant-Identity, etc.) are informational only — routing is determined by session key or user field.

**Response (Non-Streaming):**
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "openclaw-gateway",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Response text",
        "tool_calls": [...]  // Optional
      },
      "finish_reason": "stop" | "length" | "tool_calls" | "content_filter"
    }
  ],
  "usage": {
    "prompt_tokens": 123,
    "completion_tokens": 456,
    "total_tokens": 579
  }
}
```

**Response (Streaming):**

SSE stream with `Content-Type: text/event-stream; charset=utf-8`

```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1234567890,"model":"openclaw-gateway","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1234567890,"model":"openclaw-gateway","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1234567890,"model":"openclaw-gateway","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1234567890,"model":"openclaw-gateway","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**Chunk Schema:**
```typescript
{
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: [{
    index: number;
    delta: {
      role?: "assistant";      // Only in first chunk
      content?: string;         // Text delta (incremental)
      tool_calls?: [{           // Tool call deltas
        index: number;
        id?: string;            // Tool call ID (first chunk)
        type?: "function";
        function?: {
          name?: string;        // Function name (first chunk)
          arguments?: string;   // Partial JSON args (incremental)
        }
      }]
    };
    finish_reason: null | "stop" | "length" | "tool_calls" | "content_filter";
  }];
}
```

**Stream Termination:**
- Last chunk has `finish_reason` set (not `null`)
- Final SSE event: `data: [DONE]`

**Error Responses:**
```json
{
  "error": {
    "message": "Error description",
    "type": "invalid_request_error" | "authentication_error" | "rate_limit_error" | "server_error",
    "code": "model_not_found" | "context_length_exceeded" | ...,
    "param": null | "string"  // Field that caused the error (if applicable)
  }
}
```

**HTTP Status Codes:**
- `200 OK` — Success (streaming or non-streaming)
- `400 Bad Request` — Invalid request body or parameters
- `401 Unauthorized` — Missing or invalid API key
- `403 Forbidden` — Valid key but insufficient permissions
- `429 Too Many Requests` — Rate limit exceeded
- `500 Internal Server Error` — OpenClaw runtime error
- `503 Service Unavailable` — OpenClaw is starting up or overloaded

---

### 2. OpenResponses (Richer Protocol, Optional)

**Endpoint:** `POST /v1/responses`

**Purpose:** Send requests using OpenClaw's richer OpenResponses protocol. Supports background tasks, richer artifact types, and push-style event delivery.

**Request Headers:** Same as `/v1/chat/completions`

**Request Body:**
```json
{
  "model": "openclaw-gateway",
  "input": "string" | [...],  // String or array of content items
  "instructions": "string",   // Optional: system instructions
  "stream": true,             // Default: true
  "tools": [...],             // Optional: tool definitions
  "tool_choice": "auto" | "none" | {...},
  "user": "guest_{identity}" | "room_{room_name}" // Optional: session routing
}
```

**Response (Streaming SSE):**

The response is an SSE stream with typed events. Each event has a `event:` field and a `data:` JSON payload.

**Event Types:**

1. **`response.created`** — Response session started
   ```json
   { "response_id": "resp_...", "status": "in_progress" }
   ```

2. **`response.output_item.added`** — New output item started
   ```json
   { "response_id": "resp_...", "item_id": "item_...", "item": {...} }
   ```

3. **`response.content_part.added`** — New content part within an item
   ```json
   { "response_id": "resp_...", "item_id": "item_...", "part_index": 0, "part": {...} }
   ```

4. **`response.output_item.done`** — Output item completed
   ```json
   { "response_id": "resp_...", "item_id": "item_...", "item": {...} }
   ```

5. **`response.content_part.done`** — Content part completed
   ```json
   { "response_id": "resp_...", "item_id": "item_...", "part_index": 0, "part": {...} }
   ```

6. **`response.text.delta`** — Streaming text delta
   ```json
   { "response_id": "resp_...", "item_id": "item_...", "output_index": 0, "content_index": 0, "delta": "text chunk" }
   ```

7. **`response.text.done`** — Text output completed
   ```json
   { "response_id": "resp_...", "item_id": "item_...", "output_index": 0, "content_index": 0, "text": "full text" }
   ```

8. **`response.completed`** — Entire response completed
   ```json
   { "response_id": "resp_...", "status": "completed", "usage": {...} }
   ```

9. **`response.failed`** — Response failed with error
   ```json
   { "response_id": "resp_...", "status": "failed", "error": {...} }
   ```

**Stream Termination:**
- `response.completed` or `response.failed` event
- Final SSE event: `data: [DONE]`

**Use Case:**
- The relay can use `/v1/responses` instead of `/v1/chat/completions` for richer event types (artifacts, background tasks, etc.)
- Enable via `RELAY_OPENCLAW_USE_OPENRESPONSES=true` environment variable
- The relay will map `response.text.delta` → `session/update` JSON-RPC notifications

---

## Session Persistence

**Session Keys:**
- OpenClaw maintains conversation state internally using session keys
- Session keys are derived from:
  - Header `x-openclaw-session-key` for owner sessions
  - Body `user` field for guest/room sessions
  - LiveKit metadata headers (Room-SID, Participant-Identity) for informational context

**Session Lifecycle:**
- First request with a new session key creates a new conversation
- Subsequent requests with the same session key continue the conversation
- Session history is maintained server-side (OpenClaw Gateway)
- No explicit session creation endpoint — sessions are created implicitly on first message

**Session Timeout:**
- Idle sessions are cleaned up by OpenClaw Gateway (configurable, typically 24h)
- Relay does NOT need to manage session expiration — OpenClaw handles it

---

## Error Handling

### Network Errors

**Retry Policy:**
- Connection refused → Retry with exponential backoff (base 1s, max 32s, 5 attempts)
- Timeout → Retry once, then surface error to client
- DNS failure → Surface error immediately (no retry)

### HTTP Errors

**4xx Client Errors:**
- `400 Bad Request` → Surface error to client immediately (invalid request)
- `401 Unauthorized` → Surface error to client immediately (auth failure)
- `403 Forbidden` → Surface error to client immediately (permission denied)
- `429 Too Many Requests` → Retry after `Retry-After` header (default 60s, max 3 retries)

**5xx Server Errors:**
- `500 Internal Server Error` → Retry with exponential backoff (base 2s, max 16s, 3 attempts)
- `503 Service Unavailable` → Retry with exponential backoff (base 5s, max 30s, 3 attempts)
- `504 Gateway Timeout` → Retry once, then surface error to client

### Stream Errors

**Mid-Stream Failures:**
- Connection dropped during SSE stream → Surface `session/error` to client with reason "stream_interrupted"
- Malformed SSE event → Skip event, continue stream, log warning
- `response.failed` event → Surface `session/error` to client with OpenClaw error details

**Client Abort:**
- When client sends `session/cancel` JSON-RPC request → Abort fetch with AbortController
- HTTP client MUST support AbortSignal for request cancellation

---

## Example Flows

### Flow 1: New Conversation (Non-Streaming)

**Request:**
```http
POST /v1/chat/completions
Authorization: Bearer sk-...
Content-Type: application/json

{
  "model": "openclaw-gateway",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "stream": false,
  "user": "guest_user123"
}
```

**Response:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1710123456,
  "model": "openclaw-gateway",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 12,
    "total_tokens": 22
  }
}
```

### Flow 2: Streaming Conversation

**Request:**
```http
POST /v1/chat/completions
Authorization: Bearer sk-...
Content-Type: application/json
x-openclaw-session-key: main

{
  "model": "openclaw-gateway",
  "messages": [
    { "role": "user", "content": "Count to 3" }
  ],
  "stream": true
}
```

**Response:**
```
data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1710123456,"model":"openclaw-gateway","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1710123456,"model":"openclaw-gateway","choices":[{"index":0,"delta":{"content":"1"},"finish_reason":null}]}

data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1710123456,"model":"openclaw-gateway","choices":[{"index":0,"delta":{"content":", 2"},"finish_reason":null}]}

data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1710123456,"model":"openclaw-gateway","choices":[{"index":0,"delta":{"content":", 3"},"finish_reason":null}]}

data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1710123456,"model":"openclaw-gateway","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### Flow 3: Session Continuation (Same User)

**First Request:**
```json
{
  "model": "openclaw-gateway",
  "messages": [{ "role": "user", "content": "My name is Alice" }],
  "user": "guest_alice"
}
```

**Second Request (Same Session):**
```json
{
  "model": "openclaw-gateway",
  "messages": [
    { "role": "user", "content": "My name is Alice" },
    { "role": "assistant", "content": "Nice to meet you, Alice!" },
    { "role": "user", "content": "What's my name?" }
  ],
  "user": "guest_alice"
}
```

**Response:**
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Your name is Alice."
    },
    "finish_reason": "stop"
  }]
}
```

---

## Relay Implementation Notes

**For Task R-006 (OpenClaw HTTP Client):**

1. **Base Client:**
   - Use `fetch()` with AbortSignal support
   - Default timeout: 60s for non-streaming, 5min for streaming
   - Exponential backoff retry logic for 5xx errors

2. **Session Key Routing:**
   - Relay receives `sessionId` from client → maps to OpenClaw session key
   - Owner sessions → header `x-openclaw-session-key: main`
   - Guest sessions → body `user: "guest_{livekit_participant_identity}"`
   - Room sessions → body `user: "room_{livekit_room_name}"`

3. **SSE Parsing:**
   - Split response stream on `\n\n` for SSE events
   - Parse `data:` prefix, skip empty lines
   - Handle `[DONE]` sentinel
   - Parse JSON chunk, extract `choices[0].delta.content`

4. **Error Mapping:**
   - HTTP 400 → `session/error` with code `INVALID_REQUEST`
   - HTTP 401/403 → `session/error` with code `AUTHENTICATION_ERROR`
   - HTTP 429 → `session/error` with code `RATE_LIMIT_ERROR`
   - HTTP 500/503 → `session/error` with code `BACKEND_ERROR`
   - Stream drop → `session/error` with code `STREAM_INTERRUPTED`

5. **Rate Limiting:**
   - Respect `Retry-After` header on 429 responses
   - Buffer client messages during backoff, flush when ready
   - Max buffer: 10 messages, drop oldest if exceeded

---

## Verification Checklist

- [x] Endpoints verified against Ganglia client (`client.ts`)
- [x] Session routing rules match existing implementation
- [x] SSE chunk schema matches OpenAI spec
- [x] Error codes match OpenClaw error types
- [x] OpenResponses protocol documented (optional endpoint)
- [x] Example flows cover common use cases

**Status:** Ready for implementation (Task R-006)
