/**
 * JSON-RPC 2.0 wire format types and helper functions.
 *
 * Spec: https://www.jsonrpc.org/specification
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: JsonRpcError };

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

/**
 * Returns true if `msg` is a JSON-RPC request (has an `id` field),
 * as opposed to a notification (no `id`).
 */
export function isRequest(msg: unknown): msg is JsonRpcRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return (
    obj.jsonrpc === "2.0" &&
    typeof obj.method === "string" &&
    ("id" in obj &&
      (typeof obj.id === "string" || typeof obj.id === "number"))
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a JSON-RPC 2.0 success response. */
export function makeResponse(
  id: string | number,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

/** Build a JSON-RPC 2.0 error response. */
export function makeErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  const error: JsonRpcError = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return { jsonrpc: "2.0", id, error };
}

/** Build a JSON-RPC 2.0 notification (no `id`). */
export function makeNotification(
  method: string,
  params?: unknown,
): JsonRpcNotification {
  const notification: JsonRpcNotification = { jsonrpc: "2.0", method };
  if (params !== undefined) {
    notification.params = params;
  }
  return notification;
}
