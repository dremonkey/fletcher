import { describe, test, expect } from "bun:test";
import { handleHttpRequest } from "../src/http/routes";

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
    const res = handleHttpRequest(makeRequest("/health"));

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Unknown paths -> 404
// ---------------------------------------------------------------------------

describe("Unknown paths", () => {
  test("returns 404 with error message", async () => {
    const res = handleHttpRequest(makeRequest("/unknown"));

    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("/sessions returns 404 (endpoint removed)", async () => {
    const res = handleHttpRequest(makeRequest("/sessions"));

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// All responses are JSON
// ---------------------------------------------------------------------------

describe("Content-Type", () => {
  test("/health response has JSON content-type", () => {
    const res = handleHttpRequest(makeRequest("/health"));
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("404 response has JSON content-type", () => {
    const res = handleHttpRequest(makeRequest("/not-a-route"));
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
