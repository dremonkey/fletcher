/**
 * BridgeManager — manages per-room RelayBridge instances.
 *
 * Each room gets one bridge (one ACPX subprocess + one ACP session).
 */

import { RelayBridge } from "./relay-bridge";
import type { RoomManager } from "../livekit/room-manager";
import { createLogger } from "../utils/logger";

const log = createLogger("bridge-manager");

// ---------------------------------------------------------------------------
// BridgeManager
// ---------------------------------------------------------------------------

export class BridgeManager {
  private bridges = new Map<string, RelayBridge>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private roomManager: RoomManager,
    private acpCommand: string,
    private acpArgs: string[],
  ) {}

  /**
   * Create a bridge for a room: join the room, then start the bridge.
   * Idempotent — if a bridge already exists for the room, returns without action.
   */
  async addRoom(roomName: string): Promise<void> {
    if (this.bridges.has(roomName)) return;

    // Join the LiveKit room first
    await this.roomManager.joinRoom(roomName);

    // Create and start the bridge
    const bridge = new RelayBridge({
      roomName,
      roomManager: this.roomManager,
      acpCommand: this.acpCommand,
      acpArgs: this.acpArgs,
    });

    this.bridges.set(roomName, bridge);
    await bridge.start();
    log.info({ event: "room_added", roomName });
  }

  /**
   * Remove a bridge: stop the bridge and leave the room.
   */
  async removeRoom(roomName: string): Promise<void> {
    const bridge = this.bridges.get(roomName);
    if (!bridge) return;

    await bridge.stop();
    this.bridges.delete(roomName);
    await this.roomManager.leaveRoom(roomName);
    log.info({ event: "room_removed", roomName });
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
