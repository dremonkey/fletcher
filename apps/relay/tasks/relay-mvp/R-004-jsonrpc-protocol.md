# R-004: JSON-RPC 2.0 Protocol (Parser/Serializer/Errors)

**Depends On:** R-001  
**Blocks:** R-005  
**Effort:** 2 hours  

## Objective
Implement JSON-RPC 2.0 parser, serializer, and standard error codes.

## Reference
See `docs/data-channel-protocol.md` sections:
- "JSON-RPC 2.0 Protocol" — Base message format
- "Standard Error Codes" — Error code definitions

## Key Files
- `src/jsonrpc/parser.ts` — Parse and validate JSON-RPC messages
- `src/jsonrpc/serializer.ts` — Serialize responses/notifications
- `src/jsonrpc/errors.ts` — Error code constants and helpers

## Acceptance Criteria
✅ Parse request: `{ jsonrpc, method, params, id }`  
✅ Parse response: `{ jsonrpc, result, id }`  
✅ Parse notification: `{ jsonrpc, method, params }` (no id)  
✅ Validate `jsonrpc: "2.0"`  
✅ Return error code `-32700` for invalid JSON  
✅ Return error code `-32600` for missing required fields  
✅ Serialize success response with `result`  
✅ Serialize error response with `error: { code, message, data? }`  
