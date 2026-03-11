# R-009: Message Streaming (SSE → JSON-RPC Notifications)

**Depends On:** R-006, R-008  
**Blocks:** None  
**Effort:** 2 hours  

## Objective
Stream OpenClaw SSE chunks as JSON-RPC `session/update` notifications.

## Reference
See `docs/data-channel-protocol.md` sections:
- "Relay → Client Notifications" → `session/update`
- "Example Message Flows" → Flow 1

## Key Logic
```typescript
// For each SSE chunk from OpenClaw:
const chunk = await openclawClient.streamMessage(...);
const delta = chunk.choices[0].delta.content;

// Send JSON-RPC notification
await transport.sendToParticipant(participant, JSON.stringify({
  jsonrpc: '2.0',
  method: 'session/update',
  params: {
    sessionId,
    type: 'content_delta',
    delta,
    fullText: accumulatedText,
  },
}));

// On stream complete:
await transport.sendToParticipant(participant, JSON.stringify({
  jsonrpc: '2.0',
  method: 'session/complete',
  params: {
    sessionId,
    status: 'completed',
    result: { finishReason: 'stop' },
  },
}));
```

## Acceptance Criteria
✅ Each SSE chunk → `session/update` notification  
✅ Accumulated fullText sent with each delta  
✅ `session/complete` sent when stream ends  
✅ `session/error` sent if stream fails  
