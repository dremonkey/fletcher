# 002: JSON-RPC Types and Error Codes

**Status:** Not Started
**Depends on:** 001
**Blocks:** 005, 006

## Objective

Define the JSON-RPC 2.0 type system and standard error codes used across the relay.

## Files

- `src/rpc/types.ts`
- `src/rpc/errors.ts`

## Details

### `src/rpc/types.ts`

Define TypeScript types for the JSON-RPC 2.0 wire format:

- `JsonRpcRequest` — `{ jsonrpc: "2.0", id: string | number, method: string, params?: unknown }`
- `JsonRpcResponse` — success (`result`) or error (`error`) with matching `id`
- `JsonRpcNotification` — `{ jsonrpc: "2.0", method: string, params?: unknown }` (no `id`)
- `JsonRpcError` — `{ code: number, message: string, data?: unknown }`
- Helper function `isRequest(msg)` to distinguish requests from notifications
- Helper function `makeResponse(id, result)` to build success responses
- Helper function `makeError(id, code, message)` to build error responses
- Helper function `makeNotification(method, params)` to build notifications

### `src/rpc/errors.ts`

Standard JSON-RPC error codes as constants:

| Code   | Name             | When                            |
|--------|------------------|---------------------------------|
| -32700 | Parse Error      | Invalid JSON received           |
| -32600 | Invalid Request  | Not a valid JSON-RPC structure  |
| -32601 | Method Not Found | Unknown method string           |
| -32602 | Invalid Params   | Wrong or missing params         |
| -32603 | Internal Error   | Unexpected server error         |

Plus application-level codes:

| Code  | Name             | When                            |
|-------|------------------|---------------------------------|
| -1    | Session Not Found| sessionId doesn't exist         |
| -2    | Session Busy     | Session already processing      |

## Acceptance Criteria

- All types are exported and importable
- Helper functions produce spec-compliant JSON-RPC objects
- `tsc --noEmit` passes
