# Technical Spec: OpenResponses API Integration

**Epic:** 18 - OpenResponses API Integration  
**Status:** Research Complete  
**Author:** Glitch (based on OpenClaw official docs)

## Overview

This spec defines the migration from the stateless `/v1/chat/completions` endpoint to the native OpenClaw `/v1/responses` (OpenResponses API) endpoint for Fletcher's voice agent.

## Problem Statement

The current architecture uses the OpenAI-compatible `/v1/chat/completions` endpoint:
- **Stateless:** Each request is independent; no session continuity at the API level
- **Silent failures:** When the HTTP stream hangs or the Gemini API flakes, the user gets no feedback
- **Limited error handling:** Generic HTTP errors without structured retry guidance

## OpenResponses API Benefits

The native `/v1/responses` endpoint provides:
- **Stateful sessions:** Requests with a `user` field derive stable session keys for continuity
- **Item-based streaming:** Granular SSE events (`response.output_item.added`, `response.output_text.delta`, etc.)
- **Typed outputs:** Distinguishes text (for TTS) from artifacts (for visual display)
- **Structured errors:** `response.failed` events with error types and retry guidance
- **Better observability:** `response.created`, `response.in_progress`, `response.completed` lifecycle events

## API Comparison

### Current: Chat Completions
```typescript
POST /v1/chat/completions
{
  "model": "openclaw-gateway",
  "messages": [{ "role": "user", "content": "hello" }],
  "stream": true
}

// SSE Response:
data: {"choices": [{"delta": {"content": "Hi"}}]}
data: {"choices": [{"delta": {"content": " there"}}]}
data: [DONE]
```

### Target: OpenResponses
```typescript
POST /v1/responses
{
  "model": "openclaw:main",
  "input": "hello",
  "stream": true,
  "user": "fletcher_<identity>"  // Stable session routing
}

// SSE Response:
event: response.created
data: {"id": "resp_abc123", ...}

event: response.output_item.added
data: {"item": {"id": "item_1", "type": "message", ...}}

event: response.content_part.added
data: {"part": {"type": "text", ...}}

event: response.output_text.delta
data: {"delta": "Hi", "text": "Hi"}

event: response.output_text.delta
data: {"delta": " there", "text": "Hi there"}

event: response.output_text.done
data: {"text": "Hi there"}

event: response.output_item.done
data: {"item": {...}}

event: response.completed
data: {"usage": {...}}

data: [DONE]
```

## Authentication

OpenResponses uses the same Gateway auth as Chat Completions:
- **Header:** `Authorization: Bearer <gateway-token>`
- **Mode:** Matches `gateway.auth.mode` (`token` or `password`)
- **Rate limiting:** 429 responses with `Retry-After` on auth failures

## Session Routing

### Current (Chat Completions)
```typescript
// Session routing via custom headers
headers: {
  'X-OpenClaw-Session-Id': sessionId,
  'X-OpenClaw-Room-Name': roomName,
  'X-OpenClaw-Participant-Identity': participantIdentity
}
```

### Target (OpenResponses)
```typescript
// Session routing via `user` field or `x-openclaw-session-key` header
{
  "user": "fletcher_<participantIdentity>",  // Derives stable session key
  // OR
  headers: { 'x-openclaw-session-key': 'main' }  // Direct session targeting
}
```

## Event Schema

### Lifecycle Events
- `response.created` — Response initiated
- `response.in_progress` — Processing started
- `response.completed` — Response finished successfully
- `response.failed` — Error occurred

### Content Events
- `response.output_item.added` — New output item created (message, function_call, etc.)
- `response.content_part.added` — New content part within an item (text, image, etc.)
- `response.output_text.delta` — Incremental text chunk
- `response.output_text.done` — Text content finalized
- `response.content_part.done` — Content part finalized
- `response.output_item.done` — Output item finalized

### Item Types
- `message` — Text content (role: assistant)
- `function_call` — Tool call request
- `function_call_output` — Tool result (client → server)

### Content Part Types
- `text` — Plain text (route to TTS)
- `reasoning` — Internal reasoning (optional display)

## Implementation Strategy

### Phase 1: Client Library Update
Update `OpenClawClient` in `packages/livekit-agent-ganglia/src/client.ts`:
1. Add `respond()` method alongside existing `chat()` method
2. Implement OpenResponses SSE parser
3. Map events to existing `OpenClawChatResponse` interface for backward compatibility

### Phase 2: Voice Agent Integration
Update `apps/voice-agent/src/agent.ts`:
1. Switch `gangliaLlm` to use `respond()` instead of `chat()`
2. Update session routing to use `user` field
3. Add lifecycle event handlers for observability

### Phase 3: Deprecation
1. Keep `chat()` method as fallback for compatibility
2. Add config flag to toggle between endpoints
3. Monitor for issues before fully removing old endpoint

## Backward Compatibility

To maintain compatibility with the existing voice pipeline:
- Map `response.output_text.delta` → `choices[0].delta.content`
- Map `response.output_text.done` → `choices[0].finish_reason: "stop"`
- Map `response.failed` → HTTP error or SSE error event

This allows the `LLMStream` interface in `@livekit/agents` to work without changes.

## Error Handling

### Current (Chat Completions)
```typescript
// Generic HTTP errors
if (!response.ok) {
  throw new Error(`API error (${response.status}): ${errorText}`);
}
```

### Target (OpenResponses)
```typescript
// Structured error events
event: response.failed
data: {
  "error": {
    "type": "rate_limit_error",
    "message": "Rate limit exceeded",
    "code": "rate_limit_exceeded"
  }
}

// Client can:
// 1. Display user-friendly error
// 2. Retry with backoff
// 3. Fall back to text-only mode
```

## Configuration

Enable the OpenResponses endpoint in `openclaw.json`:
```json
{
  "gateway": {
    "http": {
      "endpoints": {
        "responses": { "enabled": true }
      }
    }
  }
}
```

## Success Criteria

- [ ] `respond()` method implemented in `OpenClawClient`
- [ ] SSE event parser handles all event types
- [ ] Voice agent successfully uses `/v1/responses` endpoint
- [ ] Session continuity maintained across network drops
- [ ] Structured errors displayed to user
- [ ] Backward compatibility with existing `chat()` method

## Open Questions

1. **Tool calls:** Does OpenResponses support `function_call` items for multi-turn tool resolution?
   - **Answer:** Yes, via `function_call` output items and `function_call_output` input items.

2. **Artifacts:** How do we distinguish "artifact" content from "text" content?
   - **Answer:** OpenResponses doesn't have a native "artifact" type. We may need to continue using the data channel for artifacts.

3. **Pondering phrases:** Can we leverage `reasoning` content parts for the "pondering" status?
   - **Answer:** Yes, `reasoning` parts can be used for internal monologue display.

## References

- [OpenResponses API Docs](https://docs.openclaw.ai/gateway/openresponses-http-api)
- [Fletcher Epic 18 SUMMARY.md](./SUMMARY.md)
- [OpenClawClient source](../../packages/livekit-agent-ganglia/src/client.ts)
