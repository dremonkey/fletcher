import type { ServerWebSocket } from "bun";
import type { Session, WebSocketData } from "./types";
import type { SessionManager } from "./manager";
import { makeNotification } from "../rpc/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Set this to true to use the mock agent instead of the real SDK.
 * The mock agent simulates the agent loop for testing and development
 * until the real Agent SDK is fully wired up for relay use.
 */
const USE_MOCK_AGENT = true;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send a JSON-RPC notification over the WebSocket.
 * Silently swallows send errors (the WebSocket may have closed).
 */
function sendNotification(
  ws: ServerWebSocket<WebSocketData>,
  method: string,
  params?: unknown,
): void {
  try {
    ws.send(JSON.stringify(makeNotification(method, params)));
  } catch {
    // WebSocket may have been closed — nothing we can do here.
  }
}

/**
 * Pause the agent loop and wait for the user to respond.
 *
 * Sets `session.pendingResolve` so that when `SessionManager.sendMessage()`
 * is called, the promise resolves with the user's content and the session
 * transitions back to `"running"`.
 */
export function waitForUserResponse(session: Session): Promise<unknown> {
  return new Promise((resolve) => {
    session.pendingResolve = resolve;
    session.status = "waiting_for_user";
  });
}

/**
 * Wait for the user to approve or deny a tool use.
 * Returns `true` if approved, `false` if denied.
 */
async function waitForApproval(session: Session): Promise<boolean> {
  const response = await waitForUserResponse(session);
  // Accept truthy values, the string "true", or an object with approved: true
  if (typeof response === "string") {
    return response.toLowerCase() === "true" || response.toLowerCase() === "yes";
  }
  if (typeof response === "object" && response !== null && "approved" in response) {
    return Boolean((response as { approved: unknown }).approved);
  }
  return Boolean(response);
}

// ---------------------------------------------------------------------------
// Mock Agent
// ---------------------------------------------------------------------------

/**
 * A mock agent loop that simulates the real Agent SDK's async generator.
 *
 * It yields:
 *   1. A text delta: "Processing your request..."
 *   2. A text delta echoing the session prompt
 *   3. Completes
 *
 * This is clearly labeled and designed to be swapped out for the real SDK
 * once we wire up the actual `query()` call.
 */
async function runMockAgent(
  session: Session,
  manager: SessionManager,
): Promise<void> {
  const { ws, id: sessionId } = session;

  // Check abort before starting
  if (session.abortController.signal.aborted) {
    return;
  }

  // Yield first text delta
  sendNotification(ws, "session/update", {
    sessionId,
    type: "text_delta",
    content: "Processing your request...",
  });

  // Small async gap to simulate processing
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Check abort between steps
  if (session.abortController.signal.aborted) {
    return;
  }

  // Yield the main response (echo the prompt)
  const responseText = `You said: "${session.prompt}"`;
  sendNotification(ws, "session/update", {
    sessionId,
    type: "text_delta",
    content: responseText,
  });
}

// ---------------------------------------------------------------------------
// Real Agent (stub — to be wired up when SDK integration is ready)
// ---------------------------------------------------------------------------

/**
 * Run the real Agent SDK query loop.
 *
 * This is a placeholder that will be filled in when we integrate the
 * `@anthropic-ai/claude-agent-sdk` query() function. The SDK's query()
 * returns an AsyncGenerator<SDKMessage, void> which we iterate over,
 * translating each message type into the appropriate JSON-RPC notification.
 *
 * Expected SDK usage:
 * ```ts
 * import { query } from "@anthropic-ai/claude-agent-sdk";
 * const q = query({
 *   prompt: session.prompt,
 *   options: {
 *     abortController: session.abortController,
 *     canUseTool: async (toolName, input, opts) => { ... },
 *   },
 * });
 * for await (const msg of q) {
 *   if (msg.type === "assistant") { ... }
 *   if (msg.type === "result") { ... }
 * }
 * ```
 */
async function runRealAgent(
  session: Session,
  manager: SessionManager,
): Promise<void> {
  // Not yet implemented — fall through to mock
  throw new Error(
    "Real Agent SDK integration is not yet implemented. Set USE_MOCK_AGENT = true.",
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the agent loop for a session.
 *
 * This is the core bridge between the Agent SDK and the WebSocket JSON-RPC
 * layer. It:
 *
 *   1. Sets session status to "running"
 *   2. Runs the agent loop (mock or real), emitting JSON-RPC notifications
 *      for text deltas, questions, tool approvals, etc.
 *   3. On completion: sends `session/complete` and sets status to "completed"
 *   4. On error: sends `session/error` and sets status to "error"
 *   5. On abort: exits cleanly and sets status to "cancelled"
 */
export async function runAgent(
  session: Session,
  manager: SessionManager,
): Promise<void> {
  const { ws, id: sessionId } = session;

  // Transition to running
  session.status = "running";

  try {
    // Listen for abort
    if (session.abortController.signal.aborted) {
      session.status = "cancelled";
      return;
    }

    // Run the appropriate agent implementation
    if (USE_MOCK_AGENT) {
      await runMockAgent(session, manager);
    } else {
      await runRealAgent(session, manager);
    }

    // Check if aborted during execution
    if (session.abortController.signal.aborted) {
      session.status = "cancelled";
      return;
    }

    // Success — send completion notification
    sendNotification(ws, "session/complete", {
      sessionId,
      result: "Agent completed successfully.",
    });
    session.status = "completed";
  } catch (err: unknown) {
    // If we were aborted, treat it as cancellation, not an error
    if (session.abortController.signal.aborted) {
      session.status = "cancelled";
      return;
    }

    const message =
      err instanceof Error ? err.message : "Unknown error during agent execution";

    sendNotification(ws, "session/error", {
      sessionId,
      error: message,
    });
    session.status = "error";
  }
}
