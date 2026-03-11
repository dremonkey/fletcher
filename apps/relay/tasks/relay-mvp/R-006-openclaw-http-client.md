# R-006: OpenClaw HTTP Client (Streaming SSE Support)

**Depends On:** R-001  
**Blocks:** R-008, R-009  
**Effort:** 3 hours  

## Objective
Implement HTTP client for OpenClaw Gateway API with SSE streaming support.

## Reference
See `docs/gateway-api-contract.md` sections:
- "Endpoints" → `/v1/chat/completions`
- "Session Routing Rules"
- "Response (Streaming)" → SSE format
- "Error Handling"

## Key File
- `src/openclaw/client.ts`

## Features
- `POST /v1/chat/completions` with streaming: true
- Parse SSE chunks (`data: {...}\n\n`)
- Extract `choices[0].delta.content` from each chunk
- Handle `[DONE]` sentinel
- Abort with AbortController on `session/cancel`
- Retry logic for 5xx errors (exponential backoff)
- Session key routing (header or body.user field)

## Acceptance Criteria
✅ Send chat completion request with messages array  
✅ Stream SSE chunks and yield text deltas  
✅ Handle finish_reason: "stop" correctly  
✅ Retry 503 errors with backoff (max 3 attempts)  
✅ Surface 4xx errors immediately (no retry)  
✅ Support AbortSignal for cancellation  
