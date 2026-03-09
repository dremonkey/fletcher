# Task 006: Enhanced Error Handling for OpenResponses

**Epic:** 18 - OpenResponses API Integration  
**Status:** [x] Complete
**Depends on:** 005 (Voice Agent Update)

## Objective

Implement robust error handling for the OpenResponses API, leveraging structured `response.failed` events and HTTP error codes to provide better user feedback.

## Current Limitations

The Chat Completions endpoint provides minimal error info:
- Generic HTTP status codes (400, 401, 429, 500)
- Plain text error messages
- No retry guidance

## OpenResponses Improvements

The `/v1/responses` endpoint provides:
- Structured `response.failed` events with error types
- Specific error codes (e.g., `rate_limit_exceeded`)
- `Retry-After` headers for 429 responses

## Error Types

### HTTP Errors (before streaming starts)

- `401` — Missing/invalid auth token
- `403` — Forbidden (auth valid but access denied)
- `429` — Rate limit exceeded (check `Retry-After` header)
- `400` — Invalid request body
- `405` — Wrong HTTP method
- `500` — Internal server error

### SSE Stream Errors (during streaming)

```typescript
event: response.failed
data: {
  "error": {
    "type": "rate_limit_error",
    "message": "Rate limit exceeded. Retry after 60 seconds.",
    "code": "rate_limit_exceeded"
  }
}
```

Error types:
- `rate_limit_error` — Too many requests
- `invalid_request_error` — Malformed request
- `authentication_error` — Auth token invalid
- `server_error` — Internal error
- `timeout_error` — Request timeout

## Implementation

### 1. Error Type Definitions

```typescript
// src/types/openresponses.ts

export class OpenResponsesError extends Error {
  constructor(
    message: string,
    public type: string,
    public code?: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'OpenResponsesError';
  }
}

export class RateLimitError extends OpenResponsesError {
  constructor(message: string, retryAfter?: number) {
    super(message, 'rate_limit_error', 'rate_limit_exceeded', retryAfter);
    this.name = 'RateLimitError';
  }
}
```

### 2. HTTP Error Handling

```typescript
async *respond(options: OpenClawRespondOptions): AsyncIterableIterator<OpenResponsesEvent> {
  const response = await fetch(url, { method: 'POST', headers, body, signal });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
      throw new RateLimitError(errorText, retryAfter);
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError(errorText, response.status);
    }

    throw new OpenResponsesError(
      `HTTP ${response.status}: ${errorText}`,
      'http_error',
      response.status.toString()
    );
  }

  // ... stream parsing ...
}
```

### 3. SSE Error Handling

```typescript
for await (const event of this.respondRaw(options)) {
  if (event.event === 'response.failed') {
    const { error } = event.data;
    throw new OpenResponsesError(
      error.message,
      error.type,
      error.code
    );
  }

  yield event;
}
```

### 4. Voice Agent Error Feedback

Update the voice agent to handle these errors:

```typescript
// apps/voice-agent/src/agent.ts

session.on(voice.AgentSessionEventTypes.Error, (ev) => {
  const err = ev.error as OpenResponsesError;

  if (err instanceof RateLimitError) {
    logger.warn({ retryAfter: err.retryAfter }, 'Rate limit exceeded');
    publishEvent({
      type: 'artifact',
      artifact_type: 'error',
      title: 'Rate Limit Exceeded',
      message: `Too many requests. Please wait ${err.retryAfter} seconds and try again.`,
    });
  } else if (err instanceof AuthenticationError) {
    logger.error({ status: err.status }, 'Authentication failed');
    publishEvent({
      type: 'artifact',
      artifact_type: 'error',
      title: 'Authentication Error',
      message: 'Failed to authenticate with OpenClaw Gateway. Check your API key.',
    });
  } else {
    logger.error({ error: err }, 'OpenResponses error');
    publishEvent({
      type: 'artifact',
      artifact_type: 'error',
      title: 'System Error',
      message: err.message,
    });
  }

  stopAck();
});
```

## Retry Strategy

Implement exponential backoff for retryable errors:

```typescript
async retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;

      if (err instanceof RateLimitError) {
        const delay = err.retryAfter * 1000;
        logger.info({ delay, attempt }, 'Rate limited, retrying...');
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (err instanceof AuthenticationError) {
        // Don't retry auth errors
        throw err;
      }

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.info({ delay, attempt }, 'Retrying after error...');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}
```

## Testing

- [x] Unit test: HTTP error handling (401, 429, 500)
- [x] Unit test: SSE `response.failed` event
- [x] Unit test: `Retry-After` header parsing
- [ ] Unit test: Retry logic with backoff (deferred — retry is consumer-side)
- [ ] Integration test: Rate limit error triggers artifact
- [ ] Field test: User sees friendly error messages

## Files Modified

- `packages/livekit-agent-ganglia/src/client.ts` (error handling)
- `packages/livekit-agent-ganglia/src/types/openresponses.ts` (error classes)
- `apps/voice-agent/src/agent.ts` (error feedback)

## Success Criteria

- All error types handled gracefully
- User receives friendly error messages
- Rate limits trigger retry with backoff
- Auth errors don't spam retries
- Error artifacts appear in Flutter app
