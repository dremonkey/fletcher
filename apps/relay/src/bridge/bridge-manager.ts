/**
 * BridgeManager — manages per-room RelayBridge instances.
 *
 * Each room gets one bridge (one ACPX subprocess + one ACP session).
 *
 * Lifecycle:
 *  1. addRoom()      — joins the LiveKit room, waits for session/bind
 *  2. session/bind   — client sends sessionKey; bridge is created and started
 *  3. removeRoom()   — stops bridge and leaves room
 *
 * A 30-second bind timeout applies: if no session/bind arrives the relay
 * leaves the room automatically.
 */

import { RelayBridge } from "./relay-bridge";
import type { RoomManager } from "../livekit/room-manager";
import { rootLogger, type Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// BridgeManager
// ---------------------------------------------------------------------------

export interface BridgeManagerOptions {
  departureGraceMs?: number;
  rejoinMaxRetries?: number;
  rejoinBaseDelayMs?: number;
  /** How long to wait for session/bind before cleaning up the room. Default: 30_000 ms. */
  bindTimeoutMs?: number;
}

interface PendingBind {
  timer: ReturnType<typeof setTimeout>;
}

export class BridgeManager {
  private bridges = new Map<string, RelayBridge>();
  private pendingBinds = new Map<string, PendingBind>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private log: Logger;
  private rejoinMaxRetries: number;
  private rejoinBaseDelayMs: number;
  private bindTimeoutMs: number;

  constructor(
    private roomManager: RoomManager,
    private acpCommand: string,
    private acpArgs: string[],
    logger?: Logger,
    options?: BridgeManagerOptions,
  ) {
    this.log = logger ?? rootLogger.child({ component: "bridge-manager" });
    this.rejoinMaxRetries = options?.rejoinMaxRetries ?? 3;
    this.rejoinBaseDelayMs = options?.rejoinBaseDelayMs ?? 1_000;
    this.bindTimeoutMs = options?.bindTimeoutMs ?? 30_000;

    this.roomManager.onRoomDisconnected((roomName, reason) => {
      this.handleRoomDisconnected(roomName, reason);
    });

    // Single global handler for the "relay" topic — handles session/bind and
    // routes other methods to the appropriate bridge once one exists.
    this.roomManager.onDataReceived("relay", (roomName, data, participantIdentity) => {
      this.handleRelayMessage(roomName, data, participantIdentity);
    });
  }

  /**
   * Join a LiveKit room and wait for a session/bind message from the client.
   * Idempotent — if a bridge or pending bind already exists for the room, returns without action.
   */
  async addRoom(roomName: string): Promise<void> {
    if (this.bridges.has(roomName) || this.pendingBinds.has(roomName)) return;

    // Join the LiveKit room first
    await this.roomManager.joinRoom(roomName);

    // Start bind timeout
    const timer = setTimeout(() => {
      this.handleBindTimeout(roomName);
    }, this.bindTimeoutMs);

    if (timer && typeof timer === "object" && "unref" in timer) {
      (timer as NodeJS.Timeout).unref();
    }

    this.pendingBinds.set(roomName, { timer });
    this.log.info({ event: "room_added_pending_bind", roomName });
  }

  /**
   * Remove a bridge: stop the bridge and leave the room.
   * Also cleans up any pending bind state.
   */
  async removeRoom(roomName: string): Promise<void> {
    // Clean up pending bind if exists
    const pending = this.pendingBinds.get(roomName);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingBinds.delete(roomName);
    }

    const bridge = this.bridges.get(roomName);
    if (!bridge && !pending) return; // nothing to clean up

    if (bridge) {
      await bridge.stop();
      this.bridges.delete(roomName);
    }
    await this.roomManager.leaveRoom(roomName);
    this.log.info({ event: "room_removed", roomName });
  }

  // -------------------------------------------------------------------------
  // session/bind handling
  // -------------------------------------------------------------------------

  /**
   * Route incoming "relay" topic messages. session/bind is handled here;
   * all other methods (session/prompt, session/cancel) are handled by the
   * RelayBridge's own data handler once a bridge exists.
   */
  private handleRelayMessage(roomName: string, data: unknown, _participantIdentity: string): void {
    if (typeof data !== "object" || data === null) return;
    const msg = data as { method?: string; id?: number | string; params?: Record<string, unknown> };

    if (msg.method === "session/bind") {
      this.handleSessionBind(roomName, msg).catch((err) => {
        this.log.error({ event: "session_bind_error", roomName, err });
      });
    }
    // Other methods (session/prompt, session/cancel, voice-acp, etc.) are
    // handled by RelayBridge's own onDataReceived handlers registered in start().
  }

  /**
   * Handle a session/bind JSON-RPC message from the mobile client.
   * Creates and starts a RelayBridge with the client-specified session key.
   */
  private async handleSessionBind(
    roomName: string,
    msg: { id?: number | string; params?: Record<string, unknown> },
  ): Promise<void> {
    const sessionKey = msg.params?.sessionKey as string | undefined;

    // Duplicate bind — already has a bridge; respond with current state
    if (this.bridges.has(roomName)) {
      await this.roomManager.sendToRoom(roomName, {
        jsonrpc: "2.0",
        id: msg.id,
        result: { sessionKey, bound: true },
      });
      return;
    }

    // Not pending — shouldn't happen, but handle gracefully
    if (!this.pendingBinds.has(roomName)) {
      this.log.warn({ event: "bind_unexpected", roomName }, "session/bind for unknown room");
      return;
    }

    // Validate session key
    if (!sessionKey || typeof sessionKey !== "string") {
      await this.roomManager.sendToRoom(roomName, {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32602, message: "Missing or invalid sessionKey" },
      });
      return;
    }

    // Clear bind timeout
    const pending = this.pendingBinds.get(roomName)!;
    clearTimeout(pending.timer);
    this.pendingBinds.delete(roomName);

    // Create and start bridge with client-specified session key
    const bridge = new RelayBridge({
      roomName,
      sessionKey,
      roomManager: this.roomManager,
      acpCommand: this.acpCommand,
      acpArgs: this.acpArgs,
      logger: this.log.child({ component: "relay-bridge", roomName }),
    });

    this.bridges.set(roomName, bridge);
    await bridge.start();

    // Send bind response
    await this.roomManager.sendToRoom(roomName, {
      jsonrpc: "2.0",
      id: msg.id,
      result: { sessionKey, bound: true },
    });

    this.log.info({ event: "session_bound", roomName, sessionKey });
  }

  /**
   * Called when the bind timeout fires — clean up the room if no bind arrived.
   */
  private handleBindTimeout(roomName: string): void {
    if (!this.pendingBinds.has(roomName)) return;

    this.pendingBinds.delete(roomName);
    this.log.warn(
      { event: "bind_timeout", roomName },
      "No session/bind received within timeout — cleaning up room",
    );

    this.roomManager.leaveRoom(roomName).catch((err) => {
      this.log.error({ event: "bind_timeout_cleanup_failed", roomName, err });
    });
  }

  // -------------------------------------------------------------------------
  // DEPRECATED: Deferred teardown (BUG-036)
  // -------------------------------------------------------------------------

  /** @deprecated Removed in favor of immediate teardown. */
  scheduleRemoveRoom(roomName: string): void {
    this.removeRoom(roomName).catch((err) => {
      this.log.error({ event: "immediate_teardown_failed", roomName, err }, "Immediate teardown failed");
    });
  }

  /** @deprecated Always returns false. */
  cancelPendingTeardown(_roomName: string): boolean {
    return false;
  }

  /** @deprecated Always returns false. */
  hasPendingTeardown(_roomName: string): boolean {
    return false;
  }

  /** @deprecated Always returns empty array. */
  getPendingTeardowns(): string[] {
    return [];
  }

  /**
   * Check if a room already has a bridge OR is pending bind.
   */
  hasRoom(roomName: string): boolean {
    return this.bridges.has(roomName) || this.pendingBinds.has(roomName);
  }

  /**
   * Get the bridge for a room, or undefined if no bridge exists.
   */
  getBridge(roomName: string): RelayBridge | undefined {
    return this.bridges.get(roomName);
  }

  /**
   * Return all active room names that have bridges.
   */
  getActiveRooms(): string[] {
    return Array.from(this.bridges.keys());
  }

  /**
   * Shut down all bridges and disconnect from all rooms.
   */
  async shutdownAll(): Promise<void> {
    this.stopDiscoveryTimer();

    // Clear all pending bind timers
    for (const [, pending] of this.pendingBinds) {
      clearTimeout(pending.timer);
    }
    this.pendingBinds.clear();

    const stops = Array.from(this.bridges.entries()).map(
      async ([roomName, bridge]) => {
        await bridge.stop();
        this.bridges.delete(roomName);
      },
    );
    await Promise.all(stops);
    await this.roomManager.disconnectAll();
  }

  // -------------------------------------------------------------------------
  // Disconnect recovery
  // -------------------------------------------------------------------------

  /**
   * Handle an unexpected room disconnect: clean up stale bridge, then
   * attempt to rejoin with exponential backoff.
   */
  private handleRoomDisconnected(roomName: string, reason: unknown): void {
    this.log.warn(
      { event: "room_disconnected", roomName, reason },
      "Room disconnected unexpectedly, will attempt rejoin",
    );

    // Clear any pending bind for this room (no need to cancel timer — disconnect already fired)
    if (this.pendingBinds.has(roomName)) {
      const pending = this.pendingBinds.get(roomName)!;
      clearTimeout(pending.timer);
      this.pendingBinds.delete(roomName);
    }

    // Stop + delete the stale bridge (fire-and-forget)
    const bridge = this.bridges.get(roomName);
    if (bridge) {
      this.bridges.delete(roomName);
      bridge.stop().catch(() => {});
    }

    this.rejoinWithBackoff(roomName, 0);
  }

  /**
   * Attempt to rejoin a room with exponential backoff.
   */
  private rejoinWithBackoff(roomName: string, attempt: number): void {
    if (attempt >= this.rejoinMaxRetries) {
      this.log.error(
        { event: "rejoin_failed", roomName, attempts: attempt },
        "Giving up rejoin — periodic discovery will catch it",
      );
      return;
    }

    const delay = this.rejoinBaseDelayMs * Math.pow(2, attempt);
    const timer = setTimeout(async () => {
      try {
        await this.addRoom(roomName);
        this.log.info(
          { event: "rejoin_success", roomName, attempt: attempt + 1 },
          "Successfully rejoined room after disconnect",
        );
      } catch (err) {
        this.log.warn(
          { event: "rejoin_attempt_failed", roomName, attempt: attempt + 1, err },
          "Rejoin attempt failed, retrying",
        );
        this.rejoinWithBackoff(roomName, attempt + 1);
      }
    }, delay);

    if (timer && typeof timer === "object" && "unref" in timer) {
      (timer as NodeJS.Timeout).unref();
    }
  }

  // -------------------------------------------------------------------------
  // Periodic room discovery
  // -------------------------------------------------------------------------

  /**
   * Start a periodic timer that calls `discoveryFn` to find and rejoin rooms.
   */
  startDiscoveryTimer(discoveryFn: () => Promise<void>, intervalMs: number = 30_000): void {
    this.stopDiscoveryTimer();

    this.discoveryTimer = setInterval(() => {
      discoveryFn().catch((err) => {
        this.log.warn({ event: "discovery_error", err }, "Periodic room discovery failed");
      });
    }, intervalMs);

    if (this.discoveryTimer && typeof this.discoveryTimer === "object" && "unref" in this.discoveryTimer) {
      (this.discoveryTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Stop the periodic discovery timer.
   */
  stopDiscoveryTimer(): void {
    if (this.discoveryTimer !== null) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Idle timeout
  // -------------------------------------------------------------------------

  /**
   * Start a periodic timer that checks for idle rooms and removes them.
   *
   * @param timeoutMs  - A room is idle if lastActivity is older than this.
   * @param intervalMs - How often to check (defaults to 60 seconds).
   */
  startIdleTimer(timeoutMs: number, intervalMs: number = 60_000): void {
    this.stopIdleTimer();

    this.idleTimer = setInterval(() => {
      this.checkIdleRooms(timeoutMs);
    }, intervalMs);

    // Allow the process to exit even if the timer is running
    if (this.idleTimer && typeof this.idleTimer === "object" && "unref" in this.idleTimer) {
      (this.idleTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Stop the idle timer.
   */
  stopIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Check for idle rooms and remove them. Exposed for testing.
   */
  async checkIdleRooms(timeoutMs: number): Promise<void> {
    const now = Date.now();
    const connections = this.roomManager.getActiveRooms();

    const removals: Promise<void>[] = [];

    for (const conn of connections) {
      if (now - conn.lastActivity > timeoutMs) {
        removals.push(this.removeRoom(conn.roomName));
      }
    }

    await Promise.all(removals);
  }
}
