# 008: WebSocket Server Entry Point

**Status:** Not Started
**Depends on:** 006, 007
**Blocks:** 009

## Objective

Wire everything together in `src/index.ts` — the Bun.serve() entry point that handles WebSocket upgrades, HTTP routing, and connection lifecycle.

## Files

- `src/index.ts`

## Details

### `Bun.serve()` configuration

```typescript
const server = Bun.serve({
  port: process.env.PORT ? parseInt(process.env.PORT) : 3000,

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, {
        data: { connId: crypto.randomUUID().slice(0, 8) }
      });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    // HTTP routes
    return handleHttpRequest(req, sessionManager);
  },

  websocket: {
    open(ws) {
      // Log connection
    },
    message(ws, raw) {
      // Delegate to JSON-RPC handler
      handleMessage(typeof raw === "string" ? raw : new TextDecoder().decode(raw), ws);
    },
    close(ws, code, reason) {
      // Cleanup: cancel any sessions owned by this connection
    },
  },
});
```

### Startup

- Create the `SessionManager` instance
- Start the server
- Log `Claude Relay listening on port ${server.port}`

### Connection lifecycle

- `open`: log the new connection
- `message`: pass raw string to `handleMessage()`
- `close`: iterate sessions, cancel any that belong to the disconnected client

### Graceful shutdown

Handle `SIGINT` and `SIGTERM`:
- Cancel all active sessions
- Close the server
- Exit cleanly

## Acceptance Criteria

- `bun run src/index.ts` starts server on configurable port (default 3000)
- WebSocket connections accepted at `/ws`
- HTTP requests routed to health/sessions endpoints
- WebSocket messages dispatched to JSON-RPC handler
- Connection close cleans up associated sessions
- `SIGINT` shuts down gracefully
- `tsc --noEmit` passes
