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
  SessionNewParams,
  SessionNewResult,
  SessionPromptParams,
  SessionPromptResult,
  SessionCancelParams,
  SessionUpdateParams,
} from "./types";
import type { JsonRpcResponse } from "../rpc/types";
import type { Logger } from "../utils/logger";
import pino from "pino";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

type UpdateHandler = (params: SessionUpdateParams) => void;
type ExitHandler = (code: number | null) => void;

/** Silent logger used when no logger is provided. */
const noopLogger = pino({ level: "silent" });

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
   * Does NOT send initialize — call initialize() for the full handshake.
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

    // Handle subprocess exit
    this.proc.exited.then((code) => {
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
      clientInfo: { name: "fletcher-relay", version: "0.1.0" },
      capabilities: {},
    };

    const result = (await this.request(
      "initialize",
      params,
    )) as InitializeResult;

    // Send `initialized` notification (no id — it's a notification)
    this.sendNotification("initialized");

    this.log.info({ event: "acp_initialized" }, "ACP initialized");
    return result;
  }

  /**
   * Gracefully shut down:
   * 1. Send `exit` notification
   * 2. Kill the subprocess
   * 3. Clean up pending requests
   */
  async shutdown(): Promise<void> {
    if (!this.proc) return;

    this.log.info({ event: "acp_shutdown" }, "shutting down ACP subprocess");

    try {
      this.sendNotification("exit");
    } catch {
      // Process may already be dead
    }

    // Give the process a moment to exit gracefully, then kill
    const proc = this.proc;
    this.proc = null;

    try {
      proc.kill();
    } catch {
      // Already dead
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
   * Cancel the current session prompt.
   * This is a notification — no response is expected.
   */
  sessionCancel(params?: SessionCancelParams): void {
    this.sendNotification("session/cancel", params ?? {});
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  /** Register a handler for session/update notifications from the agent. */
  onUpdate(handler: UpdateHandler): void {
    this.updateHandlers.push(handler);
  }

  /** Register a handler for when the ACP subprocess exits unexpectedly. */
  onExit(handler: ExitHandler): void {
    this.exitHandlers.push(handler);
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
    this.send(msg);
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

      // Process any remaining data in the buffer
      if (buffer.trim()) {
        this.handleLine(buffer);
      }
    } catch {
      // Stream closed or errored — subprocess is dying
    }
  }

  /** Parse a JSON-RPC line and route it. */
  private handleLine(line: string): void {
    this.log.debug({ raw: line }, "acp raw stdout");

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      // Not valid JSON — ignore (could be debug output)
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
        const err = msg.error as { code: number; message: string };
        pending.reject(new Error(`JSON-RPC error ${err.code}: ${err.message}`));
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
