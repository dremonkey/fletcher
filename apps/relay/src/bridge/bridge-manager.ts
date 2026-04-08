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
  rejoinMaxRetries?: number;
  rejoinBaseDelayMs?: number;
  /** How long to wait for session/bind before cleaning up the room. Default: 30_000 ms. */
  bindTimeoutMs?: number;
}

interface PendingBind {
  timer: ReturnType<typeof setTimeout>;
}

interface PendingTeardown {
  timer: ReturnType<typeof setTimeout>;
}

export class BridgeManager {
  private bridges = new Map<string, RelayBridge>();
  private pendingBinds = new Map<string, PendingBind>();
  private pendingTeardowns = new Map<string, PendingTeardown>();
  /** Tracks consecutive bind timeouts per room. Rooms with ≥2 consecutive timeouts are blacklisted. */
  private bindFailedRooms = new Map<string, number>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private log: Logger;
  private rejoinMaxRetries: number;
  private rejoinBaseDelayMs: number;
  private bindTimeoutMs: number;
  private departureGraceMs: number;

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
    this.departureGraceMs = options?.departureGraceMs ?? 60_000;

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
   * Tracks consecutive timeouts; rooms with ≥2 are blacklisted from re-discovery.
   */
  private handleBindTimeout(roomName: string): void {
    if (!this.pendingBinds.has(roomName)) return;

    this.pendingBinds.delete(roomName);

    // Track consecutive bind timeouts for this room
    const count = (this.bindFailedRooms.get(roomName) ?? 0) + 1;
    this.bindFailedRooms.set(roomName, count);

    if (count >= 2) {
      this.log.info(
        { event: "bind_failed_blacklist", roomName, count },
        "Room blacklisted after repeated bind timeouts",
      );
    }

    this.log.warn(
      { event: "bind_timeout", roomName, consecutiveTimeouts: count },
      "No session/bind received within timeout — cleaning up room",
    );

    this.roomManager.leaveRoom(roomName).catch((err) => {
      this.log.error({ event: "bind_timeout_cleanup_failed", roomName, err });
    });
  }

  /**
   * Check if a room is blacklisted from re-adds due to consecutive bind timeouts.
   * Used by room discovery to skip ghost rooms.
   */
  isBindBlacklisted(roomName: string): boolean {
    return (this.bindFailedRooms.get(roomName) ?? 0) >= 2;
  }

  /**
   * Clear the bind-failed blacklist for a room.
   * Called when a participant_joined webhook fires — the mobile is back.
   */
  clearBindBlacklist(roomName: string): void {
    if (this.bindFailedRooms.has(roomName)) {
      this.log.info({ event: "bind_blacklist_cleared", roomName }, "Bind blacklist cleared — participant joined");
      this.bindFailedRooms.delete(roomName);
    }
  }

  // -------------------------------------------------------------------------
  // Deferred teardown (departure grace period)
  // -------------------------------------------------------------------------

  /**
   * Schedule a deferred teardown of a room after the departure grace period.
   * If the participant rejoins within the grace period, the teardown is cancelled
   * via cancelPendingTeardown(). This prevents full relay lifecycle restarts
   * during network switches (WiFi ↔ cellular).
   *
   * Idempotent — if a teardown is already scheduled for the room, this is a no-op.
   */
  scheduleRemoveRoom(roomName: string): void {
    if (this.pendingTeardowns.has(roomName)) return; // already scheduled

    const timer = setTimeout(() => {
      this.pendingTeardowns.delete(roomName);
      this.log.info(
        { event: "deferred_teardown_expired", roomName },
        "Grace period expired — tearing down bridge",
      );
      this.removeRoom(roomName).catch((err) => {
        this.log.error({ event: "deferred_teardown_failed", roomName, err });
      });
    }, this.departureGraceMs);

    if (timer && typeof timer === "object" && "unref" in timer) {
      (timer as NodeJS.Timeout).unref();
    }

    this.pendingTeardowns.set(roomName, { timer });
    this.log.info(
      { event: "deferred_teardown_scheduled", roomName, graceMs: this.departureGraceMs },
      "Scheduled deferred teardown",
    );
  }

  /**
   * Cancel a pending deferred teardown for a room.
   * Called when a participant rejoins within the grace period.
   *
   * @returns true if a teardown was cancelled, false if none was pending.
   */
  cancelPendingTeardown(roomName: string): boolean {
    const pending = this.pendingTeardowns.get(roomName);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingTeardowns.delete(roomName);
    this.log.info(
      { event: "deferred_teardown_cancelled", roomName },
      "Cancelled deferred teardown — participant reconnected",
    );
    return true;
  }

  /**
   * Check if a deferred teardown is pending for a room.
   */
  hasPendingTeardown(roomName: string): boolean {
    return this.pendingTeardowns.has(roomName);
  }

  /**
   * Return all room names that have a pending deferred teardown.
   */
  getPendingTeardowns(): string[] {
    return Array.from(this.pendingTeardowns.keys());
  }

  /**
   * Validate a bridge's health when a participant reconnects after a deferred teardown.
   * If the bridge is healthy, reset the bind timeout so the client has time to re-bind.
   * If the bridge is unhealthy (ACP dead), tear it down and start fresh.
   *
   * This is the BUG-036 safety constraint: unhealthy bridges are never reused.
   */
  async validateOrReplaceBridge(roomName: string): Promise<void> {
    const bridge = this.bridges.get(roomName);
    if (!bridge) {
      await this.addRoom(roomName);
      return;
    }

    const healthy = bridge.isStarted && !bridge.isAcpDead;

    if (healthy) {
      // Fast path: bridge is good — reset bind timeout for re-bind
      this.log.info(
        { roomName, event: "bridge_reuse" },
        "Reusing healthy bridge after reconnect",
      );
      this.resetBindTimeout(roomName);
    } else {
      // Slow path: ACP is dead/hung — tear down and create fresh (BUG-036 scenario)
      this.log.warn(
        { roomName, event: "bridge_replace" },
        "Bridge unhealthy — replacing with fresh instance",
      );
      await this.removeRoom(roomName);
      await this.addRoom(roomName);
    }
  }

  /**
   * Reset the bind timeout for a room whose bridge survived a grace period.
   * Gives the reconnecting client 30s to send session/bind again.
   */
  private resetBindTimeout(roomName: string): void {
    // Clear any existing bind timeout
    const existing = this.pendingBinds.get(roomName);
    if (existing) {
      clearTimeout(existing.timer);
      this.pendingBinds.delete(roomName);
    }

    // Start a new bind timeout
    const timer = setTimeout(() => {
      this.handleBindTimeout(roomName);
    }, this.bindTimeoutMs);

    if (timer && typeof timer === "object" && "unref" in timer) {
      (timer as NodeJS.Timeout).unref();
    }

    this.pendingBinds.set(roomName, { timer });
    this.log.debug(
      { event: "bind_timeout_reset", roomName },
      "Reset bind timeout for reconnecting client",
    );
  }

  /**
   * Check if a room already has a bridge, is pending bind, or has a pending teardown.
   */
  hasRoom(roomName: string): boolean {
    return this.bridges.has(roomName) || this.pendingBinds.has(roomName) || this.pendingTeardowns.has(roomName);
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

    // Clear all pending teardown timers
    for (const [, pending] of this.pendingTeardowns) {
      clearTimeout(pending.timer);
    }
    this.pendingTeardowns.clear();

    // Clear all pending bind timers
    for (const [, pending] of this.pendingBinds) {
      clearTimeout(pending.timer);
    }
    this.pendingBinds.clear();
    this.bindFailedRooms.clear();

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
