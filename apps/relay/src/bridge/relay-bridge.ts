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
import { createLogger } from "../utils/logger";

const log = createLogger("relay-bridge");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelayBridgeOptions {
  roomName: string;
  roomManager: RoomManager;
  acpCommand: string;
  acpArgs?: string[];
}

// ---------------------------------------------------------------------------
// RelayBridge
// ---------------------------------------------------------------------------

export class RelayBridge {
  private acpClient: AcpClient;
  private sessionId: string | null = null;
  private started = false;

  constructor(private options: RelayBridgeOptions) {
    this.acpClient = new AcpClient({
      command: options.acpCommand,
      args: options.acpArgs,
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
    log.info({ event: "acp_initialized", roomName, sessionId: this.sessionId });

    // 3. Register data handler for mobile -> ACP forwarding
    this.options.roomManager.onDataReceived(
      (rn, data, participantIdentity) => {
        if (rn !== roomName) return;
        this.handleMobileMessage(data, participantIdentity);
      },
    );

    // 4. Register ACP -> mobile forwarding
    this.acpClient.onUpdate((params: SessionUpdateParams) => {
      this.forwardToMobile({
        jsonrpc: "2.0",
        method: "session/update",
        params,
      });
    });

    this.started = true;
    log.info({ event: "room_joined", roomName });
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

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  /**
   * Handle an incoming data channel message from mobile.
   * Routes to the appropriate ACP method.
   */
  private handleMobileMessage(data: unknown, _participantIdentity: string): void {
    if (typeof data !== "object" || data === null) return;

    const msg = data as {
      jsonrpc?: string;
      id?: number | string;
      method?: string;
      params?: Record<string, unknown>;
    };

    if (msg.method === "session/prompt") {
      // Enrich: inject sessionId
      const params = { ...msg.params, sessionId: this.sessionId };

      this.acpClient
        .sessionPrompt(params as any)
        .then((result) => {
          this.forwardToMobile({
            jsonrpc: "2.0",
            id: msg.id,
            result,
          });
        })
        .catch((err: Error) => {
          log.error({ event: "acp_error", roomName: this.options.roomName, error: err.message });
          this.forwardToMobile({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: INTERNAL_ERROR, message: err.message },
          });
        });
    } else if (msg.method === "session/cancel") {
      this.acpClient.sessionCancel(msg.params as any);
    }
    // Unknown methods: silently ignore (future extensibility)
  }

  /**
   * Forward a JSON-RPC message to mobile via the data channel.
   */
  private forwardToMobile(msg: object): void {
    if (!this.started) return;

    this.options.roomManager
      .sendToRoom(this.options.roomName, msg)
      .catch(() => {
        // Room may have disconnected — swallow errors
      });
  }
}
