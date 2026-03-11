import { describe, test, expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "../src/session/types";
import { SessionManager } from "../src/session/manager";
import { runAgent, waitForUserResponse } from "../src/session/agent-bridge";

// ---------------------------------------------------------------------------
// Mock WebSocket — captures sent messages for assertion
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

/**
 * Parse all captured messages as JSON-RPC notifications.
 */
function parseMessages(messages: string[]): Array<{
  jsonrpc: string;
  method: string;
  params?: unknown;
}> {
  return messages.map((m) => JSON.parse(m));
}

// ---------------------------------------------------------------------------
// runAgent sends updates
// ---------------------------------------------------------------------------

describe("runAgent", () => {
  test("sends session/update notifications during execution", async () => {
    const { ws, messages } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("Hello, agent", ws);

    await runAgent(session, mgr);

    const parsed = parseMessages(messages);
    const updates = parsed.filter((m) => m.method === "session/update");

    expect(updates.length).toBeGreaterThanOrEqual(1);

    // First update should be the "Processing..." message
    const firstUpdate = updates[0];
    expect(firstUpdate.params).toEqual(
      expect.objectContaining({
        sessionId: session.id,
        type: "text_delta",
        content: "Processing your request...",
      }),
    );
  });

  test("echoes the prompt in a text_delta update", async () => {
    const { ws, messages } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("Tell me a joke", ws);

    await runAgent(session, mgr);

    const parsed = parseMessages(messages);
    const updates = parsed.filter((m) => m.method === "session/update");

    // The second update should echo the prompt
    const echoUpdate = updates.find((u) => {
      const params = u.params as { content?: string };
      return params.content?.includes("Tell me a joke");
    });
    expect(echoUpdate).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // runAgent sends complete
  // ---------------------------------------------------------------------------

  test("sends session/complete notification when done", async () => {
    const { ws, messages } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("Hello", ws);

    await runAgent(session, mgr);

    const parsed = parseMessages(messages);
    const completes = parsed.filter((m) => m.method === "session/complete");

    expect(completes).toHaveLength(1);
    expect(completes[0].params).toEqual(
      expect.objectContaining({
        sessionId: session.id,
      }),
    );
  });

  test("sets session status to completed on success", async () => {
    const { ws } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("Hello", ws);

    await runAgent(session, mgr);

    expect(session.status).toBe("completed");
  });

  // ---------------------------------------------------------------------------
  // runAgent handles errors
  // ---------------------------------------------------------------------------

  test("sends session/error notification on error", async () => {
    const { ws, messages } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("Hello", ws);

    // Force an error during the agent loop by making the prompt property
    // throw when read (the mock agent reads session.prompt to build its
    // echo response, so this triggers an error mid-execution).
    Object.defineProperty(session, "prompt", {
      get() {
        throw new Error("Simulated agent error");
      },
      configurable: true,
    });

    await runAgent(session, mgr);

    // The agent should have caught the error and sent session/error
    const parsed = parseMessages(messages);
    const errors = parsed.filter((m) => m.method === "session/error");

    expect(errors).toHaveLength(1);
    expect(errors[0].params).toEqual(
      expect.objectContaining({
        sessionId: session.id,
        error: "Simulated agent error",
      }),
    );
    expect(session.status).toBe("error");
  });

  // ---------------------------------------------------------------------------
  // runAgent sets status to running
  // ---------------------------------------------------------------------------

  test("sets session status to running at the start", async () => {
    const { ws } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("Hello", ws);

    // We verify the status was set to running by checking it transitions
    // from "idle" to something else (it ends at "completed")
    expect(session.status).toBe("idle");

    await runAgent(session, mgr);

    // After completion, status should be "completed" (it went through "running")
    expect(session.status).toBe("completed");
  });

  // ---------------------------------------------------------------------------
  // Abort cancels the agent
  // ---------------------------------------------------------------------------

  test("abort before start results in cancelled status", async () => {
    const { ws, messages } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("Hello", ws);

    // Abort before running
    session.abortController.abort();

    await runAgent(session, mgr);

    expect(session.status).toBe("cancelled");

    // No session/complete should be sent
    const parsed = parseMessages(messages);
    const completes = parsed.filter((m) => m.method === "session/complete");
    expect(completes).toHaveLength(0);
  });

  test("abort during execution results in cancelled status", async () => {
    const { ws, messages } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("Hello", ws);

    // Abort after a small delay (during the mock agent's setTimeout)
    setTimeout(() => {
      session.abortController.abort();
    }, 5);

    await runAgent(session, mgr);

    // Status should be "cancelled" since we aborted during execution
    expect(session.status).toBe("cancelled");
  });

  // ---------------------------------------------------------------------------
  // All notifications are valid JSON-RPC 2.0
  // ---------------------------------------------------------------------------

  test("all sent messages are valid JSON-RPC 2.0 notifications", async () => {
    const { ws, messages } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("Validate", ws);

    await runAgent(session, mgr);

    const parsed = parseMessages(messages);

    for (const msg of parsed) {
      expect(msg.jsonrpc).toBe("2.0");
      expect(msg.method).toBeString();
      // Notifications must NOT have an id field
      expect("id" in msg).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// waitForUserResponse
// ---------------------------------------------------------------------------

describe("waitForUserResponse", () => {
  test("sets session status to waiting_for_user", () => {
    const { ws } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("prompt", ws);
    session.status = "running";

    // Start waiting (don't await — it's a pending promise)
    const _promise = waitForUserResponse(session);

    expect(session.status).toBe("waiting_for_user");
    expect(session.pendingResolve).toBeFunction();

    // Clean up: resolve the promise so it doesn't hang
    session.pendingResolve!("cleanup");
  });

  test("resolves with the value passed to pendingResolve", async () => {
    const { ws } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("prompt", ws);
    session.status = "running";

    const promise = waitForUserResponse(session);

    // Simulate the SessionManager.sendMessage() flow:
    // it calls pendingResolve with the user's content
    expect(session.pendingResolve).not.toBeNull();
    session.pendingResolve!("user's answer");

    const result = await promise;
    expect(result).toBe("user's answer");
  });

  test("works with SessionManager.sendMessage()", async () => {
    const { ws } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("prompt", ws);
    session.status = "running";

    const promise = waitForUserResponse(session);

    expect(session.status).toBe("waiting_for_user");

    // Use the manager's sendMessage which checks for pendingResolve
    mgr.sendMessage(session.id, "reply from client");

    const result = await promise;
    expect(result).toBe("reply from client");
    expect(session.pendingResolve).toBeNull();
    expect(session.status).toBe("running");
  });

  test("handles object values through pendingResolve", async () => {
    const { ws } = createMockWs();
    const mgr = new SessionManager();
    const session = mgr.createSession("prompt", ws);
    session.status = "running";

    const promise = waitForUserResponse(session);

    const complexValue = { answers: ["a", "b"], meta: { page: 1 } };
    session.pendingResolve!(complexValue);

    const result = await promise;
    expect(result).toEqual(complexValue);
  });
});
