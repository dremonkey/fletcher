# Task 004: Map OpenResponses Events to LLMStream Interface

**Epic:** 18 - OpenResponses API Integration  
**Status:** [x] Complete
**Depends on:** 003 (SSE Event Parser)

## Objective

Create a mapping layer that converts OpenResponses events into the existing `OpenClawChatResponse` format used by the voice agent, allowing backward compatibility with the `@livekit/agents` LLM pipeline.

## Problem Statement

The voice agent expects `OpenClawChatResponse` objects:
```typescript
interface OpenClawChatResponse {
  choices: [{
    delta?: { content?: string };
    finish_reason?: string;
  }];
}
```

OpenResponses emits granular events:
```typescript
{
  event: 'response.output_text.delta',
  data: { delta: 'Hi', text: 'Hi' }
}
```

We need a bridge that translates OpenResponses → ChatResponse.

## Mapping Strategy

### Text Deltas
```typescript
// OpenResponses
{ event: 'response.output_text.delta', data: { delta: 'Hi' } }

// →

// ChatResponse
{
  choices: [{
    delta: { content: 'Hi' }
  }]
}
```

### Completion
```typescript
// OpenResponses
{ event: 'response.output_text.done', data: { text: 'Hi there' } }

// →

// ChatResponse
{
  choices: [{
    delta: {},
    finish_reason: 'stop'
  }]
}
```

### Error
```typescript
// OpenResponses
{ event: 'response.failed', data: { error: { message: 'Rate limit' } } }

// →

// ChatResponse
{
  choices: [{
    delta: {},
    finish_reason: 'error'
  }],
  error: { message: 'Rate limit' }
}
```

## Implementation

### Option A: Wrapper Generator (Recommended)

Add a `respondAsChat()` method that wraps `respond()`:

```typescript
async *respondAsChat(
  options: OpenClawRespondOptions
): AsyncIterableIterator<OpenClawChatResponse> {
  for await (const event of this.respond(options)) {
    const mapped = this.mapEventToChat(event);
    if (mapped) yield mapped;
  }
}

private mapEventToChat(event: OpenResponsesEvent): OpenClawChatResponse | null {
  switch (event.event) {
    case 'response.output_text.delta':
      return {
        choices: [{
          delta: { content: event.data.delta }
        }]
      };

    case 'response.output_text.done':
      return {
        choices: [{
          delta: {},
          finish_reason: 'stop'
        }]
      };

    case 'response.failed':
      return {
        choices: [{
          delta: {},
          finish_reason: 'error'
        }],
        error: event.data.error
      };

    case 'response.created':
    case 'response.in_progress':
    case 'response.completed':
      // Lifecycle events: don't map to chat deltas
      return null;

    default:
      // Unknown event: skip
      return null;
  }
}
```

### Option B: Update `chat()` to Use OpenResponses

Replace the internals of `chat()` to call `respondAsChat()`:

```typescript
async *chat(options: OpenClawChatOptions): AsyncIterableIterator<OpenClawChatResponse> {
  // Convert ChatOptions → RespondOptions
  const respondOptions: OpenClawRespondOptions = {
    input: this.convertMessagesToInput(options.messages),
    tools: options.tools,
    tool_choice: options.tool_choice,
    sessionKey: options.sessionKey,
    session: options.session,
    signal: options.signal,
  };

  yield* this.respondAsChat(respondOptions);
}
```

This approach makes OpenResponses the default, with no API changes for consumers.

## Message Conversion

Convert `messages` array to OpenResponses `input`:

```typescript
private convertMessagesToInput(messages: Message[]): string | InputItem[] {
  // Simple case: single user message
  if (messages.length === 1 && messages[0].role === 'user') {
    return messages[0].content;
  }

  // Complex case: multi-turn history
  return messages.map(msg => ({
    type: 'message',
    role: msg.role as 'system' | 'user' | 'assistant',
    content: [{ type: 'text', text: msg.content }],
  }));
}
```

## Lifecycle Event Handling

For observability, emit lifecycle events separately:

```typescript
async *respond(options: OpenClawRespondOptions): AsyncIterableIterator<OpenResponsesEvent> {
  for await (const event of this.respondRaw(options)) {
    // Emit lifecycle events to logger
    if (event.event === 'response.created') {
      dbg.openresponses('Response created: id=%s', event.data.id);
    }
    if (event.event === 'response.completed') {
      dbg.openresponses('Response completed: usage=%j', event.data.usage);
    }

    yield event;
  }
}
```

## Testing

- [x] Unit test: Text delta mapping
- [x] Unit test: Completion mapping
- [x] Unit test: Error mapping
- [x] Unit test: Lifecycle events skipped (no chat deltas)
- [ ] Integration test: Voice agent consumes `respondAsChat()`

## Files Modified

- `packages/livekit-agent-ganglia/src/client.ts` (add `respondAsChat()`, `mapEventToChat()`)
- `packages/livekit-agent-ganglia/src/types/index.ts` (export mapping types)

## Success Criteria

- `respondAsChat()` method implemented
- OpenResponses events correctly mapped to ChatResponse
- Lifecycle events handled (logged but not mapped)
- Voice agent can consume OpenResponses via existing interface
- Backward compatibility maintained
