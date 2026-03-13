# LiveKit Data Channel Protocol (ACP over WebRTC)

**Status:** Draft
**Date:** 2026-03-10
**Purpose:** Data channel topic, message format, and ACP method mapping for Fletcher Relay ↔ Mobile Client communication.

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

---

## Separation from Voice Mode Data Channel

**Voice Mode:**
- Topic: `"ganglia-events"`
- Messages: Typed JSON objects (`{ type: "artifact", ... }`)
- Purpose: Deliver artifacts, status updates, transcripts from voice agent to mobile

**Chat Mode:**
- Topic: `"relay"`
- Messages: ACP JSON-RPC 2.0 messages
- Purpose: Bidirectional text conversation

**Routing:**
- Mobile app subscribes to BOTH topics simultaneously
- `ganglia-events` → handled by existing `_processGangliaEvent()` method
- `relay` → handled by new `_processRelayMessage()` method
- No collision risk — different topics, different protocols

---

## Protocol: ACP JSON-RPC 2.0

The data channel carries **ACP messages** — the same JSON-RPC 2.0 protocol used between the voice agent and OpenClaw (see `acp-transport.md` for the full ACP spec). The relay forwards messages between the data channel and OpenClaw, handling ACP lifecycle internally.

### What the relay handles internally

These methods never appear on the data channel — the relay sends them to OpenClaw when it joins a room:

| Method | Direction | Purpose |
|---|---|---|
| `initialize` | Relay → OpenClaw | ACP handshake, capability negotiation |
| `session/new` | Relay → OpenClaw | Create ACP session with `_meta.session_key` for routing |

### What flows over the data channel

| Method | Direction | Purpose |
|---|---|---|
| `session/prompt` | Mobile → Relay → OpenClaw | Send user message |
| `session/cancel` | Mobile → Relay → OpenClaw | Cancel in-flight request |
| `session/update` | OpenClaw → Relay → Mobile | Streaming content chunks |

The relay's forwarding is minimal:
- **Outbound** (`session/prompt`): relay adds `sessionId` (from the ACP session it created), then forwards to OpenClaw
- **Inbound** (`session/update`): relay forwards to mobile as-is
- **Cancel** (`session/cancel`): relay forwards as-is

---

## Message Formats

### Mobile → Relay: `session/prompt`

User speaks or types a message. Mobile sends it as an ACP `session/prompt` (without `sessionId` — relay adds it).

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

Relay enriches and forwards to OpenClaw:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_abc123",
    "prompt": [
      { "type": "text", "text": "What's the weather like?" }
    ]
  }
}
```

### Relay → Mobile: `session/update` (notification)

OpenClaw streams content chunks. The relay forwards them to mobile as-is (transparent passthrough — no parsing of `update` content).

Each notification carries a **single `update` object** (not an array) with a `sessionUpdate` discriminator field. This matches the [official ACP spec](https://agentclientprotocol.com/protocol/prompt-turn.md) and was confirmed against OpenClaw in the March 2026 field test.

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "type": "text", "text": "The weather is" }
    }
  }
}
```

Known `sessionUpdate` kinds: `agent_message_chunk`, `available_commands_update`, `plan`, `tool_call`, `tool_call_update`. Only `agent_message_chunk` carries response text for the user.

These are JSON-RPC notifications (no `id` field) — the mobile doesn't respond to them.

### Relay → Mobile: prompt result

When the prompt completes, the relay forwards OpenClaw's response to the original `session/prompt` request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "stopReason": "completed"
  }
}
```

### Mobile → Relay: `session/cancel` (notification)

User cancels an in-flight request (e.g., starts typing while response is streaming).

```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {}
}
```

This is an ACP notification (no `id`). The relay forwards it to OpenClaw. The pending `session/prompt` resolves with `stopReason: "cancelled"`.

---

## Error Handling

### ACP Errors (forwarded from OpenClaw)

OpenClaw returns standard JSON-RPC errors. The relay forwards them to mobile:

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

### Relay-Specific Errors

If the relay itself can't forward (e.g., ACP connection down, voice mode active), it returns an error directly:

| Code | Message | When |
|---|---|---|
| -32003 | Voice mode active | Room metadata `mode === "voice"` — relay is passive |
| -32010 | ACP connection lost | Relay's connection to OpenClaw dropped |
| -32011 | Session not ready | Relay hasn't completed ACP handshake yet |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32003,
    "message": "Voice mode active, chat unavailable"
  }
}
```

---

## Example Flows

### Flow 1: New Conversation

```
Mobile                      Relay                       OpenClaw
  │                           │                             │
  │                           │── initialize ──────────────▶│
  │                           │◀── result (caps) ──────────│
  │                           │                             │
  │                           │── session/new ─────────────▶│
  │                           │   (_meta.session_key)       │
  │                           │◀── result (sessionId) ─────│
  │                           │                             │
  │ session/prompt ──────────▶│                             │
  │ {prompt: "Hello!"}        │── session/prompt ──────────▶│
  │                           │   (+ sessionId)             │
  │                           │                             │
  │                           │◀── session/update ─────────│
  │◀── session/update ────────│   {content_chunk: "Hi"}     │
  │                           │                             │
  │                           │◀── session/update ─────────│
  │◀── session/update ────────│   {content_chunk: " there"}│
  │                           │                             │
  │                           │◀── result (completed) ─────│
  │◀── result (completed) ────│                             │
```

### Flow 2: Cancellation (User Interrupts)

```
Mobile                      Relay                       OpenClaw
  │                           │                             │
  │ session/prompt ──────────▶│── session/prompt ──────────▶│
  │                           │                             │
  │                           │◀── session/update ─────────│
  │◀── session/update ────────│                             │
  │                           │                             │
  │ session/cancel ──────────▶│── session/cancel ──────────▶│
  │                           │                             │
  │                           │◀── result (cancelled) ─────│
  │◀── result (cancelled) ────│                             │
```

### Flow 3: Voice Mode Active (Relay Rejects)

```
Mobile                      Relay                Room Metadata
  │                           │                       │
  │ session/prompt ──────────▶│                       │
  │                           │ check mode            │
  │                           │ (mode="voice")        │
  │                           │                       │
  │◀── error (-32003) ────────│                       │
  │    "Voice mode active"    │                       │
```

---

## Chunking Protocol (Messages >16 KB)

LiveKit data channel has a 16 KB message size limit. Large messages (e.g., artifacts, long content) MUST be chunked.

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

**Transfer ID:** UUID generated by sender, unique per chunked message

**Chunk Size:** Max 15 KB per chunk (leaves 1 KB for JSON-RPC envelope)

**Timeout:** If chunks aren't fully received within 30s, discard partial transfer

---

## Implementation Notes

### Relay (Bun)

```typescript
// Subscribe to data channel
room.on('dataReceived', (data, participant, kind, topic) => {
  if (topic !== 'relay') return;
  const msg = JSON.parse(data.toString('utf-8'));

  if (msg.method === 'session/prompt') {
    // Add sessionId, forward to OpenClaw ACP connection
    msg.params.sessionId = acpSessionId;
    acp.send(msg);
  } else if (msg.method === 'session/cancel') {
    acp.send(msg);
  }
});

// Forward OpenClaw responses to mobile
acp.onNotification('session/update', (params) => {
  room.localParticipant.publishData(
    Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params,
    })),
    { reliable: true, topic: 'relay' }
  );
});
```

### Mobile (Flutter)

```dart
// Send prompt
room.localParticipant.publishData(
  Uint8List.fromList(utf8.encode(jsonEncode({
    'jsonrpc': '2.0',
    'id': nextId++,
    'method': 'session/prompt',
    'params': {
      'prompt': [{'type': 'text', 'text': userMessage}],
    },
  }))),
  reliable: true,
  topic: 'relay',
);

// Receive updates
room.on<DataReceivedEvent>((event) {
  if (event.topic != 'relay') return;
  final msg = jsonDecode(utf8.decode(event.data));

  if (msg['method'] == 'session/update') {
    // Handle streaming content chunk
    final updates = msg['params']['updates'] as List;
    for (final update in updates) {
      if (update['kind'] == 'content_chunk') {
        onContentDelta(update['content']['text']);
      }
    }
  } else if (msg['result'] != null) {
    // Prompt completed
    onPromptComplete(msg['result']['stopReason']);
  } else if (msg['error'] != null) {
    onError(msg['error']);
  }
});
```
