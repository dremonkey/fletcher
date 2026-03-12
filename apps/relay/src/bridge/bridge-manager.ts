/**
 * BridgeManager — manages per-room RelayBridge instances.
 *
 * Each room gets one bridge (one ACPX subprocess + one ACP session).
 */

import { RelayBridge } from "./relay-bridge";
import type { RoomManager } from "../livekit/room-manager";

// ---------------------------------------------------------------------------
// BridgeManager
// ---------------------------------------------------------------------------

export class BridgeManager {
  private bridges = new Map<string, RelayBridge>();

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
}
