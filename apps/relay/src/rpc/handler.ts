import type { ServerWebSocket } from "bun";
import type { Session, WebSocketData } from "../session/types";
import type { SessionManager } from "../session/manager";
import { makeResponse, makeErrorResponse } from "./types";
import {
  PARSE_ERROR,
  INVALID_REQUEST,
  INVALID_PARAMS,
  METHOD_NOT_FOUND,
  INTERNAL_ERROR,
  SESSION_NOT_FOUND,
} from "./errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Agent runner function — injected to avoid hard dependency on the agent bridge. */
type AgentRunner = (session: Session, manager: SessionManager) => Promise<void>;

/** Handler for a single JSON-RPC method. */
type RpcHandler = (
  params: unknown,
  ws: ServerWebSocket<WebSocketData>,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a JSON-RPC message handler bound to the given session manager and
 * agent runner. Returns a function suitable for the WebSocket `message` event.
 */
export function createRpcHandler(
  manager: SessionManager,
  runAgent: AgentRunner,
) {
  // -----------------------------------------------------------------------
  // Method handlers
  // -----------------------------------------------------------------------

  const handleSessionNew: RpcHandler = async (params, ws) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>).prompt !== "string"
    ) {
      throw { rpcCode: INVALID_PARAMS, message: "Missing required param: prompt (string)" };
    }

    const { prompt } = params as { prompt: string };
    const session = manager.createSession(prompt, ws);

    // Fire-and-forget: agent runs in the background
    runAgent(session, manager).catch(() => {
      // Agent errors are reported via notifications, not here
    });

    return { sessionId: session.id };
  };

  const handleSessionMessage: RpcHandler = async (params) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>).sessionId !== "string" ||
      typeof (params as Record<string, unknown>).content !== "string"
    ) {
      throw {
        rpcCode: INVALID_PARAMS,
        message: "Missing required params: sessionId (string), content (string)",
      };
    }

    const { sessionId, content } = params as {
      sessionId: string;
      content: string;
    };

    try {
      manager.sendMessage(sessionId, content);
    } catch {
      throw { rpcCode: SESSION_NOT_FOUND, message: `Session not found: ${sessionId}` };
    }

    return { ok: true };
  };

  const handleSessionResume: RpcHandler = async (params, ws) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>).sessionId !== "string" ||
      typeof (params as Record<string, unknown>).prompt !== "string"
    ) {
      throw {
        rpcCode: INVALID_PARAMS,
        message: "Missing required params: sessionId (string), prompt (string)",
      };
    }

    const { sessionId, prompt } = params as {
      sessionId: string;
      prompt: string;
    };

    const session = manager.getSession(sessionId);
    if (!session) {
      throw { rpcCode: SESSION_NOT_FOUND, message: `Session not found: ${sessionId}` };
    }

    // Update the prompt and kick off a new agent run
    session.prompt = prompt;

    runAgent(session, manager).catch(() => {
      // Agent errors are reported via notifications, not here
    });

    return { sessionId };
  };

  const handleSessionCancel: RpcHandler = async (params) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>).sessionId !== "string"
    ) {
      throw {
        rpcCode: INVALID_PARAMS,
        message: "Missing required param: sessionId (string)",
      };
    }

    const { sessionId } = params as { sessionId: string };

    try {
      manager.cancelSession(sessionId);
    } catch {
      throw { rpcCode: SESSION_NOT_FOUND, message: `Session not found: ${sessionId}` };
    }

    return { ok: true };
  };

  const handleSessionList: RpcHandler = async () => {
    const sessions = manager.listSessions();
    return { sessions };
  };

  // -----------------------------------------------------------------------
  // Handler map
  // -----------------------------------------------------------------------

  const handlers: Record<string, RpcHandler> = {
    "session/new": handleSessionNew,
    "session/message": handleSessionMessage,
    "session/resume": handleSessionResume,
    "session/cancel": handleSessionCancel,
    "session/list": handleSessionList,
  };

  // -----------------------------------------------------------------------
  // Main dispatch
  // -----------------------------------------------------------------------

  return function handleMessage(
    raw: string,
    ws: ServerWebSocket<WebSocketData>,
  ): void {
    // 1. Parse JSON
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(
        JSON.stringify(makeErrorResponse(null, PARSE_ERROR, "Parse error")),
      );
      return;
    }

    // 2. Validate structure
    if (
      typeof msg !== "object" ||
      msg === null ||
      (msg as Record<string, unknown>).jsonrpc !== "2.0" ||
      typeof (msg as Record<string, unknown>).method !== "string"
    ) {
      ws.send(
        JSON.stringify(
          makeErrorResponse(null, INVALID_REQUEST, "Invalid request"),
        ),
      );
      return;
    }

    const obj = msg as Record<string, unknown>;
    const method = obj.method as string;
    const params = obj.params;

    // 3. Extract id — if present, this is a request that expects a response
    const hasId = "id" in obj;
    const id =
      hasId && (typeof obj.id === "string" || typeof obj.id === "number")
        ? obj.id
        : null;

    // 4. Dispatch by method
    const handler = handlers[method];
    if (!handler) {
      if (hasId) {
        ws.send(
          JSON.stringify(
            makeErrorResponse(
              id,
              METHOD_NOT_FOUND,
              `Method not found: ${method}`,
            ),
          ),
        );
      }
      return;
    }

    // 5. Execute handler, wrapping in try/catch for unexpected errors
    handler(params, ws)
      .then((result) => {
        // 6. Send response only for requests (those with id)
        if (hasId && id !== null) {
          ws.send(JSON.stringify(makeResponse(id, result)));
        }
      })
      .catch((err: unknown) => {
        if (hasId && id !== null) {
          // Check for structured RPC errors thrown by handlers
          if (
            typeof err === "object" &&
            err !== null &&
            "rpcCode" in err &&
            "message" in err
          ) {
            const rpcErr = err as { rpcCode: number; message: string };
            ws.send(
              JSON.stringify(
                makeErrorResponse(id, rpcErr.rpcCode, rpcErr.message),
              ),
            );
          } else {
            ws.send(
              JSON.stringify(
                makeErrorResponse(id, INTERNAL_ERROR, "Internal error"),
              ),
            );
          }
        }
      });
  };
}
