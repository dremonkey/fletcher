/**
 * RelayBridge — wires a LiveKit room to an ACP subprocess.
 *
 * Mobile messages on the "relay" data channel are forwarded to ACPX.
 * ACPX responses/notifications are forwarded back to the mobile client.
 */

import { AcpClient } from "@fletcher/acp-client";
import type { RoomManager } from "../livekit/room-manager";
import type { SessionUpdateParams } from "@fletcher/acp-client";
import { INTERNAL_ERROR } from "../rpc/errors";
import { rootLogger, type Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelayBridgeOptions {
  roomName: string;
  roomManager: RoomManager;
  acpCommand: string;
  acpArgs?: string[];
  /** Optional logger — defaults to rootLogger.child({ component: "relay-bridge", roomName }). */
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_PROMPT_LOG_LENGTH = 200;

/** Extract a loggable text summary from an ACP prompt payload. */
function extractPromptText(prompt: unknown): string | undefined {
  if (!Array.isArray(prompt)) return undefined;
  const text = prompt
    .filter((p: any) => p?.type === "text" && typeof p.text === "string")
    .map((p: any) => p.text)
    .join("");
  if (!text) return undefined;
  return text.length > MAX_PROMPT_LOG_LENGTH
    ? text.slice(0, MAX_PROMPT_LOG_LENGTH) + "…"
    : text;
}

// ---------------------------------------------------------------------------
// RelayBridge
// ---------------------------------------------------------------------------

export class RelayBridge {
  private acpClient: AcpClient;
  private log: Logger;
  private sessionId: string | null = null;
  private started = false;
  private needsReinit = false;
  private reinitializing: Promise<void> | null = null;
  /** Serializes all forwardToMobile/forwardToVoiceAgent calls so chunks always arrive before the result. */
  private sendQueue: Promise<void> = Promise.resolve();
  /** Which data channel topic owns the active ACP request. null = idle. */
  private activeRequestSource: "relay" | "voice-acp" | null = null;
  /** Consecutive publishData failures — used to detect a dead forward path. */
  private forwardFailures = 0;
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;

  /**
   * WORKAROUND: BUG-022 / openclaw/openclaw#40693
   * Chunk counting + catch-up state for detecting and recovering from
   * missing sub-agent results. See catchUpSession() for the full mechanism.
   *
   * TODO(BUG-022): Remove once openclaw/openclaw#40693 is fixed and merged.
   */
  private forwardedChunkCount = 0;
  private promptChunkCount = 0;
  private inCatchUp = false;
  private catchUpSkipCount = 0;
  private catchUpChunksSeen = 0;

  constructor(private options: RelayBridgeOptions) {
    this.log = options.logger ??
      rootLogger.child({ component: "relay-bridge", roomName: options.roomName });

    this.acpClient = new AcpClient({
      command: options.acpCommand,
      args: [
        ...(options.acpArgs ?? []),
        "--session",
        `agent:main:relay:${options.roomName}`,
      ],
      logger: this.log.child({ component: "acp" }),
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the bridge:
   * 1. Initialize ACP subprocess
   * 2. Create a session via session/new
   * 3. Register data handler for incoming mobile messages
   * 4. Register ACP update handler to forward to mobile
   */
  async start(): Promise<void> {
    const { roomName } = this.options;

    // 1. Initialize ACP
    await this.acpClient.initialize();

    // 2. Create session
    const result = await this.acpClient.sessionNew({
      cwd: process.cwd(),
      mcpServers: [],
      _meta: {
        room_name: roomName,
        verbose: true,
      },
    });
    this.sessionId = result.sessionId;
    this.log.info({ event: "acp_initialized", sessionId: this.sessionId });

    // 3. Register data handler for mobile -> ACP forwarding
    this.options.roomManager.onDataReceived(
      "relay",
      (rn, data, participantIdentity) => {
        if (rn !== roomName) return;
        this.handleMobileMessage(data, participantIdentity);
      },
    );

    // 3b. Register data handler for voice-agent -> ACP forwarding
    this.options.roomManager.onDataReceived(
      "voice-acp",
      (rn, data, participantIdentity) => {
        if (rn !== roomName) return;
        this.handleVoiceAcpMessage(data, participantIdentity);
      },
    );

    // 4. Register ACP update handler — route to the topic that owns the active request
    this.acpClient.onUpdate((params: SessionUpdateParams) => {
      this.log.debug({ event: "acp_update_received", params }, "← acp session/update");

      const isAgentChunk = (params as any).update?.sessionUpdate === "agent_message_chunk";

      // WORKAROUND: BUG-022 — catch-up dedup logic
      // During loadSession replay, skip chunks we already forwarded and only
      // forward genuinely new content (the missed sub-agent result).
      // TODO(BUG-022): Remove once openclaw/openclaw#40693 is fixed and merged.
      if (this.inCatchUp) {
        if (isAgentChunk) {
          this.catchUpChunksSeen++;
          if (this.catchUpChunksSeen <= this.catchUpSkipCount) {
            this.log.debug(
              { event: "catch_up_skip", seen: this.catchUpChunksSeen, skip: this.catchUpSkipCount },
              "skipping already-forwarded chunk during catch-up",
            );
            return;
          }
          // This is NEW content — forward it
          this.forwardedChunkCount++;
        } else {
          // Non-chunk update during catch-up — skip (metadata replay, already sent)
          this.log.debug({ event: "catch_up_skip_metadata" }, "skipping non-chunk update during catch-up");
          return;
        }
        // Fall through to forward new catch-up chunks to mobile
        this.forwardToMobile({ jsonrpc: "2.0", method: "session/update", params });
        return;
      }

      // Normal (non-catch-up) path: count agent_message_chunk events
      if (isAgentChunk) {
        this.promptChunkCount++;
        this.forwardedChunkCount++;
      }

      if (this.activeRequestSource === "voice-acp") {
        this.forwardToVoiceAgent({ jsonrpc: "2.0", method: "session/update", params });
      } else {
        this.forwardToMobile({ jsonrpc: "2.0", method: "session/update", params });
      }
    });

    // 5. Detect unexpected ACP subprocess death for lazy re-init
    this.acpClient.onExit((code) => {
      if (this.started) {
        this.log.warn({ event: "acp_died", exitCode: code }, "ACP subprocess died — will re-init on next message");
        this.needsReinit = true;
        this.sessionId = null;
      }
    });

    this.started = true;
    this.log.info({ event: "bridge_started" });
  }

  /**
   * Stop the bridge: shut down ACP subprocess.
   */
  async stop(): Promise<void> {
    this.started = false;
    await this.acpClient.shutdown();
  }

  /** Whether the bridge has been started. */
  get isStarted(): boolean {
    return this.started;
  }

  /** The ACP session ID, or null if not yet started. */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Whether the ACP subprocess needs re-initialization. */
  get isAcpDead(): boolean {
    return this.needsReinit;
  }

  /**
   * Lazy re-init: if the ACP subprocess died, spawn a new one and create
   * a fresh session. Coalesces concurrent calls — only one re-init runs.
   */
  private async ensureAcp(): Promise<void> {
    if (!this.needsReinit) return;

    // Coalesce concurrent re-init attempts
    if (this.reinitializing) {
      await this.reinitializing;
      return;
    }

    this.reinitializing = this.doReinit();
    try {
      await this.reinitializing;
    } finally {
      this.reinitializing = null;
    }
  }

  private async doReinit(): Promise<void> {
    const { roomName } = this.options;
    this.log.info({ event: "acp_reinit" }, "Re-initializing ACP after subprocess death");

    // Defensively kill the old process before spawning a new one
    // (shutdown is a no-op if proc is already null)
    await this.acpClient.shutdown();

    await this.acpClient.initialize();

    const result = await this.acpClient.sessionNew({
      cwd: process.cwd(),
      mcpServers: [],
      _meta: {
        room_name: roomName,
        verbose: true,
      },
    });

    this.sessionId = result.sessionId;
    this.needsReinit = false;
    this.log.info({ event: "acp_reinit_complete", sessionId: this.sessionId }, "ACP re-initialized");
  }

  // -------------------------------------------------------------------------
  // BUG-022 catch-up
  // -------------------------------------------------------------------------

  /**
   * WORKAROUND: BUG-022 / openclaw/openclaw#40693
   * When a prompt completes with end_turn but zero agent_message_chunk events,
   * the sub-agent result was likely swallowed by the upstream dispatch bug.
   * This method calls loadSession to replay the full session history; the
   * onUpdate handler deduplicates already-forwarded chunks and forwards only
   * genuinely new content.
   *
   * TODO(BUG-022): Remove once openclaw/openclaw#40693 is fixed and merged.
   */
  private async catchUpSession(): Promise<void> {
    if (!this.sessionId) return;
    if (this.activeRequestSource !== null) return;
    if (this.inCatchUp) return;

    this.inCatchUp = true;
    this.catchUpSkipCount = this.forwardedChunkCount;
    this.catchUpChunksSeen = 0;

    this.log.info(
      { event: "catch_up_start", sessionId: this.sessionId, skipCount: this.catchUpSkipCount },
      "starting loadSession catch-up (BUG-022)",
    );

    try {
      await this.acpClient.sessionLoad({
        sessionId: this.sessionId,
        cwd: process.cwd(),
        mcpServers: [],
      });
      this.log.info(
        { event: "catch_up_complete", newChunks: this.catchUpChunksSeen - this.catchUpSkipCount },
        "loadSession catch-up complete",
      );
    } catch (err) {
      this.log.error(
        { event: "catch_up_failed", error: (err as Error).message },
        "loadSession catch-up failed",
      );
    } finally {
      this.inCatchUp = false;
    }
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  /**
   * Handle an incoming data channel message from mobile.
   * Routes to the appropriate ACP method.
   */
  private handleMobileMessage(data: unknown, _participantIdentity: string): void {
    if (typeof data !== "object" || data === null) return;

    // Reset idle timer — incoming messages prove the session is active
    this.options.roomManager.touchRoom(this.options.roomName);

    const msg = data as {
      jsonrpc?: string;
      id?: number | string;
      method?: string;
      params?: Record<string, unknown>;
    };

    // Extract requestId from params for correlation, or generate one
    const correlationId =
      (msg.params?.requestId as string) ?? crypto.randomUUID();
    const reqLog = this.log.child({ correlationId });

    this.log.debug({ event: "mobile_message_received", msg }, "← mobile");

    if (msg.method === "session/prompt") {
      const promptText = extractPromptText(msg.params?.prompt);
      reqLog.info({ event: "mobile_prompt_received", promptText });
      this.activeRequestSource = "relay";
      this.promptChunkCount = 0; // BUG-022: reset per-prompt chunk counter

      // Lazy re-init if ACP subprocess died, then send prompt
      this.ensureAcp()
        .then(() => {
          const params = { ...msg.params, sessionId: this.sessionId };
          return this.acpClient.sessionPrompt(params as any);
        })
        .then((result) => {
          const stopReason = (result as any).stopReason;
          reqLog.info({ event: "mobile_prompt_completed", stopReason });
          this.activeRequestSource = null;
          this.forwardToMobile({
            jsonrpc: "2.0",
            id: msg.id,
            result,
          });

          // WORKAROUND: BUG-022 / openclaw/openclaw#40693
          // If the prompt completed with end_turn but zero agent_message_chunk
          // events, the sub-agent result was likely lost. Trigger loadSession
          // to replay and forward any missed messages.
          // TODO(BUG-022): Remove once openclaw/openclaw#40693 is fixed and merged.
          if (stopReason === "end_turn" && this.promptChunkCount === 0) {
            reqLog.warn(
              { event: "zero_text_prompt", sessionId: this.sessionId },
              "prompt completed with end_turn but no agent_message_chunk — triggering loadSession catch-up (BUG-022)",
            );
            this.catchUpSession().catch((err) => {
              reqLog.error({ event: "catch_up_error", error: (err as Error).message }, "catch-up failed");
            });
          }
        })
        .catch((err: Error) => {
          reqLog.error({ event: "acp_error", error: err.message });
          this.activeRequestSource = null;
          this.forwardToMobile({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: INTERNAL_ERROR, message: err.message },
          });
        });
    } else if (msg.method === "session/cancel") {
      reqLog.info({ event: "session_cancel" });
      this.acpClient.sessionCancel(msg.params as any);
    }
    // Unknown methods: silently ignore (future extensibility)
  }

  /**
   * Handle an incoming data channel message from the voice-agent on the "voice-acp" topic.
   * Routes to the appropriate ACP method, mirroring handleMobileMessage().
   */
  private handleVoiceAcpMessage(data: unknown, _participantIdentity: string): void {
    if (typeof data !== "object" || data === null) return;

    const msg = data as {
      jsonrpc?: string;
      id?: number | string;
      method?: string;
      params?: Record<string, unknown>;
    };

    const correlationId =
      (msg.params?.requestId as string) ?? crypto.randomUUID();
    const reqLog = this.log.child({ correlationId, source: "voice-acp" });

    this.log.debug({ event: "voice_acp_message_received", msg }, "← voice-acp");

    if (msg.method === "session/message") {
      const promptText = extractPromptText(msg.params?.prompt);
      reqLog.info({ event: "voice_acp_prompt_received", promptText });
      this.activeRequestSource = "voice-acp";

      // Lazy re-init if ACP subprocess died, then send prompt
      this.ensureAcp()
        .then(() => {
          const params = { ...msg.params, sessionId: this.sessionId };
          return this.acpClient.sessionPrompt(params as any);
        })
        .then((result) => {
          reqLog.info({ event: "voice_acp_prompt_completed", stopReason: (result as any).stopReason });
          this.activeRequestSource = null;
          this.forwardToVoiceAgent({
            jsonrpc: "2.0",
            id: msg.id,
            result,
          });
        })
        .catch((err: Error) => {
          reqLog.error({ event: "acp_error", error: err.message });
          this.activeRequestSource = null;
          this.forwardToVoiceAgent({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: INTERNAL_ERROR, message: err.message },
          });
        });
    } else if (msg.method === "session/cancel") {
      reqLog.info({ event: "session_cancel" });
      this.acpClient.sessionCancel(msg.params as any);
    }
    // Unknown methods: silently ignore (future extensibility)
  }

  /**
   * Forward a JSON-RPC message to the voice-agent via the "voice-acp" data channel topic.
   * Filters out payloads exceeding the ~15KB practical data channel limit.
   */
  private forwardToVoiceAgent(msg: object): void {
    if (!this.started) return;

    const json = JSON.stringify(msg);

    // Filter large payloads — data channel has ~15KB practical limit.
    // Tool call results may exceed this. Log and drop rather than crash.
    const MAX_PAYLOAD_BYTES = 15_000;
    if (json.length > MAX_PAYLOAD_BYTES) {
      this.log.warn(
        {
          event: "voice_acp_payload_too_large",
          sizeBytes: json.length,
          maxBytes: MAX_PAYLOAD_BYTES,
          method: (msg as any).method,
        },
        `Dropping voice-acp message: ${json.length} bytes exceeds ${MAX_PAYLOAD_BYTES} limit`,
      );
      return;
    }

    this.log.debug({ event: "forward_to_voice_agent", msg }, "→ voice-acp");

    this.sendQueue = this.sendQueue.then(() =>
      this.options.roomManager
        .sendToRoomOnTopic(this.options.roomName, "voice-acp", msg)
        .then(() => {
          this.forwardFailures = 0;
        })
        .catch((err: Error) => {
          this.forwardFailures++;
          this.log.error(
            {
              event: "forward_to_voice_agent_failed",
              error: err.message,
              consecutiveFailures: this.forwardFailures,
              method: (msg as any).method,
            },
            "Failed to forward message to voice-agent",
          );
          if (this.forwardFailures >= RelayBridge.MAX_CONSECUTIVE_FAILURES) {
            this.log.error(
              { event: "forward_path_dead", consecutiveFailures: this.forwardFailures },
              "Forward path appears dead — too many consecutive failures",
            );
          }
        })
    );
  }

  /**
   * Forward a JSON-RPC message to mobile via the data channel.
   */
  private forwardToMobile(msg: object): void {
    if (!this.started) return;

    this.log.debug({ event: "forward_to_mobile", msg }, "→ mobile");

    this.sendQueue = this.sendQueue.then(() =>
      this.options.roomManager
        .sendToRoom(this.options.roomName, msg)
        .then(() => {
          this.forwardFailures = 0;
        })
        .catch((err: Error) => {
          this.forwardFailures++;
          this.log.error(
            {
              event: "forward_to_mobile_failed",
              error: err.message,
              consecutiveFailures: this.forwardFailures,
              method: (msg as any).method,
            },
            "Failed to forward message to mobile",
          );
          if (this.forwardFailures >= RelayBridge.MAX_CONSECUTIVE_FAILURES) {
            this.log.error(
              { event: "forward_path_dead", consecutiveFailures: this.forwardFailures },
              "Forward path appears dead — too many consecutive failures",
            );
          }
        })
    );
  }
}
