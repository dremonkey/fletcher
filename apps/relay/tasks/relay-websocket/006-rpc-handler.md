# 006: JSON-RPC Dispatch Handler

**Status:** Not Started
**Depends on:** 002, 004
**Blocks:** 008

## Objective

Implement the JSON-RPC message dispatcher that routes incoming WebSocket messages to the correct handler functions.

## Files

- `src/rpc/handler.ts`

## Details

### `handleMessage(raw: string, ws: ServerWebSocket<WebSocketData>): void`

Main entry point called from the WebSocket `message` event:

1. **Parse JSON** — catch `SyntaxError`, send parse error response
2. **Validate structure** — check `jsonrpc: "2.0"`, presence of `method`, send invalid request error if malformed
3. **Dispatch by method:**

| Method            | Handler                                         |
|-------------------|-------------------------------------------------|
| `session/new`     | Validate `params.prompt`, create session via manager, start agent bridge, return `{ sessionId }` |
| `session/message` | Validate `params.sessionId` + `params.content`, call `manager.sendMessage()`, return `{ ok: true }` |
| `session/resume`  | Validate `params.sessionId` + `params.prompt`, resume session, return `{ sessionId }` |
| `session/cancel`  | Validate `params.sessionId`, call `manager.cancelSession()`, return `{ ok: true }` |
| `session/list`    | Call `manager.listSessions()`, return session list |

4. **Send response** — for requests (have `id`), always send a JSON-RPC response back
5. **Error handling** — wrap each handler in try/catch, send internal error on unexpected failures

### Handler pattern

Each method handler is a simple async function:

```typescript
type RpcHandler = (params: unknown, ws: ServerWebSocket<WebSocketData>) => Promise<unknown>;

const handlers: Record<string, RpcHandler> = {
  "session/new": handleSessionNew,
  "session/message": handleSessionMessage,
  // ...
};
```

### Parameter validation

Keep it simple — check required fields exist and are the right type. No schema library needed. Return `-32602 Invalid Params` with a descriptive message on failure.

## Acceptance Criteria

- Valid JSON-RPC requests are dispatched to correct handlers
- Invalid JSON returns parse error
- Unknown methods return method-not-found error
- Missing/wrong params return invalid-params error
- Each handler returns a proper JSON-RPC response
- `tsc --noEmit` passes
