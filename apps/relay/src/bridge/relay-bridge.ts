/**
 * RelayBridge — wires a LiveKit room to an ACP subprocess.
 *
 * Mobile messages on the "relay" data channel are forwarded to ACPX.
 * ACPX responses/notifications are forwarded back to the mobile client.
 */

import { AcpClient } from "../acp/client";
import type { RoomManager } from "../livekit/room-manager";
import type { SessionUpdateParams } from "../acp/types";
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
// RelayBridge
// ---------------------------------------------------------------------------

export class RelayBridge {
  private acpClient: AcpClient;
  private log: Logger;
  private sessionId: string | null = null;
  private started = false;
  private needsReinit = false;
  private reinitializing: Promise<void> | null = null;
  /** Serializes all forwardToMobile calls so chunks always arrive before the result. */
  private sendQueue: Promise<void> = Promise.resolve();

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
      },
    });
    this.sessionId = result.sessionId;
    this.log.info({ event: "acp_initialized", sessionId: this.sessionId });

    // 3. Register data handler for mobile -> ACP forwarding
    this.options.roomManager.onDataReceived(
      (rn, data, participantIdentity) => {
        if (rn !== roomName) return;
        this.handleMobileMessage(data, participantIdentity);
      },
    );

    // 4. Register ACP -> mobile forwarding (transparent passthrough)
    this.acpClient.onUpdate((params: SessionUpdateParams) => {
      this.log.debug({ event: "acp_update_received", params }, "← acp session/update");
      this.forwardToMobile({ jsonrpc: "2.0", method: "session/update", params });
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
      },
    });

    this.sessionId = result.sessionId;
    this.needsReinit = false;
    this.log.info({ event: "acp_reinit_complete", sessionId: this.sessionId }, "ACP re-initialized");
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
      reqLog.info({ event: "mobile_prompt_received" });

      // Lazy re-init if ACP subprocess died, then send prompt
      this.ensureAcp()
        .then(() => {
          const params = { ...msg.params, sessionId: this.sessionId };
          return this.acpClient.sessionPrompt(params as any);
        })
        .then((result) => {
          reqLog.info({ event: "mobile_prompt_responded", stopReason: (result as any).stopReason });
          this.forwardToMobile({
            jsonrpc: "2.0",
            id: msg.id,
            result,
          });
        })
        .catch((err: Error) => {
          reqLog.error({ event: "acp_error", error: err.message });
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
   * Forward a JSON-RPC message to mobile via the data channel.
   */
  private forwardToMobile(msg: object): void {
    if (!this.started) return;

    this.log.debug({ event: "forward_to_mobile", msg }, "→ mobile");

    this.sendQueue = this.sendQueue.then(() =>
      this.options.roomManager
        .sendToRoom(this.options.roomName, msg)
        .catch(() => {
          // Room may have disconnected — swallow errors
        })
    );
  }
}
