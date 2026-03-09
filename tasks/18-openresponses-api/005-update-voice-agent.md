# Task 005: Update Voice Agent to Use OpenResponses

**Epic:** 18 - OpenResponses API Integration  
**Status:** [x] Complete
**Depends on:** 004 (Event Mapping)

## Objective

Update the standalone voice agent in `apps/voice-agent/src/agent.ts` to use the OpenResponses API via the updated `OpenClawClient`.

## Current Implementation

The agent uses `OpenClawLLM` which wraps `OpenClawClient.chat()`:

```typescript
const gangliaLlm = await createGangliaFromEnv({
  logger,
  onPondering,
  onContent,
});

// Under the hood, OpenClawLLM calls:
await openclawClient.chat({
  messages,
  tools,
  sessionKey,
});
```

## Target Implementation

Option A: Minimal Change (use `respondAsChat()`)
```typescript
// OpenClawLLM internally switches to respondAsChat()
// No voice-agent changes required
```

Option B: Native OpenResponses (expose lifecycle events)
```typescript
// OpenClawLLM exposes lifecycle events
gangliaLlm.on('response.created', (event) => {
  logger.info({ responseId: event.data.id }, 'Response created');
});

gangliaLlm.on('response.completed', (event) => {
  logger.info({ usage: event.data.usage }, 'Response completed');
});
```

## Session Routing Update

Update session routing to use `user` field:

```typescript
// Current (Chat Completions)
const sessionId = generateSessionId(session);
body.session_id = sessionId;

// Target (OpenResponses)
const user = `fletcher_${participant.identity}`;
body.user = user;
```

The `/v1/responses` endpoint derives a stable session key from the `user` field, so repeated calls share the same agent session.

## Implementation Steps

### 1. Update OpenClawLLM

In `packages/livekit-agent-ganglia/src/llm.ts`:

```typescript
export class OpenClawLLM extends LLM {
  async *chat(params: ChatParams): AsyncIterableIterator<LLMChatChunk> {
    // Option A: Use respondAsChat() wrapper
    const stream = this.client.respondAsChat({
      input: params.messages,
      tools: params.tools,
      user: this.deriveUser(params),
      sessionKey: this.sessionKey,
      signal: params.signal,
    });

    for await (const response of stream) {
      yield this.mapToLLMChatChunk(response);
    }
  }

  private deriveUser(params: ChatParams): string {
    if (this.defaultSession?.participantIdentity) {
      return `fletcher_${this.defaultSession.participantIdentity}`;
    }
    return `fletcher_${Date.now()}`;
  }
}
```

### 2. Add Lifecycle Event Emitters (Optional)

If we want to expose lifecycle events to the voice agent:

```typescript
export class OpenClawLLM extends EventEmitter {
  async *chat(params: ChatParams): AsyncIterableIterator<LLMChatChunk> {
    const stream = this.client.respond({
      input: params.messages,
      user: this.deriveUser(params),
    });

    for await (const event of stream) {
      // Emit lifecycle events
      if (event.event === 'response.created') {
        this.emit('response.created', event.data);
      }
      if (event.event === 'response.completed') {
        this.emit('response.completed', event.data);
      }

      // Map content events to LLM chunks
      const chunk = this.mapEventToChunk(event);
      if (chunk) yield chunk;
    }
  }
}
```

### 3. Update Voice Agent (Optional)

In `apps/voice-agent/src/agent.ts`:

```typescript
const gangliaLlm = await createGangliaFromEnv({ logger, ... });

// Log lifecycle events
gangliaLlm.on('response.created', (data) => {
  logger.debug({ responseId: data.id }, 'OpenResponses: response created');
});

gangliaLlm.on('response.completed', (data) => {
  logger.info({ usage: data.usage }, 'OpenResponses: response completed');
});

gangliaLlm.on('response.failed', (data) => {
  logger.error({ error: data.error }, 'OpenResponses: response failed');
});
```

## Configuration

Add environment variable to toggle endpoint:

```bash
# .env
USE_OPENRESPONSES=true  # Default: false (for gradual rollout)
```

```typescript
const client = new OpenClawClient({
  baseUrl,
  apiKey,
  useOpenResponses: process.env.USE_OPENRESPONSES === 'true',
});
```

## Rollback Strategy

If OpenResponses has issues, we can roll back by:
1. Setting `USE_OPENRESPONSES=false`
2. Reverting to `chat()` method
3. No code changes required

## Testing

- [x] Unit test: OpenClawLLM uses `respond()` when enabled
- [x] Unit test: Session routing uses `user` field
- [ ] Integration test: Voice agent connects via OpenResponses
- [ ] Integration test: Session continuity across multiple turns
- [ ] Field test: Verify no regressions in voice pipeline

## Files Modified

- `packages/livekit-agent-ganglia/src/llm.ts` (update chat() method)
- `packages/livekit-agent-ganglia/src/factory.ts` (pass useOpenResponses flag)
- `apps/voice-agent/src/agent.ts` (optional lifecycle event handlers)

## Success Criteria

- Voice agent successfully uses OpenResponses endpoint
- Session routing via `user` field works
- Lifecycle events logged
- No regressions in voice pipeline
- Rollback mechanism tested
