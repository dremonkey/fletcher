# Task 002: Add respond() Method to OpenClawClient

**Epic:** 18 - OpenResponses API Integration  
**Status:** 📋 Planned  
**Depends on:** 001 (Technical Spec)

## Objective

Add a new `respond()` method to `OpenClawClient` in `packages/livekit-agent-ganglia/src/client.ts` that targets the `/v1/responses` endpoint.

## Requirements

- Create `respond(options: OpenClawRespondOptions)` method
- Target `POST ${baseUrl}/v1/responses`
- Use same authentication as existing `chat()` method
- Return `AsyncIterableIterator<OpenResponsesEvent>`
- Maintain backward compatibility (keep existing `chat()` method)

## Interface Definition

```typescript
interface OpenClawRespondOptions {
  input: string | InputItem[];
  instructions?: string;
  tools?: Tool[];
  tool_choice?: ToolChoice;
  stream?: boolean;
  user?: string;  // For stable session routing
  sessionKey?: SessionKey;  // Alternative routing
  session?: LiveKitSessionInfo;  // Metadata
  signal?: AbortSignal;
}

interface OpenResponsesEvent {
  event: string;  // e.g., "response.output_text.delta"
  data: any;      // Event-specific payload
}
```

## Implementation Steps

1. Add `OpenClawRespondOptions` interface to `src/types/index.ts`
2. Add `OpenResponsesEvent` interface to `src/types/index.ts`
3. Implement `respond()` method in `OpenClawClient`
   - Build request body from options
   - Apply session routing (user field or x-openclaw-session-key header)
   - Set `model: "openclaw:main"` (or from config)
   - Handle `stream: true` by default
4. Reuse existing auth logic from `chat()`
5. Parse SSE stream into `OpenResponsesEvent` objects
6. Handle errors (401, 403, 429, etc.)

## Request Body Example

```typescript
const body = {
  model: "openclaw:main",
  input: options.input,
  stream: true,
  user: options.user || deriveUserFromSession(options.session),
};

if (options.instructions) body.instructions = options.instructions;
if (options.tools) body.tools = options.tools;
if (options.tool_choice) body.tool_choice = options.tool_choice;
```

## Session Routing

```typescript
// Priority: sessionKey > user field
if (options.sessionKey?.type === 'owner') {
  headers['x-openclaw-session-key'] = options.sessionKey.key;
} else if (options.user) {
  body.user = options.user;
} else if (options.session) {
  body.user = `fletcher_${options.session.participantIdentity}`;
}
```

## Error Handling

- 401/403: Throw `AuthenticationError`
- 429: Extract `Retry-After` header, throw `RateLimitError`
- 400: Throw `InvalidRequestError` with details
- Network errors: Throw with context

## Testing

- [ ] Unit test: `respond()` sends correct request body
- [ ] Unit test: Session routing (sessionKey vs user)
- [ ] Unit test: Auth headers match `chat()` method
- [ ] Unit test: AbortSignal cancellation
- [ ] Integration test: Connect to real Gateway

## Files Modified

- `packages/livekit-agent-ganglia/src/client.ts`
- `packages/livekit-agent-ganglia/src/types/index.ts`

## Success Criteria

- `respond()` method exists and compiles
- Method sends valid `/v1/responses` requests
- Authentication works
- Session routing works (user field + headers)
- AbortSignal cancellation works
