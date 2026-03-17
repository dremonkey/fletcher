/**
 * ACP client over stdio.
 *
 * Spawns an ACP agent subprocess and communicates via
 * newline-delimited JSON-RPC 2.0 over stdin/stdout.
 */

import type {
  AcpClientOptions,
  InitializeParams,
  InitializeResult,
  Logger,
  SessionNewParams,
  SessionNewResult,
  SessionPromptParams,
  SessionPromptResult,
  SessionCancelParams,
  SessionListParams,
  SessionListResult,
  SessionLoadParams,
  SessionUpdateParams,
  SetConfigOptionParams,
  SetConfigOptionResult,
} from "./types.js";
import type { JsonRpcResponse } from "./rpc.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Typed JSON-RPC error that preserves code, message, and data from ACP. */
export class AcpError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "AcpError";
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

type UpdateHandler = (params: SessionUpdateParams) => void;
type ExitHandler = (code: number | null) => void;

/** Silent logger used when no logger is provided. */
const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

// ---------------------------------------------------------------------------
// AcpClient
// ---------------------------------------------------------------------------

export class AcpClient {
  private options: AcpClientOptions;
  private log: Logger;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private updateHandlers: UpdateHandler[] = [];
  private exitHandlers: ExitHandler[] = [];
  private readLoopPromise: Promise<void> | null = null;

  constructor(options: AcpClientOptions) {
    this.options = options;
    this.log = options.logger ?? noopLogger;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Spawn the subprocess and start reading stdout.
   * Does NOT send initialize -- call initialize() for the full handshake.
   */
  private spawn(): void {
    const { command, args = [], env } = this.options;

    this.proc = Bun.spawn([command, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...env },
    });

    // Drain stderr so it doesn't block the subprocess
    this.drainStderr();

    // Start reading stdout lines
    this.readLoopPromise = this.readLoop();

    // Handle subprocess exit -- wait for readLoop to drain stdout before
    // rejecting pending requests, so responses written just before exit
    // are not silently dropped.
    this.proc.exited.then(async (code) => {
      this.log.info({ event: "acp_exited", exitCode: code }, "ACP subprocess exited, draining stdout");
      await this.readLoopPromise;
      this.log.info({ event: "acp_drained", pendingCount: this.pendingRequests.size }, "stdout drained");
      this.rejectAllPending(new Error("ACP subprocess exited"));
      this.proc = null;
      for (const handler of this.exitHandlers) {
        handler(code ?? null);
      }
    });
  }

  /**
   * Initialize the ACP connection:
   * 1. Spawn the subprocess
   * 2. Send `initialize` request
   * 3. Send `initialized` notification
   */
  async initialize(): Promise<InitializeResult> {
    this.log.info({ event: "acp_spawn" }, "spawning ACP subprocess");
    this.spawn();

    const params: InitializeParams = {
      protocolVersion: 1,
      clientInfo: { name: "fletcher-acp-client", version: "0.1.0" },
      capabilities: {},
    };

    const result = (await this.request(
      "initialize",
      params,
    )) as InitializeResult;

    // Send `initialized` notification (no id -- it's a notification)
    this.sendNotification("initialized");

    this.log.info({ event: "acp_initialized" }, "ACP initialized");
    return result;
  }

  /**
   * Gracefully shut down:
   * 1. Send `exit` notification
   * 2. SIGTERM the subprocess
   * 3. Wait up to 3s for exit, then escalate to SIGKILL on process group
   * 4. Clean up pending requests
   */
  async shutdown(): Promise<void> {
    if (!this.proc) return;

    const pid = this.proc.pid;
    this.log.info({ event: "acp_shutdown", pid }, "shutting down ACP subprocess");

    try {
      this.sendNotification("exit");
    } catch {
      // Process may already be dead
    }

    const proc = this.proc;
    this.proc = null;

    // Phase 1: SIGTERM
    try {
      proc.kill();
    } catch {
      // Already dead
    }

    // Phase 2: Wait up to 3s for graceful exit
    const exited = await Promise.race([
      proc.exited.then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), 3000)),
    ]);

    if (!exited) {
      // Phase 3: Escalate to SIGKILL on the process group to catch children
      this.log.warn({ event: "acp_sigkill", pid }, "SIGTERM ignored -- escalating to SIGKILL");
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Process group kill failed -- try direct SIGKILL
        try {
          proc.kill(9);
        } catch {
          // Already dead
        }
      }

      // Wait briefly for SIGKILL to take effect
      await Promise.race([
        proc.exited,
        new Promise<void>((r) => setTimeout(r, 1000)),
      ]);
    }

    this.rejectAllPending(new Error("ACP client shut down"));
  }

  // -------------------------------------------------------------------------
  // Session methods
  // -------------------------------------------------------------------------

  async sessionNew(params: SessionNewParams): Promise<SessionNewResult> {
    this.log.info({ event: "session_new" }, "creating ACP session");
    const result = (await this.request("session/new", params)) as SessionNewResult;
    this.log.info({ event: "session_new_result", sessionId: result.sessionId }, "ACP session created");
    return result;
  }

  async sessionPrompt(
    params: SessionPromptParams,
  ): Promise<SessionPromptResult> {
    this.log.info({ event: "session_prompt", sessionId: params.sessionId }, "sending prompt");
    const result = (await this.request(
      "session/prompt",
      params,
    )) as SessionPromptResult;
    this.log.info({ event: "session_prompt_result", stopReason: result.stopReason }, "prompt completed");
    return result;
  }

  /**
   * Set a session config option.
   *
   * ACP spec: https://agentclientprotocol.com/rfds/session-config-options
   *
   * Returns the full updated configOptions array so the client can replace
   * its state entirely.
   */
  async sessionSetConfigOption(params: SetConfigOptionParams): Promise<SetConfigOptionResult> {
    this.log.info(
      { event: "set_config_option", configId: params.configId, value: params.value },
      `setting config ${params.configId}=${params.value}`,
    );
    const result = (await this.request("session/set_config_option", params)) as SetConfigOptionResult;
    this.log.info(
      { event: "set_config_option_result", configCount: result.configOptions?.length ?? 0 },
      "config option set",
    );
    return result;
  }

  /**
   * Cancel the current session prompt.
   * This is a notification -- no response is expected.
   */
  sessionCancel(params?: SessionCancelParams): void {
    this.sendNotification("session/cancel", params ?? {});
  }

  /**
   * List available sessions.
   * Requires the `listSessions` capability (advertised in initialize response).
   */
  async sessionList(params: SessionListParams = {}): Promise<SessionListResult> {
    this.log.info({ event: "session_list" }, "listing sessions");
    const result = (await this.request("session/list", params)) as SessionListResult;
    this.log.info({ event: "session_list_result", count: result.sessions?.length ?? 0 }, "sessions listed");
    return result;
  }

  /**
   * Load/replay session history as session/update notifications.
   *
   * Also used as WORKAROUND for BUG-022 / openclaw/openclaw#40693:
   * ACP sessions spawned via sessions_spawn never trigger the auto-announce
   * flow, so sub-agent results are invisible to the relay. session/load
   * replays the full session history as session/update notifications,
   * allowing us to detect and forward any missed agent messages.
   *
   * ACP spec: https://agentclientprotocol.com/protocol/session-setup
   * Requires the `loadSession` capability (advertised in initialize response).
   */
  async sessionLoad(params: SessionLoadParams): Promise<void> {
    this.log.info({ event: "session_load", sessionId: params.sessionId }, "loading session history");
    await this.request("session/load", params);
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  /**
   * Register a handler for session/update notifications from the agent.
   * Returns an unsubscribe function -- call it to remove the handler.
   */
  onUpdate(handler: UpdateHandler): () => void {
    this.updateHandlers.push(handler);
    return () => {
      const idx = this.updateHandlers.indexOf(handler);
      if (idx >= 0) this.updateHandlers.splice(idx, 1);
    };
  }

  /**
   * Register a handler for when the ACP subprocess exits unexpectedly.
   * Returns an unsubscribe function -- call it to remove the handler.
   */
  onExit(handler: ExitHandler): () => void {
    this.exitHandlers.push(handler);
    return () => {
      const idx = this.exitHandlers.indexOf(handler);
      if (idx >= 0) this.exitHandlers.splice(idx, 1);
    };
  }

  /** Whether the subprocess is currently alive. */
  get isAlive(): boolean {
    return this.proc !== null;
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  /** Send a JSON-RPC request and return a promise for the result. */
  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const msg = {
      jsonrpc: "2.0" as const,
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send(msg);
    });
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  private sendNotification(method: string, params?: unknown): void {
    const msg: Record<string, unknown> = {
      jsonrpc: "2.0",
      method,
    };
    if (params !== undefined) {
      msg.params = params;
    }
    try {
      this.send(msg);
    } catch (err) {
      if (
        method === "session/cancel" &&
        (err as Error).message === "ACP subprocess not running"
      ) {
        // Safe to ignore cancel on dead process
        return;
      }
      throw err;
    }
  }

  /** Write a JSON message + newline to the subprocess stdin. */
  private send(msg: object): void {
    if (!this.proc?.stdin || typeof this.proc.stdin === "number") {
      throw new Error("ACP subprocess not running");
    }
    const data = JSON.stringify(msg) + "\n";
    this.proc.stdin.write(data);
  }

  // -------------------------------------------------------------------------
  // stdout reader
  // -------------------------------------------------------------------------

  /**
   * Read lines from stdout using a ReadableStream reader.
   * Accumulates chunks and splits on newlines.
   */
  private async readLoop(): Promise<void> {
    const stdout = this.proc?.stdout;
    if (!stdout || typeof stdout === "number") return;

    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last (potentially incomplete) chunk in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim()) {
            this.handleLine(line);
          }
        }
      }

      // Flush any remaining bytes from the TextDecoder
      const trailing = decoder.decode();
      if (trailing) {
        buffer += trailing;
      }

      // Process any remaining data in the buffer
      if (buffer.trim()) {
        this.handleLine(buffer);
      }
    } catch (err) {
      this.log.warn({ event: "readloop_error", error: (err as Error).message }, "stdout read error");
    }
  }

  /** Parse a JSON-RPC line and route it. */
  private handleLine(line: string): void {
    this.log.debug({ raw: line }, "acp raw stdout");

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      // Not valid JSON -- ignore (could be debug output)
      this.log.debug({ raw: line }, "acp stdout non-JSON (ignored)");
      return;
    }

    this.log.debug({ msg }, "acp parsed message");

    // Is it a response? (has `id` and either `result` or `error`)
    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const id = msg.id as number;
      const pending = this.pendingRequests.get(id);
      if (!pending) return;

      this.pendingRequests.delete(id);

      if ("error" in msg) {
        const { code, message, data } = msg.error as { code: number; message: string; data?: unknown };
        pending.reject(new AcpError(code, message, data));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Is it a notification? (has `method` but no `id`)
    if ("method" in msg && !("id" in msg)) {
      const method = msg.method as string;
      const params = msg.params as Record<string, unknown> | undefined;

      if (method === "session/update" && params) {
        for (const handler of this.updateHandlers) {
          handler(params as unknown as SessionUpdateParams);
        }
      }
      return;
    }
  }

  // -------------------------------------------------------------------------
  // stderr
  // -------------------------------------------------------------------------

  /** Drain stderr so it doesn't block the subprocess. */
  private async drainStderr(): Promise<void> {
    const stderr = this.proc?.stderr;
    if (!stderr || typeof stderr === "number") return;

    const reader = stderr.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // Stream closed
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /** Reject all pending requests with the given error. */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
