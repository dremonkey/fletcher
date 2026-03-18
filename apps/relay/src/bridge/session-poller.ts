/**
 * SessionPoller — periodically polls ACP session/load to catch
 * async agent messages that arrive between prompts.
 *
 * WORKAROUND for BUG-022 / openclaw/openclaw#40693:
 * ACP's stdio protocol only pushes session/update during active prompt
 * processing. Sub-agent or async results posted between prompts are
 * invisible to the relay. This poller compensates by periodically
 * calling session/load, comparing the replayed messages against what
 * was already forwarded, and sending only new content to mobile.
 *
 * TODO(BUG-022): Remove once openclaw/openclaw#40693 is fixed.
 */

import type { AcpClient, SessionUpdateParams } from "@fletcher/acp-client";
import type { Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionPollerOptions {
  /** ACP client to call session/load on. */
  acpClient: AcpClient;
  /** The session ID to poll. */
  sessionId: string;
  /** Callback to forward new messages to mobile. */
  onNewMessages: (messages: Array<{ jsonrpc: "2.0"; method: "session/update"; params: SessionUpdateParams }>) => void;
  /** Logger instance. */
  logger: Logger;
  /** Polling interval in milliseconds. Default: 30_000 (30s). */
  intervalMs?: number;
}

// ---------------------------------------------------------------------------
// SessionPoller
// ---------------------------------------------------------------------------

export class SessionPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private log: Logger;
  private intervalMs: number;
  private acpClient: AcpClient;
  private sessionId: string;
  private onNewMessages: SessionPollerOptions["onNewMessages"];

  /** Whether a poll is currently in progress (prevents overlap). */
  private polling = false;

  /** Whether polling is paused (during active prompt processing). */
  private paused = false;

  /**
   * High-water mark: accumulated text of all agent_message_chunk content
   * seen so far (both from live stream and previous polls). Used for
   * content-based dedup — same approach as the existing BUG-022 catch-up.
   */
  private knownAgentText = "";

  /**
   * Injected from RelayBridge — provides the current forwardedAgentText
   * so the poller's dedup stays in sync with content already forwarded
   * via the normal prompt path.
   */
  private getForwardedAgentText: (() => string) | null = null;

  constructor(options: SessionPollerOptions) {
    this.acpClient = options.acpClient;
    this.sessionId = options.sessionId;
    this.onNewMessages = options.onNewMessages;
    this.log = options.logger;
    this.intervalMs = options.intervalMs ?? 30_000;
  }

  /**
   * Provide a function that returns the relay bridge's current
   * forwardedAgentText. Called at the start of each poll to sync
   * the high-water mark with content forwarded via the live stream.
   */
  syncForwardedText(getter: () => string): void {
    this.getForwardedAgentText = getter;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Start the polling timer. Idempotent — does nothing if already running. */
  start(): void {
    if (this.timer !== null) return;

    this.log.info(
      { event: "poller_started", intervalMs: this.intervalMs, sessionId: this.sessionId },
      `Session poller started (${this.intervalMs}ms interval)`,
    );

    this.timer = setInterval(() => {
      this.tick();
    }, this.intervalMs);

    // Allow the process to exit even if the timer is running
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  /** Stop the polling timer. Idempotent. */
  stop(): void {
    if (this.timer === null) return;

    clearInterval(this.timer);
    this.timer = null;
    this.log.info({ event: "poller_stopped" }, "Session poller stopped");
  }

  /** Whether the poller is currently running (timer active). */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Pause polling. Called when a prompt is being actively processed
   * (no point polling while streaming — we'll get updates via the
   * normal onUpdate handler).
   */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.log.debug({ event: "poller_paused" }, "Polling paused (prompt active)");
  }

  /**
   * Resume polling after a prompt completes. This is when async
   * messages are most likely to appear.
   */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.log.debug({ event: "poller_resumed" }, "Polling resumed (prompt complete)");
  }

  /** Whether polling is currently paused. */
  get isPaused(): boolean {
    return this.paused;
  }

  /** Update the session ID (e.g., after ACP re-init). */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  // -------------------------------------------------------------------------
  // Poll tick
  // -------------------------------------------------------------------------

  /**
   * Execute a single poll tick. Exposed for testing.
   * Skips if paused, already polling, or ACP is not alive.
   */
  async tick(): Promise<void> {
    if (this.paused) {
      this.log.debug({ event: "poll_skip_paused" }, "Skipping poll — paused");
      return;
    }

    if (this.polling) {
      this.log.debug({ event: "poll_skip_inflight" }, "Skipping poll — already in progress");
      return;
    }

    if (!this.acpClient.isAlive) {
      this.log.debug({ event: "poll_skip_dead" }, "Skipping poll — ACP not alive");
      return;
    }

    // Sync high-water mark with relay bridge's forwarded text
    if (this.getForwardedAgentText) {
      const bridgeText = this.getForwardedAgentText();
      if (bridgeText.length > this.knownAgentText.length) {
        this.knownAgentText = bridgeText;
      }
    }

    this.polling = true;
    const textLenBefore = this.knownAgentText.length;

    this.log.debug(
      { event: "poll_start", sessionId: this.sessionId, knownTextLen: textLenBefore },
      "Starting session poll",
    );

    // Collect updates from session/load replay
    const newMessages: Array<{ jsonrpc: "2.0"; method: "session/update"; params: SessionUpdateParams }> = [];
    let replayAccumulated = "";

    // Temporarily subscribe to session/update notifications to capture
    // the replay. The ACP client fires onUpdate handlers for each
    // replayed notification.
    const unsubscribe = this.acpClient.onUpdate((params: SessionUpdateParams) => {
      const updateKind = (params as any).update?.sessionUpdate;
      const isAgentChunk = updateKind === "agent_message_chunk";

      if (isAgentChunk) {
        const text = this.extractChunkText(params);
        if (text) replayAccumulated += text;

        // Skip content we've already seen
        if (replayAccumulated.length <= this.knownAgentText.length) {
          return;
        }

        // New content found — record it
        newMessages.push({
          jsonrpc: "2.0",
          method: "session/update",
          params,
        });
      }
      // Non-chunk updates during poll replay are skipped (metadata, etc.)
    });

    try {
      await this.acpClient.sessionLoad({
        sessionId: this.sessionId,
        cwd: process.cwd(),
        mcpServers: [],
      });

      // Update high-water mark
      if (replayAccumulated.length > this.knownAgentText.length) {
        this.knownAgentText = replayAccumulated;
      }

      const newChars = this.knownAgentText.length - textLenBefore;

      if (newMessages.length > 0) {
        this.log.info(
          { event: "poll_new_messages", count: newMessages.length, newChars },
          `Poll found ${newMessages.length} new message(s) (${newChars} new chars)`,
        );
        this.onNewMessages(newMessages);
      } else {
        this.log.debug(
          { event: "poll_no_new", replayLen: replayAccumulated.length, knownLen: this.knownAgentText.length },
          "Poll complete — no new messages",
        );
      }
    } catch (err) {
      this.log.error(
        { event: "poll_error", error: (err as Error).message },
        "Session poll failed",
      );
    } finally {
      unsubscribe();
      this.polling = false;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Extract the text content from an agent_message_chunk update, or null. */
  private extractChunkText(params: SessionUpdateParams): string | null {
    const update = (params as any).update;
    if (update?.sessionUpdate !== "agent_message_chunk") return null;
    const content = update?.content;
    if (content?.type !== "text" || typeof content?.text !== "string") return null;
    return content.text;
  }
}
