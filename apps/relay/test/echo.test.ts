import { describe, test, expect, afterAll } from "bun:test";

// Import starts the server (module-level Bun.serve).
// The PORT env var is set before running via: PORT=0 bun test test/echo.test.ts
// or defaults to 3000. We use server.port which reflects the actual bound port.
import { server, manager } from "../src/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Connect a WebSocket client to the running server. */
function connectWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
  });
}

/** Wait for the next message on a WebSocket. */
function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.onmessage = (event) => {
      resolve(JSON.parse(event.data as string));
    };
  });
}

/**
 * Wait for a JSON-RPC response matching a specific request `id`.
 * Notifications (messages without an `id`) are collected in `extras` and ignored.
 * Times out after `timeoutMs` to prevent hanging.
 */
function waitForResponse(
  ws: WebSocket,
  expectedId: number,
  timeoutMs = 5000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for response with id=${expectedId}`));
    }, timeoutMs);

    const prev = ws.onmessage;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string);
      if (msg.id === expectedId) {
        clearTimeout(timer);
        ws.onmessage = prev;
        resolve(msg);
      }
      // Otherwise it's a notification — ignore and keep waiting
    };
  });
}

/** Collect exactly `count` messages from a WebSocket, with a timeout. */
function collectMessages(
  ws: WebSocket,
  count: number,
  timeoutMs = 5000,
): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = [];
    const timer = setTimeout(() => {
      // Resolve with whatever we have rather than hang forever
      resolve(messages);
    }, timeoutMs);

    ws.onmessage = (event) => {
      messages.push(JSON.parse(event.data as string));
      if (messages.length === count) {
        clearTimeout(timer);
        resolve(messages);
      }
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebSocket integration", () => {
  afterAll(() => {
    server.stop();
  });

  test("session/new returns sessionId", async () => {
    const ws = await connectWs();

    // The mock agent sends: 1 response + 2 session/update + 1 session/complete = 4 messages
    // but their order is not guaranteed (the agent runs fire-and-forget).
    const messagesPromise = collectMessages(ws, 4);

    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "session/new",
        params: { prompt: "Hello world" },
      }),
    );

    const messages = await messagesPromise;

    // Find the JSON-RPC response by id (may not be the first message)
    const response = messages.find((m: any) => m.id === 1);
    expect(response).toBeDefined();
    expect(response.jsonrpc).toBe("2.0");
    expect(response.result.sessionId).toBeDefined();
    expect(typeof response.result.sessionId).toBe("string");

    // Should have session/update notifications
    const updates = messages.filter(
      (m: any) => m.method === "session/update",
    );
    expect(updates.length).toBeGreaterThan(0);

    // Should have session/complete notification
    const complete = messages.find(
      (m: any) => m.method === "session/complete",
    );
    expect(complete).toBeDefined();

    ws.close();
  });

  test("session/list returns sessions array", async () => {
    const ws = await connectWs();
    const responsePromise = waitForResponse(ws, 2);

    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "session/list",
      }),
    );

    const response = await responsePromise;
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(2);
    expect(Array.isArray(response.result.sessions)).toBe(true);

    ws.close();
  });

  test("unknown method returns -32601", async () => {
    const ws = await connectWs();
    const responsePromise = waitForResponse(ws, 3);

    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "foo/bar",
      }),
    );

    const response = await responsePromise;
    expect(response.jsonrpc).toBe("2.0");
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32601);

    ws.close();
  });

  test("invalid JSON returns -32700", async () => {
    const ws = await connectWs();
    const msgPromise = nextMessage(ws);

    ws.send("not json {{{");

    const response = await msgPromise;
    expect(response.jsonrpc).toBe("2.0");
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32700);

    ws.close();
  });

  test("session/cancel stops a running session", async () => {
    const ws = await connectWs();

    // Start a new session — use waitForResponse to skip any notifications
    const newResponsePromise = waitForResponse(ws, 4);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "session/new",
        params: { prompt: "Cancel me" },
      }),
    );
    const newResponse = await newResponsePromise;
    const sessionId = newResponse.result.sessionId;
    expect(sessionId).toBeDefined();

    // Immediately cancel it
    const cancelResponsePromise = waitForResponse(ws, 5);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "session/cancel",
        params: { sessionId },
      }),
    );
    const cancelResponse = await cancelResponsePromise;

    expect(cancelResponse.jsonrpc).toBe("2.0");
    expect(cancelResponse.id).toBe(5);
    expect(cancelResponse.result.ok).toBe(true);

    // Verify session is cancelled via session/list
    const listResponsePromise = waitForResponse(ws, 6);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "session/list",
      }),
    );
    const listResponse = await listResponsePromise;
    const session = listResponse.result.sessions.find(
      (s: any) => s.id === sessionId,
    );
    expect(session).toBeDefined();
    expect(session.status).toBe("cancelled");

    ws.close();
  });

  test("GET /health returns 200", async () => {
    const response = await fetch(`http://localhost:${server.port}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
  });
});
