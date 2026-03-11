import { describe, test, expect, beforeEach } from "bun:test";
import { handleHttpRequest } from "../src/http/routes";
import { SessionManager } from "../src/session/manager";
import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "../src/session/types";

// ---------------------------------------------------------------------------
// Mock WebSocket — we can't create a real ServerWebSocket in unit tests
// ---------------------------------------------------------------------------

const mockWs = {
  send: () => {},
  close: () => {},
} as unknown as ServerWebSocket<WebSocketData>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  test("returns 200 with status and uptime", async () => {
    const manager = new SessionManager();
    const res = handleHttpRequest(makeRequest("/health"), manager);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// GET /sessions
// ---------------------------------------------------------------------------

describe("GET /sessions", () => {
  test("returns 200 with empty sessions array when none exist", async () => {
    const manager = new SessionManager();
    const res = handleHttpRequest(makeRequest("/sessions"), manager);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });

  test("returns 200 with session summaries when sessions exist", async () => {
    const manager = new SessionManager();
    const session = manager.createSession("Fix the bug", mockWs);

    const res = handleHttpRequest(makeRequest("/sessions"), manager);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe(session.id);
    expect(body.sessions[0].status).toBe("idle");
    expect(body.sessions[0].prompt).toBe("Fix the bug");
    expect(typeof body.sessions[0].createdAt).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Unknown paths → 404
// ---------------------------------------------------------------------------

describe("Unknown paths", () => {
  test("returns 404 with error message", async () => {
    const manager = new SessionManager();
    const res = handleHttpRequest(makeRequest("/unknown"), manager);

    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Not found");
  });
});

// ---------------------------------------------------------------------------
// All responses are JSON
// ---------------------------------------------------------------------------

describe("Content-Type", () => {
  test("/health response has JSON content-type", () => {
    const manager = new SessionManager();
    const res = handleHttpRequest(makeRequest("/health"), manager);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("/sessions response has JSON content-type", () => {
    const manager = new SessionManager();
    const res = handleHttpRequest(makeRequest("/sessions"), manager);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("404 response has JSON content-type", () => {
    const manager = new SessionManager();
    const res = handleHttpRequest(makeRequest("/not-a-route"), manager);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
