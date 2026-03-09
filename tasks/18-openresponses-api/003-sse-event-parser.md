# Task 003: Implement OpenResponses SSE Event Parser

**Epic:** 18 - OpenResponses API Integration  
**Status:** 📋 Planned  
**Depends on:** 002 (respond() method)

## Objective

Parse the OpenResponses SSE stream into typed events that can be consumed by the voice agent pipeline.

## Requirements

- Parse `event:` and `data:` lines from SSE stream
- Handle multi-line data payloads
- Detect `[DONE]` sentinel
- Type-safe event objects
- Handle malformed events gracefully

## Event Types to Support

### Lifecycle
- `response.created`
- `response.in_progress`
- `response.completed`
- `response.failed`

### Content
- `response.output_item.added`
- `response.content_part.added`
- `response.output_text.delta`
- `response.output_text.done`
- `response.content_part.done`
- `response.output_item.done`

## Implementation

### SSE Parsing Logic

```typescript
async *respond(options: OpenClawRespondOptions): AsyncIterableIterator<OpenResponsesEvent> {
  const response = await fetch(url, { method: 'POST', headers, body, signal });
  
  if (!response.ok) {
    // Handle HTTP errors
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        
        // End of stream
        if (trimmed === 'data: [DONE]') {
          return;
        }

        // Event type
        if (trimmed.startsWith('event: ')) {
          currentEvent = trimmed.slice(7);
          continue;
        }

        // Event data
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            yield {
              event: currentEvent || 'message',
              data,
            };
            currentEvent = '';
          } catch (e) {
            this.logger.warn(`Failed to parse SSE data: ${trimmed}`);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

## Event Type Definitions

```typescript
// src/types/openresponses.ts

export type OpenResponsesEventType =
  | 'response.created'
  | 'response.in_progress'
  | 'response.output_item.added'
  | 'response.content_part.added'
  | 'response.output_text.delta'
  | 'response.output_text.done'
  | 'response.content_part.done'
  | 'response.output_item.done'
  | 'response.completed'
  | 'response.failed';

export interface OpenResponsesEvent {
  event: OpenResponsesEventType;
  data: any;  // Event-specific payload
}

export interface ResponseCreatedEvent {
  id: string;
  model: string;
  usage?: UsageInfo;
}

export interface OutputTextDeltaEvent {
  delta: string;
  text: string;  // Accumulated text so far
}

export interface ResponseFailedEvent {
  error: {
    type: string;
    message: string;
    code?: string;
  };
}
```

## Error Handling

- **Malformed JSON:** Log warning, skip event, continue streaming
- **Missing event type:** Default to 'message' event type
- **Stream abort:** Clean up reader, propagate AbortError
- **Network error:** Throw with context for retry logic

## Debugging

Add debug logging for SSE events:
```typescript
dbg.openresponses('event=%s data=%j', event.event, event.data);
```

## Testing

- [ ] Unit test: Parse single-line event
- [ ] Unit test: Parse multi-line data payload
- [ ] Unit test: Detect [DONE] sentinel
- [ ] Unit test: Handle malformed JSON gracefully
- [ ] Unit test: Handle AbortSignal cancellation
- [ ] Integration test: Parse real OpenResponses stream

## Files Modified

- `packages/livekit-agent-ganglia/src/client.ts` (SSE parsing)
- `packages/livekit-agent-ganglia/src/types/openresponses.ts` (new file)
- `packages/livekit-agent-ganglia/src/logger.ts` (add dbg.openresponses)

## Success Criteria

- SSE stream parsed into typed events
- All event types handled
- Malformed events logged but don't break stream
- AbortSignal cancels stream cleanly
- Debug logging available
