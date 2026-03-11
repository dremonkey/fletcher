# LiveKit Data Channel Protocol (JSON-RPC 2.0)

**Status:** ✅ Ready for Implementation  
**Date:** 2026-03-10  
**Purpose:** Exact data channel topic, message envelope format, and JSON-RPC 2.0 method definitions for Fletcher Relay ↔ Mobile Client communication.

---

## Transport Layer

### LiveKit Data Channel

**Topic Name:** `"relay"`

**Encoding:** UTF-8 JSON strings

**Reliability:** `reliable: true` (SCTP ordered, reliable delivery)

**Message Size Limit:** 16 KB per message (LiveKit SCTP limit)

**Chunking:** Messages >16 KB MUST be chunked (see Chunking Protocol below)

**Participant Type:**
- **Mobile Client:** LiveKit participant (mobile SDK: `livekit_client` Flutter package)
- **Relay:** LiveKit participant (server SDK: `@livekit/rtc-node` Bun package)

**Data Channel Subscription (Mobile):**
```dart
// Flutter mobile app
room.localParticipant.publishData(
  Uint8List.fromList(utf8.encode(jsonEncode(rpcRequest))),
  reliable: true,
  topic: 'relay',
);

// Subscribe to relay responses
room.on<DataReceivedEvent>((event) {
  if (event.topic != 'relay') return;
  final json = jsonDecode(utf8.decode(event.data));
  // Handle JSON-RPC response/notification
});
```

**Data Channel Publishing (Relay):**
```typescript
// Bun relay server
import { DataPacket_Kind } from '@livekit/rtc-node';

await remoteParticipant.publishData(
  Buffer.from(JSON.stringify(rpcNotification)),
  { reliable: true, topic: 'relay' }
);

// Subscribe to client requests
room.on('dataReceived', (data, participant, kind, topic) => {
  if (topic !== 'relay') return;
  const json = JSON.parse(data.toString('utf-8'));
  // Handle JSON-RPC request
});
```

---

## Separation from Voice Mode Data Channel

**Current State (Voice Mode):**
- Topic: `"ganglia-events"`
- Messages: Typed JSON objects (`{ type: "artifact", ... }`)
- Purpose: Deliver artifacts, status updates, transcripts from voice agent to mobile

**New (Chat Mode):**
- Topic: `"relay"`
- Messages: JSON-RPC 2.0 requests/responses/notifications
- Purpose: Bidirectional text conversation management

**Routing:**
- Mobile app subscribes to BOTH topics simultaneously
- `ganglia-events` → handled by existing `_processGangliaEvent()` method (voice mode)
- `relay` → handled by new `_processRelayMessage()` method (chat mode)
- No collision risk — different topics, different protocols

**Why Separate Topics:**
1. **Protocol Isolation:** Voice mode uses ad-hoc typed events; chat mode uses JSON-RPC 2.0 (structured request/response)
2. **Lifecycle Isolation:** Voice mode is tied to `livekit-agent` lifecycle; chat mode is tied to relay participant lifecycle
3. **Backward Compatibility:** Existing Flutter code continues to work unchanged for voice mode
4. **Future-Proofing:** Enables mixed-mode sessions (voice for STT/TTS, relay for text reasoning)

---

## JSON-RPC 2.0 Protocol

### Overview

The relay uses **JSON-RPC 2.0** for structured, bidirectional communication. This enables:
- Matched request/response pairs (via `id` field)
- Notifications (server → client without response required)
- Error handling with standard error codes
- Extensibility (new methods without protocol changes)

**Specification:** [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)

### Base Message Format

**Request (Client → Relay):**
```json
{
  "jsonrpc": "2.0",
  "method": "session/new",
  "params": { "prompt": "Hello!" },
  "id": 1
}
```

**Response (Relay → Client):**
```json
{
  "jsonrpc": "2.0",
  "result": { "sessionId": "sess_abc123", "status": "created" },
  "id": 1
}
```

**Notification (Relay → Client, No Response Expected):**
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123",
    "type": "content_delta",
    "delta": "Hello",
    "fullText": "Hello"
  }
}
```

**Error Response:**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32600,
    "message": "Invalid Request",
    "data": { "field": "method", "reason": "Missing required field" }
  },
  "id": 1
}
```

### Standard Error Codes

| Code | Message | Meaning |
|------|---------|---------|
| -32700 | Parse error | Invalid JSON received |
| -32600 | Invalid Request | Missing `jsonrpc`, `method`, or `id` field |
| -32601 | Method not found | Unknown method name |
| -32602 | Invalid params | Params schema doesn't match method |
| -32603 | Internal error | Relay runtime error |
| -32000 | Session not found | `sessionId` doesn't exist |
| -32001 | Backend error | OpenClaw returned an error |
| -32002 | Rate limit exceeded | Too many requests from this client |

---

## Client → Relay Methods

### 1. `session/new`

**Purpose:** Start a new conversation session.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/new",
  "params": {
    "prompt": "Hello! What's the weather like?"
  },
  "id": 1
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "sessionId": "sess_abc123",
    "status": "created"
  },
  "id": 1
}
```

**Behavior:**
- Relay creates a new OpenClaw session (via `/v1/chat/completions`)
- Relay sends initial message to OpenClaw
- Relay starts streaming `session/update` notifications with response deltas
- `sessionId` is a UUID generated by the relay (maps to OpenClaw session key internally)

**Params Schema:**
```typescript
{
  prompt: string;  // Initial user message
}
```

**Result Schema:**
```typescript
{
  sessionId: string;  // UUID session identifier
  status: "created";
}
```

---

### 2. `session/message`

**Purpose:** Send a message to an existing session.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/message",
  "params": {
    "sessionId": "sess_abc123",
    "content": "What about tomorrow?"
  },
  "id": 2
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "processing"
  },
  "id": 2
}
```

**Behavior:**
- Relay appends message to session history
- Relay sends updated history to OpenClaw (`/v1/chat/completions` with full message array)
- Relay streams `session/update` notifications with response deltas
- If `sessionId` not found → Error `-32000`

**Params Schema:**
```typescript
{
  sessionId: string;  // UUID from session/new
  content: string;    // User message text
}
```

**Result Schema:**
```typescript
{
  status: "processing";
}
```

---

### 3. `session/resume`

**Purpose:** Resume a session after reconnect (e.g., network switch, app backgrounding).

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/resume",
  "params": {
    "sessionId": "sess_abc123",
    "prompt": "Continue our conversation"
  },
  "id": 3
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "resumed",
    "bufferedEvents": [
      {
        "type": "push",
        "eventType": "task_completed",
        "payload": { "taskId": "task_xyz", "result": "..." }
      }
    ]
  },
  "id": 3
}
```

**Behavior:**
- Relay looks up session by `sessionId` in SQLite
- If session exists → return buffered events (if any), send new message (if `prompt` provided)
- If session not found → Error `-32000`
- Buffered events are completed background tasks that finished while client was offline

**Params Schema:**
```typescript
{
  sessionId: string;  // UUID from previous session/new
  prompt?: string;    // Optional: new message to send on resume
}
```

**Result Schema:**
```typescript
{
  status: "resumed";
  bufferedEvents?: Array<{
    type: "push";
    eventType: string;
    payload: any;
  }>;
}
```

---

### 4. `session/cancel`

**Purpose:** Cancel an in-progress LLM request.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {
    "sessionId": "sess_abc123"
  },
  "id": 4
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "cancelled"
  },
  "id": 4
}
```

**Behavior:**
- Relay aborts the in-flight OpenClaw HTTP request (via AbortController)
- Relay sends `session/complete` notification with `status: "cancelled"`
- Session remains active — can send new messages after cancellation

**Params Schema:**
```typescript
{
  sessionId: string;
}
```

**Result Schema:**
```typescript
{
  status: "cancelled";
}
```

---

### 5. `session/list`

**Purpose:** List all active sessions for this client (debugging/diagnostics).

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/list",
  "params": {},
  "id": 5
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "sessions": [
      {
        "sessionId": "sess_abc123",
        "createdAt": 1710123456,
        "lastActivity": 1710123500,
        "state": "active"
      },
      {
        "sessionId": "sess_def456",
        "createdAt": 1710120000,
        "lastActivity": 1710120100,
        "state": "idle"
      }
    ]
  },
  "id": 5
}
```

**Params Schema:**
```typescript
{}  // No params
```

**Result Schema:**
```typescript
{
  sessions: Array<{
    sessionId: string;
    createdAt: number;      // Unix timestamp (seconds)
    lastActivity: number;   // Unix timestamp (seconds)
    state: "active" | "idle" | "completed" | "error";
  }>;
}
```

---

## Relay → Client Notifications

### 1. `session/update`

**Purpose:** Streaming text delta from LLM.

**Notification:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123",
    "type": "content_delta",
    "delta": "Hello",
    "fullText": "Hello"
  }
}
```

**Params Schema:**
```typescript
{
  sessionId: string;
  type: "content_delta" | "artifact" | "tool_call";
  delta: string;       // For content_delta: incremental text chunk
  fullText: string;    // For content_delta: accumulated full text so far
  artifact?: {         // For type: "artifact"
    id: string;
    type: string;      // e.g., "text/markdown", "application/pdf"
    title: string;
    url?: string;      // Download URL (if artifact is file-based)
    content?: string;  // Inline content (if small enough)
  };
  toolCall?: {         // For type: "tool_call"
    id: string;
    name: string;
    arguments: string; // Partial or complete JSON args
  };
}
```

**Frequency:** One notification per OpenClaw SSE chunk (typically every 50-100ms during streaming)

**Ordering:** Guaranteed ordered delivery (SCTP reliable + ordered)

---

### 2. `session/complete`

**Purpose:** LLM response finished (successful or cancelled).

**Notification:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/complete",
  "params": {
    "sessionId": "sess_abc123",
    "status": "completed",
    "result": {
      "finishReason": "stop",
      "usage": {
        "promptTokens": 123,
        "completionTokens": 456,
        "totalTokens": 579
      }
    }
  }
}
```

**Params Schema:**
```typescript
{
  sessionId: string;
  status: "completed" | "cancelled";
  result?: {
    finishReason: "stop" | "length" | "tool_calls" | "content_filter";
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
}
```

---

### 3. `session/error`

**Purpose:** LLM request failed.

**Notification:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/error",
  "params": {
    "sessionId": "sess_abc123",
    "error": {
      "code": "BACKEND_ERROR",
      "message": "OpenClaw returned 503 Service Unavailable",
      "retryable": true
    }
  }
}
```

**Params Schema:**
```typescript
{
  sessionId: string;
  error: {
    code: "INVALID_REQUEST" | "AUTHENTICATION_ERROR" | "RATE_LIMIT_ERROR" | "BACKEND_ERROR" | "STREAM_INTERRUPTED" | "TIMEOUT";
    message: string;
    retryable: boolean;  // Suggests whether client should retry the request
  };
}
```

**Error Codes:**
- `INVALID_REQUEST` — Bad request to OpenClaw (400)
- `AUTHENTICATION_ERROR` — OpenClaw auth failed (401/403)
- `RATE_LIMIT_ERROR` — Too many requests (429)
- `BACKEND_ERROR` — OpenClaw server error (500/503)
- `STREAM_INTERRUPTED` — Connection dropped mid-stream
- `TIMEOUT` — Request exceeded timeout (60s default)

---

### 4. `session/push`

**Purpose:** Deliver completed background task result (e.g., long-running research, file generation).

**Notification:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/push",
  "params": {
    "sessionId": "sess_abc123",
    "eventType": "task_completed",
    "payload": {
      "taskId": "task_xyz",
      "result": {
        "summary": "Research complete",
        "artifact": {
          "id": "art_123",
          "type": "text/markdown",
          "title": "Research Report",
          "url": "https://..."
        }
      }
    }
  }
}
```

**Params Schema:**
```typescript
{
  sessionId: string;
  eventType: string;  // Custom event type (e.g., "task_completed", "file_ready")
  payload: any;       // Arbitrary JSON payload
}
```

**Delivery:**
- Sent immediately if client is connected
- Buffered for up to 30 minutes if client is offline
- Delivered on `session/resume` after reconnect

---

## Chunking Protocol (Messages >16 KB)

LiveKit data channel has a 16 KB message size limit. Large messages (e.g., full artifacts, long transcripts) MUST be chunked.

### Chunk Envelope

**First Chunk:**
```json
{
  "jsonrpc": "2.0",
  "method": "chunk/start",
  "params": {
    "transferId": "xfer_abc123",
    "totalChunks": 3,
    "chunkIndex": 0,
    "data": "base64-encoded-partial-data"
  }
}
```

**Subsequent Chunks:**
```json
{
  "jsonrpc": "2.0",
  "method": "chunk/continue",
  "params": {
    "transferId": "xfer_abc123",
    "chunkIndex": 1,
    "data": "base64-encoded-partial-data"
  }
}
```

**Final Chunk:**
```json
{
  "jsonrpc": "2.0",
  "method": "chunk/end",
  "params": {
    "transferId": "xfer_abc123",
    "chunkIndex": 2,
    "data": "base64-encoded-partial-data"
  }
}
```

### Reassembly (Client Side)

```dart
// Dart (Flutter mobile app)
final Map<String, List<String?>> _chunks = {};

void _handleChunkMessage(Map<String, dynamic> json) {
  final method = json['method'] as String;
  final params = json['params'] as Map<String, dynamic>;
  final transferId = params['transferId'] as String;
  final chunkIndex = params['chunkIndex'] as int;
  final data = params['data'] as String;

  if (method == 'chunk/start') {
    final totalChunks = params['totalChunks'] as int;
    _chunks[transferId] = List<String?>.filled(totalChunks, null);
  }

  _chunks[transferId]![chunkIndex] = data;

  if (method == 'chunk/end' || _chunks[transferId]!.every((c) => c != null)) {
    // Reassemble
    final allBytes = <int>[];
    for (final part in _chunks[transferId]!) {
      allBytes.addAll(base64Decode(part!));
    }
    final reassembledJson = utf8.decode(allBytes);
    final originalMessage = jsonDecode(reassembledJson);
    _processRelayMessage(originalMessage);
    _chunks.remove(transferId);
  }
}
```

**Transfer ID:** UUID generated by sender, unique per chunked message

**Chunk Size:** Max 15 KB per chunk (leaves 1 KB for JSON-RPC envelope)

**Timeout:** If chunks aren't fully received within 30s, discard partial transfer

---

## Example Message Flows

### Flow 1: New Session with Streaming Response

**1. Client → Relay:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/new",
  "params": { "prompt": "Tell me a joke" },
  "id": 1
}
```

**2. Relay → Client (Response):**
```json
{
  "jsonrpc": "2.0",
  "result": { "sessionId": "sess_abc", "status": "created" },
  "id": 1
}
```

**3. Relay → Client (Streaming Updates):**
```json
{ "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "sess_abc", "type": "content_delta", "delta": "Why", "fullText": "Why" } }
{ "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "sess_abc", "type": "content_delta", "delta": " did the", "fullText": "Why did the" } }
{ "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "sess_abc", "type": "content_delta", "delta": " chicken", "fullText": "Why did the chicken" } }
{ "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "sess_abc", "type": "content_delta", "delta": " cross the road?", "fullText": "Why did the chicken cross the road?" } }
```

**4. Relay → Client (Complete):**
```json
{
  "jsonrpc": "2.0",
  "method": "session/complete",
  "params": {
    "sessionId": "sess_abc",
    "status": "completed",
    "result": { "finishReason": "stop" }
  }
}
```

### Flow 2: Session Continuation

**1. Client → Relay:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/message",
  "params": { "sessionId": "sess_abc", "content": "Tell me another" },
  "id": 2
}
```

**2. Relay → Client (Response):**
```json
{
  "jsonrpc": "2.0",
  "result": { "status": "processing" },
  "id": 2
}
```

**3. Relay → Client (Streaming Updates + Complete):**
*(Same as Flow 1, steps 3-4)*

### Flow 3: Cancellation

**1. Client → Relay:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": { "sessionId": "sess_abc" },
  "id": 3
}
```

**2. Relay → Client (Response):**
```json
{
  "jsonrpc": "2.0",
  "result": { "status": "cancelled" },
  "id": 3
}
```

**3. Relay → Client (Complete Notification):**
```json
{
  "jsonrpc": "2.0",
  "method": "session/complete",
  "params": {
    "sessionId": "sess_abc",
    "status": "cancelled"
  }
}
```

### Flow 4: Error Handling

**1. Client → Relay (Invalid Session):**
```json
{
  "jsonrpc": "2.0",
  "method": "session/message",
  "params": { "sessionId": "sess_invalid", "content": "Hello" },
  "id": 4
}
```

**2. Relay → Client (Error):**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Session not found",
    "data": { "sessionId": "sess_invalid" }
  },
  "id": 4
}
```

---

## Implementation Notes

### For Task R-003 (Data Channel Transport)

1. **Topic Subscription:**
   - Subscribe to `relay` topic only (ignore `ganglia-events`)
   - Filter `DataReceivedEvent` by `topic === 'relay'`

2. **Message Parsing:**
   - UTF-8 decode → JSON parse → validate `jsonrpc: "2.0"`
   - Reject malformed JSON with error code `-32700`
   - Validate required fields (`method`, `id` for requests)

3. **Chunking:**
   - Check message size before publish (max 15 KB)
   - If >15 KB → split into chunks, send `chunk/start` → `chunk/continue`* → `chunk/end`
   - Receiver: buffer chunks by `transferId`, reassemble on `chunk/end`

### For Task R-004 (JSON-RPC Protocol)

1. **Request/Response Matching:**
   - Client maintains map: `requestId → Promise<result>`
   - Relay sends response with same `id` as request
   - Timeout: 30s per request (reject promise if no response)

2. **Notification Handling:**
   - No `id` field → notification (no response expected)
   - Client emits event for UI layer: `onSessionUpdate`, `onSessionComplete`, etc.

3. **Error Handling:**
   - Validate error codes match standard JSON-RPC 2.0 spec
   - Custom codes (`-32000` to `-32099`) for app-specific errors

---

## Verification Checklist

- [x] Topic name `"relay"` chosen to avoid collision with `ganglia-events`
- [x] JSON-RPC 2.0 spec followed for requests/responses/notifications
- [x] Chunking protocol supports messages >16 KB
- [x] Error codes cover all failure modes (parse, method, params, backend)
- [x] Example flows demonstrate full session lifecycle
- [x] Separation from voice mode data channel is clear

**Status:** Ready for implementation (Tasks R-003, R-004, R-005)
