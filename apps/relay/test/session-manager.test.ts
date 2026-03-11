import { describe, test, expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "../src/session/types";
import { SessionManager } from "../src/session/manager";

// ---------------------------------------------------------------------------
// Mock WebSocket — we can't create a real ServerWebSocket in unit tests
// ---------------------------------------------------------------------------

const mockWs = {
  send: () => {},
  close: () => {},
} as unknown as ServerWebSocket<WebSocketData>;

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe("SessionManager.createSession", () => {
  test("creates a session with correct fields", () => {
    const mgr = new SessionManager();
    const session = mgr.createSession("Hello, Claude", mockWs);

    expect(session.id).toBeString();
    expect(session.id.length).toBe(8);
    expect(session.status).toBe("idle");
    expect(session.createdAt).toBeNumber();
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.prompt).toBe("Hello, Claude");
    expect(session.ws).toBe(mockWs);
    expect(session.pendingResolve).toBeNull();
    expect(session.abortController).toBeInstanceOf(AbortController);
    expect(session.abortController.signal.aborted).toBe(false);
    expect(session.inputChannel).not.toBeNull();
  });

  test("generates unique IDs for multiple sessions", () => {
    const mgr = new SessionManager();
    const s1 = mgr.createSession("prompt 1", mockWs);
    const s2 = mgr.createSession("prompt 2", mockWs);
    expect(s1.id).not.toBe(s2.id);
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe("SessionManager.getSession", () => {
  test("returns session by ID", () => {
    const mgr = new SessionManager();
    const created = mgr.createSession("test prompt", mockWs);
    const retrieved = mgr.getSession(created.id);

    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.prompt).toBe("test prompt");
  });

  test("returns undefined for unknown ID", () => {
    const mgr = new SessionManager();
    expect(mgr.getSession("nonexist")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

describe("SessionManager.sendMessage", () => {
  test("resolves pendingResolve when set", async () => {
    const mgr = new SessionManager();
    const session = mgr.createSession("prompt", mockWs);

    // Simulate the agent waiting for user input
    let resolvedValue: unknown = null;
    session.pendingResolve = (value: unknown) => {
      resolvedValue = value;
    };
    session.status = "waiting_for_user";

    mgr.sendMessage(session.id, "user reply");

    expect(resolvedValue).toBe("user reply");
    expect(session.pendingResolve).toBeNull();
    expect(session.status).toBe("running");
  });

  test("pushes to input channel when no pendingResolve", async () => {
    const mgr = new SessionManager();
    const session = mgr.createSession("prompt", mockWs);

    // No pendingResolve — message should go to the input channel
    mgr.sendMessage(session.id, "buffered message");

    // Read the message back from the channel
    const iter = session.inputChannel![Symbol.asyncIterator]();
    const result = await iter.next();
    expect(result.done).toBe(false);
    expect(result.value).toBe("buffered message");
  });

  test("throws for unknown session", () => {
    const mgr = new SessionManager();
    expect(() => mgr.sendMessage("bad-id", "hello")).toThrow(
      "Session not found: bad-id",
    );
  });
});

// ---------------------------------------------------------------------------
// cancelSession
// ---------------------------------------------------------------------------

describe("SessionManager.cancelSession", () => {
  test("sets status to cancelled and fires abort signal", () => {
    const mgr = new SessionManager();
    const session = mgr.createSession("prompt", mockWs);

    expect(session.abortController.signal.aborted).toBe(false);
    expect(session.status).toBe("idle");

    mgr.cancelSession(session.id);

    expect(session.status).toBe("cancelled");
    expect(session.abortController.signal.aborted).toBe(true);
  });

  test("closes the input channel", async () => {
    const mgr = new SessionManager();
    const session = mgr.createSession("prompt", mockWs);

    mgr.cancelSession(session.id);

    // After closing, the iterator should immediately return done: true
    const iter = session.inputChannel![Symbol.asyncIterator]();
    const result = await iter.next();
    expect(result.done).toBe(true);
  });

  test("throws for unknown session", () => {
    const mgr = new SessionManager();
    expect(() => mgr.cancelSession("bad-id")).toThrow(
      "Session not found: bad-id",
    );
  });
});

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe("SessionManager.listSessions", () => {
  test("returns empty array when no sessions exist", () => {
    const mgr = new SessionManager();
    expect(mgr.listSessions()).toEqual([]);
  });

  test("returns summaries of all sessions", () => {
    const mgr = new SessionManager();
    const s1 = mgr.createSession("prompt one", mockWs);
    const s2 = mgr.createSession("prompt two", mockWs);

    const list = mgr.listSessions();

    expect(list).toHaveLength(2);

    const ids = list.map((s) => s.id);
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);

    for (const summary of list) {
      expect(summary).toHaveProperty("id");
      expect(summary).toHaveProperty("status");
      expect(summary).toHaveProperty("createdAt");
      expect(summary).toHaveProperty("prompt");
      // Summaries should NOT leak internal fields
      expect(summary).not.toHaveProperty("ws");
      expect(summary).not.toHaveProperty("abortController");
      expect(summary).not.toHaveProperty("inputChannel");
      expect(summary).not.toHaveProperty("pendingResolve");
    }
  });
});

// ---------------------------------------------------------------------------
// removeSession
// ---------------------------------------------------------------------------

describe("SessionManager.removeSession", () => {
  test("session is no longer retrievable after removal", () => {
    const mgr = new SessionManager();
    const session = mgr.createSession("prompt", mockWs);

    expect(mgr.getSession(session.id)).toBeDefined();
    mgr.removeSession(session.id);
    expect(mgr.getSession(session.id)).toBeUndefined();
  });

  test("removing a non-existent session does not throw", () => {
    const mgr = new SessionManager();
    expect(() => mgr.removeSession("nonexist")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateSessionStatus
// ---------------------------------------------------------------------------

describe("SessionManager.updateSessionStatus", () => {
  test("updates the status field", () => {
    const mgr = new SessionManager();
    const session = mgr.createSession("prompt", mockWs);

    expect(session.status).toBe("idle");

    mgr.updateSessionStatus(session.id, "running");
    expect(session.status).toBe("running");

    mgr.updateSessionStatus(session.id, "completed");
    expect(session.status).toBe("completed");
  });

  test("throws for unknown session", () => {
    const mgr = new SessionManager();
    expect(() => mgr.updateSessionStatus("bad-id", "running")).toThrow(
      "Session not found: bad-id",
    );
  });
});
