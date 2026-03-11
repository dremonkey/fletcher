import { describe, test, expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { WebSocketData, Session } from "../src/session/types";
import { SessionManager } from "../src/session/manager";
import { createRpcHandler } from "../src/rpc/handler";
import {
  PARSE_ERROR,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  INTERNAL_ERROR,
  SESSION_NOT_FOUND,
} from "../src/rpc/errors";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockWs(): {
  ws: ServerWebSocket<WebSocketData>;
  messages: string[];
} {
  const messages: string[] = [];
  const ws = {
    send: (msg: string) => messages.push(msg),
    close: () => {},
  } as unknown as ServerWebSocket<WebSocketData>;
  return { ws, messages };
}

/** No-op agent runner for handler tests. */
const mockRunAgent = async () => {};

/** Build a valid JSON-RPC request string. */
function rpcRequest(
  id: string | number,
  method: string,
  params?: unknown,
): string {
  const msg: Record<string, unknown> = { jsonrpc: "2.0", id, method };
  if (params !== undefined) msg.params = params;
  return JSON.stringify(msg);
}

/** Build a JSON-RPC notification string (no id). */
function rpcNotification(method: string, params?: unknown): string {
  const msg: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (params !== undefined) msg.params = params;
  return JSON.stringify(msg);
}

/** Parse the first message sent back on the mock ws. */
function parseResponse(messages: string[]): Record<string, unknown> {
  expect(messages.length).toBeGreaterThanOrEqual(1);
  return JSON.parse(messages[0]) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Parse errors
// ---------------------------------------------------------------------------

describe("RPC handler — parse errors", () => {
  test("invalid JSON returns parse error (-32700)", () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle("not valid json{{{", ws);

    const res = parseResponse(messages);
    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBeNull();
    expect((res.error as Record<string, unknown>).code).toBe(PARSE_ERROR);
  });
});

// ---------------------------------------------------------------------------
// Invalid request
// ---------------------------------------------------------------------------

describe("RPC handler — invalid request", () => {
  test("missing jsonrpc field returns invalid request (-32600)", () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(JSON.stringify({ id: 1, method: "ping" }), ws);

    const res = parseResponse(messages);
    expect(res.id).toBeNull();
    expect((res.error as Record<string, unknown>).code).toBe(INVALID_REQUEST);
  });

  test("missing method field returns invalid request (-32600)", () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(JSON.stringify({ jsonrpc: "2.0", id: 1 }), ws);

    const res = parseResponse(messages);
    expect((res.error as Record<string, unknown>).code).toBe(INVALID_REQUEST);
  });

  test("wrong jsonrpc version returns invalid request (-32600)", () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" }), ws);

    const res = parseResponse(messages);
    expect((res.error as Record<string, unknown>).code).toBe(INVALID_REQUEST);
  });
});

// ---------------------------------------------------------------------------
// Method not found
// ---------------------------------------------------------------------------

describe("RPC handler — method not found", () => {
  test("unknown method returns method not found (-32601)", () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(rpcRequest(1, "nonexistent/method"), ws);

    const res = parseResponse(messages);
    expect(res.id).toBe(1);
    expect((res.error as Record<string, unknown>).code).toBe(METHOD_NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// session/new
// ---------------------------------------------------------------------------

describe("RPC handler — session/new", () => {
  test("valid prompt creates session and returns sessionId", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(rpcRequest(1, "session/new", { prompt: "Hello, Claude" }), ws);

    // Handler is async — give it a tick to resolve
    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(1);
    const result = res.result as Record<string, unknown>;
    expect(typeof result.sessionId).toBe("string");
    expect((result.sessionId as string).length).toBe(8);

    // Verify the session actually exists in the manager
    const session = manager.getSession(result.sessionId as string);
    expect(session).toBeDefined();
    expect(session!.prompt).toBe("Hello, Claude");
  });

  test("missing prompt returns invalid params (-32602)", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(rpcRequest(2, "session/new", {}), ws);

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(2);
    expect((res.error as Record<string, unknown>).code).toBe(INVALID_PARAMS);
  });

  test("non-string prompt returns invalid params (-32602)", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(rpcRequest(3, "session/new", { prompt: 42 }), ws);

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(3);
    expect((res.error as Record<string, unknown>).code).toBe(INVALID_PARAMS);
  });

  test("no params returns invalid params (-32602)", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(rpcRequest(4, "session/new"), ws);

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(4);
    expect((res.error as Record<string, unknown>).code).toBe(INVALID_PARAMS);
  });

  test("fires runAgent in the background", async () => {
    const manager = new SessionManager();
    let agentStarted = false;
    const trackingRunner = async (session: Session) => {
      agentStarted = true;
    };
    const handle = createRpcHandler(manager, trackingRunner);
    const { ws, messages } = createMockWs();

    handle(rpcRequest(5, "session/new", { prompt: "test" }), ws);

    await Bun.sleep(10);

    expect(agentStarted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// session/list
// ---------------------------------------------------------------------------

describe("RPC handler — session/list", () => {
  test("returns empty sessions array when no sessions exist", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(rpcRequest(1, "session/list"), ws);

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(1);
    const result = res.result as Record<string, unknown>;
    expect(result.sessions).toEqual([]);
  });

  test("returns all sessions in the list", async () => {
    const manager = new SessionManager();
    const { ws: ws1 } = createMockWs();
    manager.createSession("prompt one", ws1);
    manager.createSession("prompt two", ws1);

    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(rpcRequest(2, "session/list"), ws);

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(2);
    const result = res.result as Record<string, unknown>;
    const sessions = result.sessions as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// session/message
// ---------------------------------------------------------------------------

describe("RPC handler — session/message", () => {
  test("valid params returns { ok: true }", async () => {
    const manager = new SessionManager();
    const { ws: sessionWs } = createMockWs();
    const session = manager.createSession("prompt", sessionWs);

    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(
      rpcRequest(1, "session/message", {
        sessionId: session.id,
        content: "hello",
      }),
      ws,
    );

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(1);
    expect(res.result).toEqual({ ok: true });
  });

  test("unknown session returns session not found error", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(
      rpcRequest(2, "session/message", {
        sessionId: "nonexist",
        content: "hello",
      }),
      ws,
    );

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(2);
    expect((res.error as Record<string, unknown>).code).toBe(SESSION_NOT_FOUND);
  });

  test("missing sessionId returns invalid params (-32602)", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(
      rpcRequest(3, "session/message", { content: "hello" }),
      ws,
    );

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(3);
    expect((res.error as Record<string, unknown>).code).toBe(INVALID_PARAMS);
  });

  test("missing content returns invalid params (-32602)", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(
      rpcRequest(4, "session/message", { sessionId: "abc" }),
      ws,
    );

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(4);
    expect((res.error as Record<string, unknown>).code).toBe(INVALID_PARAMS);
  });
});

// ---------------------------------------------------------------------------
// session/cancel
// ---------------------------------------------------------------------------

describe("RPC handler — session/cancel", () => {
  test("valid sessionId returns { ok: true }", async () => {
    const manager = new SessionManager();
    const { ws: sessionWs } = createMockWs();
    const session = manager.createSession("prompt", sessionWs);

    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(
      rpcRequest(1, "session/cancel", { sessionId: session.id }),
      ws,
    );

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(1);
    expect(res.result).toEqual({ ok: true });

    // Verify the session was actually cancelled
    const cancelled = manager.getSession(session.id);
    expect(cancelled!.status).toBe("cancelled");
  });

  test("unknown session returns session not found error", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(
      rpcRequest(2, "session/cancel", { sessionId: "nonexist" }),
      ws,
    );

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(2);
    expect((res.error as Record<string, unknown>).code).toBe(SESSION_NOT_FOUND);
  });

  test("missing sessionId returns invalid params (-32602)", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(rpcRequest(3, "session/cancel", {}), ws);

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(3);
    expect((res.error as Record<string, unknown>).code).toBe(INVALID_PARAMS);
  });
});

// ---------------------------------------------------------------------------
// session/resume
// ---------------------------------------------------------------------------

describe("RPC handler — session/resume", () => {
  test("valid params resumes and returns sessionId", async () => {
    const manager = new SessionManager();
    const { ws: sessionWs } = createMockWs();
    const session = manager.createSession("original prompt", sessionWs);

    let resumedSession: Session | null = null;
    const trackingRunner = async (s: Session) => {
      resumedSession = s;
    };

    const handle = createRpcHandler(manager, trackingRunner);
    const { ws, messages } = createMockWs();

    handle(
      rpcRequest(1, "session/resume", {
        sessionId: session.id,
        prompt: "new prompt",
      }),
      ws,
    );

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(1);
    expect(res.result).toEqual({ sessionId: session.id });

    // Verify the prompt was updated and agent was started
    expect(resumedSession).not.toBeNull();
    expect(resumedSession!.prompt).toBe("new prompt");
  });

  test("unknown session returns session not found error", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(
      rpcRequest(2, "session/resume", {
        sessionId: "nonexist",
        prompt: "test",
      }),
      ws,
    );

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(2);
    expect((res.error as Record<string, unknown>).code).toBe(SESSION_NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// Notifications (no id) — should not send any response
// ---------------------------------------------------------------------------

describe("RPC handler — notifications", () => {
  test("notification (no id) does not produce a response", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(rpcNotification("session/list"), ws);

    await Bun.sleep(10);

    expect(messages).toHaveLength(0);
  });

  test("notification to unknown method does not produce a response", async () => {
    const manager = new SessionManager();
    const handle = createRpcHandler(manager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(rpcNotification("nonexistent/method"), ws);

    await Bun.sleep(10);

    expect(messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Internal error handling
// ---------------------------------------------------------------------------

describe("RPC handler — internal errors", () => {
  test("unexpected handler error returns internal error (-32603)", async () => {
    const manager = new SessionManager();
    const failingRunner = async () => {
      throw new Error("unexpected boom");
    };
    // We need a handler that will actually throw an unexpected error.
    // Use session/new — the runAgent is fire-and-forget, so it won't cause
    // an internal error on the handler. Instead, let's use a custom approach:
    // create a manager mock that throws unexpectedly on listSessions.
    const brokenManager = {
      listSessions() {
        throw new Error("database exploded");
      },
    } as unknown as SessionManager;

    const handle = createRpcHandler(brokenManager, mockRunAgent);
    const { ws, messages } = createMockWs();

    handle(rpcRequest(1, "session/list"), ws);

    await Bun.sleep(10);

    const res = parseResponse(messages);
    expect(res.id).toBe(1);
    expect((res.error as Record<string, unknown>).code).toBe(INTERNAL_ERROR);
  });
});
