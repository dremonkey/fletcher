/**
 * BridgeManager — manages per-room RelayBridge instances.
 *
 * Each room gets one bridge (one ACPX subprocess + one ACP session).
 */

import { RelayBridge } from "./relay-bridge";
import type { RoomManager } from "../livekit/room-manager";
import { rootLogger, type Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// BridgeManager
// ---------------------------------------------------------------------------

export interface BridgeManagerOptions {
  departureGraceMs?: number;
}

export class BridgeManager {
  private bridges = new Map<string, RelayBridge>();
  private pendingTeardowns = new Map<string, Timer>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private log: Logger;
  private departureGraceMs: number;

  constructor(
    private roomManager: RoomManager,
    private acpCommand: string,
    private acpArgs: string[],
    logger?: Logger,
    options?: BridgeManagerOptions,
  ) {
    this.log = logger ?? rootLogger.child({ component: "bridge-manager" });
    this.departureGraceMs = options?.departureGraceMs ?? 120_000;
  }

  /**
   * Create a bridge for a room: join the room, then start the bridge.
   * Idempotent — if a bridge already exists for the room, returns without action.
   */
  async addRoom(roomName: string): Promise<void> {
    this.cancelPendingTeardown(roomName);
    if (this.bridges.has(roomName)) return;

    // Join the LiveKit room first
    await this.roomManager.joinRoom(roomName);

    // Create and start the bridge with a room-scoped logger
    const bridge = new RelayBridge({
      roomName,
      roomManager: this.roomManager,
      acpCommand: this.acpCommand,
      acpArgs: this.acpArgs,
      logger: this.log.child({ component: "relay-bridge", roomName }),
    });

    this.bridges.set(roomName, bridge);
    await bridge.start();
    this.log.info({ event: "room_added", roomName });
  }

  /**
   * Remove a bridge: stop the bridge and leave the room.
   */
  async removeRoom(roomName: string): Promise<void> {
    this.cancelPendingTeardown(roomName);

    const bridge = this.bridges.get(roomName);
    if (!bridge) return;

    await bridge.stop();
    this.bridges.delete(roomName);
    await this.roomManager.leaveRoom(roomName);
    this.log.info({ event: "room_removed", roomName });
  }

  // -------------------------------------------------------------------------
  // Deferred teardown (departure grace period)
  // -------------------------------------------------------------------------

  /**
   * Schedule a deferred teardown for a room. If the participant reconnects
   * before the grace period expires, the teardown can be cancelled.
   * Deduplicates — calling again for the same room is a no-op.
   */
  scheduleRemoveRoom(roomName: string): void {
    if (this.pendingTeardowns.has(roomName)) return;

    this.log.info(
      { event: "teardown_scheduled", roomName, graceMs: this.departureGraceMs },
      "Deferred teardown scheduled",
    );

    const timer = setTimeout(async () => {
      this.pendingTeardowns.delete(roomName);
      this.log.info({ event: "teardown_executing", roomName }, "Grace period expired, removing room");
      await this.removeRoom(roomName);
    }, this.departureGraceMs);

    // Don't prevent process exit
    if (timer && typeof timer === "object" && "unref" in timer) {
      (timer as NodeJS.Timeout).unref();
    }

    this.pendingTeardowns.set(roomName, timer);
  }

  /**
   * Cancel a pending deferred teardown for a room.
   * Returns true if a pending teardown was cancelled, false otherwise.
   */
  cancelPendingTeardown(roomName: string): boolean {
    const timer = this.pendingTeardowns.get(roomName);
    if (!timer) return false;

    clearTimeout(timer);
    this.pendingTeardowns.delete(roomName);
    this.log.info({ event: "teardown_cancelled", roomName }, "Deferred teardown cancelled");
    return true;
  }

  /**
   * Check if a room has a pending deferred teardown.
   */
  hasPendingTeardown(roomName: string): boolean {
    return this.pendingTeardowns.has(roomName);
  }

  /**
   * Return all room names with pending teardowns (for observability).
   */
  getPendingTeardowns(): string[] {
    return Array.from(this.pendingTeardowns.keys());
  }

  /**
   * Check if a room already has a bridge.
   */
  hasRoom(roomName: string): boolean {
    return this.bridges.has(roomName);
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
    // Clear all pending deferred teardowns
    for (const [roomName, timer] of this.pendingTeardowns) {
      clearTimeout(timer);
    }
    this.pendingTeardowns.clear();

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
