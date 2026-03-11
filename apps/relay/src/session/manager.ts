import type { ServerWebSocket } from "bun";
import type {
  Session,
  SessionStatus,
  WebSocketData,
} from "./types";
import { createAsyncInputChannel } from "./types";

/**
 * Manages the lifecycle of agent sessions: create, message, cancel, list, remove.
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  /**
   * Create a new session and store it in the map.
   * Does NOT start the agent — that is the agent bridge's responsibility.
   */
  createSession(
    prompt: string,
    ws: ServerWebSocket<WebSocketData>,
  ): Session {
    const id = crypto.randomUUID().slice(0, 8);
    const abortController = new AbortController();
    const inputChannel = createAsyncInputChannel();

    const session: Session = {
      id,
      status: "idle",
      createdAt: Date.now(),
      prompt,
      ws,
      pendingResolve: null,
      abortController,
      inputChannel,
    };

    this.sessions.set(id, session);
    return session;
  }

  /**
   * Retrieve a session by ID.
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Send a message to a session.
   *
   * If the session has a `pendingResolve` (the agent is waiting for user input),
   * resolve it immediately and set status to "running".
   *
   * Otherwise, push the message to the session's input channel for later
   * consumption by the agent loop.
   *
   * Throws if the session does not exist.
   */
  sendMessage(sessionId: string, content: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.pendingResolve) {
      session.pendingResolve(content);
      session.pendingResolve = null;
      session.status = "running";
    } else if (session.inputChannel) {
      session.inputChannel.push(content);
    }
  }

  /**
   * Cancel a session: abort the agent loop, close the input channel,
   * and set the status to "cancelled".
   *
   * Throws if the session does not exist.
   */
  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.abortController.abort();
    if (session.inputChannel) {
      session.inputChannel.close();
    }
    session.status = "cancelled";
  }

  /**
   * Return a summary of all sessions.
   */
  listSessions(): Array<{
    id: string;
    status: SessionStatus;
    createdAt: number;
    prompt: string;
  }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      prompt: s.prompt,
    }));
  }

  /**
   * Remove a session from the map (cleanup after completion).
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Update the status of a session.
   *
   * Throws if the session does not exist.
   */
  updateSessionStatus(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.status = status;
  }
}
