# 009: WebSocket Round-Trip Test

**Status:** Not Started
**Depends on:** 008

## Objective

Write a basic integration test that verifies the full WebSocket → JSON-RPC → session → response pipeline works end-to-end.

## Files

- `test/echo.test.ts`

## Details

### Test setup

- Start the server (import from `src/index.ts` or spawn as subprocess)
- Connect a WebSocket client to `ws://localhost:3000/ws`

### Test cases

#### 1. `session/new` returns a session ID

```typescript
// Send
ws.send(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "session/new",
  params: { prompt: "Say hello" }
}));

// Expect: JSON-RPC response with sessionId
// Expect: one or more session/update notifications
// Expect: session/complete notification
```

#### 2. `session/list` returns sessions

```typescript
// Send
ws.send(JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "session/list"
}));

// Expect: JSON-RPC response with sessions array
```

#### 3. Unknown method returns error

```typescript
// Send
ws.send(JSON.stringify({
  jsonrpc: "2.0",
  id: 3,
  method: "foo/bar"
}));

// Expect: JSON-RPC error response with code -32601
```

#### 4. Invalid JSON returns parse error

```typescript
ws.send("not json");
// Expect: JSON-RPC error with code -32700
```

#### 5. `session/cancel` stops a running session

```typescript
// Start a session, then immediately cancel it
// Verify session status becomes "cancelled"
```

### Test framework

Use Bun's built-in test runner (`bun test`). Use `describe`/`test`/`expect` from `bun:test`.

### Note on Agent SDK

If the Agent SDK is not available or requires API keys, the test should still verify the JSON-RPC layer works correctly. Consider:
- Mocking the agent bridge to return canned responses
- Or testing with the SDK if keys are available, falling back to mocks

## Acceptance Criteria

- `bun test` runs and passes all test cases
- Tests cover happy path (new session, list) and error paths (bad JSON, unknown method)
- Tests clean up after themselves (close connections, stop server)
