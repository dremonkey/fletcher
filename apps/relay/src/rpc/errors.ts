/**
 * Standard JSON-RPC 2.0 error codes and application-level error codes.
 *
 * Spec: https://www.jsonrpc.org/specification#error_object
 */

// ---------------------------------------------------------------------------
// Standard JSON-RPC 2.0 error codes (-32700 to -32600)
// ---------------------------------------------------------------------------

/** Invalid JSON was received by the server. */
export const PARSE_ERROR = -32700;

/** The JSON sent is not a valid JSON-RPC request. */
export const INVALID_REQUEST = -32600;

/** The method does not exist or is not available. */
export const METHOD_NOT_FOUND = -32601;

/** Invalid method parameter(s). */
export const INVALID_PARAMS = -32602;

/** Internal JSON-RPC error. */
export const INTERNAL_ERROR = -32603;

// ---------------------------------------------------------------------------
// Application-level error codes
// ---------------------------------------------------------------------------

/** The requested sessionId does not exist. */
export const SESSION_NOT_FOUND = -1;

/** The session is already processing a request. */
export const SESSION_BUSY = -2;

/** Upstream LLM rate limit exceeded. */
export const RATE_LIMITED = -32029;
