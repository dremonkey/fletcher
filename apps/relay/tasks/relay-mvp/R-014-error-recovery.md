# R-014: Error Recovery (Retry Logic, Graceful Degradation)

**Depends On:** R-006, R-008  
**Blocks:** None  
**Effort:** 2 hours  

## Objective
Implement error recovery strategies for common failure modes.

## Reference
See `docs/gateway-api-contract.md` section "Error Handling"

## Failure Modes to Handle
1. **OpenClaw unreachable** → Retry 5xx with backoff (max 3 attempts)
2. **LiveKit disconnect** → SDK auto-reconnects; buffer messages during reconnect
3. **Malformed JSON-RPC** → Return error `-32700`
4. **Session not found** → Return error `-32000`
5. **OpenClaw timeout** → Send `session/error` to client

## Key Changes
- Update `src/openclaw/client.ts` with retry logic
- Update `src/rpc/dispatcher.ts` with try/catch and error mapping
- Update `src/data-channel/transport.ts` to buffer messages during reconnect

## Acceptance Criteria
✅ 503 errors retried with exponential backoff (1s, 2s, 4s)  
✅ 4xx errors surfaced immediately (no retry)  
✅ Malformed JSON → `session/error` sent to client  
✅ Session not found → `-32000` error  
✅ OpenClaw timeout → `session/error` with code `TIMEOUT`  
