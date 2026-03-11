import { describe, expect, test } from "bun:test";
import {
  isRequest,
  makeResponse,
  makeErrorResponse,
  makeNotification,
} from "../src/rpc/types";
import {
  PARSE_ERROR,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  INTERNAL_ERROR,
  SESSION_NOT_FOUND,
  SESSION_BUSY,
} from "../src/rpc/errors";

// ---------------------------------------------------------------------------
// isRequest
// ---------------------------------------------------------------------------

describe("isRequest", () => {
  test("returns true for a valid request with string id", () => {
    const msg = { jsonrpc: "2.0", id: "abc", method: "ping" };
    expect(isRequest(msg)).toBe(true);
  });

  test("returns true for a valid request with numeric id", () => {
    const msg = { jsonrpc: "2.0", id: 1, method: "ping" };
    expect(isRequest(msg)).toBe(true);
  });

  test("returns true for a request with params", () => {
    const msg = { jsonrpc: "2.0", id: 42, method: "echo", params: { text: "hi" } };
    expect(isRequest(msg)).toBe(true);
  });

  test("returns false for a notification (no id)", () => {
    const msg = { jsonrpc: "2.0", method: "update" };
    expect(isRequest(msg)).toBe(false);
  });

  test("returns false for null", () => {
    expect(isRequest(null)).toBe(false);
  });

  test("returns false for a string", () => {
    expect(isRequest("hello")).toBe(false);
  });

  test("returns false for an object missing jsonrpc", () => {
    const msg = { id: 1, method: "ping" };
    expect(isRequest(msg)).toBe(false);
  });

  test("returns false for an object with wrong jsonrpc version", () => {
    const msg = { jsonrpc: "1.0", id: 1, method: "ping" };
    expect(isRequest(msg)).toBe(false);
  });

  test("returns false for an object missing method", () => {
    const msg = { jsonrpc: "2.0", id: 1 };
    expect(isRequest(msg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeResponse
// ---------------------------------------------------------------------------

describe("makeResponse", () => {
  test("produces a valid success response with string id", () => {
    const res = makeResponse("req-1", { status: "ok" });
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: "req-1",
      result: { status: "ok" },
    });
  });

  test("produces a valid success response with numeric id", () => {
    const res = makeResponse(7, "hello");
    expect(res).toEqual({ jsonrpc: "2.0", id: 7, result: "hello" });
  });

  test("can return null as result", () => {
    const res = makeResponse(1, null);
    expect(res).toEqual({ jsonrpc: "2.0", id: 1, result: null });
  });
});

// ---------------------------------------------------------------------------
// makeErrorResponse
// ---------------------------------------------------------------------------

describe("makeErrorResponse", () => {
  test("produces a valid error response", () => {
    const res = makeErrorResponse(1, -32600, "Invalid Request");
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  test("includes data when provided", () => {
    const res = makeErrorResponse("x", -32602, "Invalid Params", {
      missing: "name",
    });
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: "x",
      error: {
        code: -32602,
        message: "Invalid Params",
        data: { missing: "name" },
      },
    });
  });

  test("omits data when not provided", () => {
    const res = makeErrorResponse(1, -32603, "Internal Error");
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Internal Error" },
    });
    // Ensure the `data` key is genuinely absent, not just undefined
    expect("data" in (res as any).error).toBe(false);
  });

  test("supports null id for parse errors", () => {
    const res = makeErrorResponse(null, -32700, "Parse error");
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });
});

// ---------------------------------------------------------------------------
// makeNotification
// ---------------------------------------------------------------------------

describe("makeNotification", () => {
  test("produces a valid notification without params", () => {
    const n = makeNotification("heartbeat");
    expect(n).toEqual({ jsonrpc: "2.0", method: "heartbeat" });
  });

  test("produces a valid notification with params", () => {
    const n = makeNotification("log", { level: "info", msg: "hi" });
    expect(n).toEqual({
      jsonrpc: "2.0",
      method: "log",
      params: { level: "info", msg: "hi" },
    });
  });

  test("omits params when not provided", () => {
    const n = makeNotification("ping");
    expect("params" in n).toBe(false);
  });

  test("does not include an id field", () => {
    const n = makeNotification("event", { type: "start" });
    expect("id" in n).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error code constants
// ---------------------------------------------------------------------------

describe("error codes", () => {
  test("PARSE_ERROR is -32700", () => {
    expect(PARSE_ERROR).toBe(-32700);
  });

  test("INVALID_REQUEST is -32600", () => {
    expect(INVALID_REQUEST).toBe(-32600);
  });

  test("METHOD_NOT_FOUND is -32601", () => {
    expect(METHOD_NOT_FOUND).toBe(-32601);
  });

  test("INVALID_PARAMS is -32602", () => {
    expect(INVALID_PARAMS).toBe(-32602);
  });

  test("INTERNAL_ERROR is -32603", () => {
    expect(INTERNAL_ERROR).toBe(-32603);
  });

  test("SESSION_NOT_FOUND is -1", () => {
    expect(SESSION_NOT_FOUND).toBe(-1);
  });

  test("SESSION_BUSY is -2", () => {
    expect(SESSION_BUSY).toBe(-2);
  });
});
