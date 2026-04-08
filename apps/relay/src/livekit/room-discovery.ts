/**
 * Room discovery — on startup, find LiveKit rooms with human participants
 * but no relay, and auto-join them.
 */

import type { RoomServiceClient } from "livekit-server-sdk";
import type { BridgeManager } from "../bridge/bridge-manager";
import type { Logger } from "../utils/logger";
import { isHumanParticipant, RELAY_IDENTITY_PREFIX } from "./participant-filter";

export interface DiscoveryResult {
  /** Total rooms discovered from LiveKit */
  roomsChecked: number;
  /** Rooms that were rejoined */
  roomsRejoined: string[];
  /** Rooms skipped (already have relay or no humans) */
  roomsSkipped: string[];
  /** Rooms where rejoin failed */
  roomsFailed: string[];
}

function hasRelay(participants: { identity?: string }[]): boolean {
  return participants.some((p) => p.identity?.startsWith(RELAY_IDENTITY_PREFIX));
}

function hasHumans(participants: { identity?: string; kind?: number }[]): boolean {
  return participants.some(isHumanParticipant);
}

export async function discoverAndRejoinRooms({
  roomService,
  bridgeManager,
  logger,
}: {
  roomService: RoomServiceClient;
  bridgeManager: BridgeManager;
  logger: Logger;
}): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    roomsChecked: 0,
    roomsRejoined: [],
    roomsSkipped: [],
    roomsFailed: [],
  };

  let rooms: { name: string }[];
  try {
    rooms = await roomService.listRooms();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.warn({ error: message }, "Room discovery: failed to list rooms from LiveKit");
    return result;
  }

  result.roomsChecked = rooms.length;

  for (const room of rooms) {
    const roomName = room.name;
    try {
      // Already tracking this room
      if (bridgeManager.hasRoom(roomName)) {
        result.roomsSkipped.push(roomName);
        continue;
      }

      // Skip rooms blacklisted from repeated bind timeouts (ghost rooms)
      if (bridgeManager.isBindBlacklisted(roomName)) {
        result.roomsSkipped.push(roomName);
        continue;
      }

      const participants = await roomService.listParticipants(roomName);

      if (hasRelay(participants)) {
        result.roomsSkipped.push(roomName);
        continue;
      }

      if (!hasHumans(participants)) {
        result.roomsSkipped.push(roomName);
        continue;
      }

      await bridgeManager.addRoom(roomName);
      result.roomsRejoined.push(roomName);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ roomName, error: message }, "Room discovery: failed to rejoin room");
      result.roomsFailed.push(roomName);
    }
  }

  const logData = {
    event: "room_discovery_complete",
    checked: result.roomsChecked,
    rejoined: result.roomsRejoined.length,
    skipped: result.roomsSkipped.length,
    failed: result.roomsFailed.length,
  };

  // Only log at info when something actually happened; debug otherwise
  if (result.roomsRejoined.length > 0 || result.roomsFailed.length > 0) {
    logger.info(logData, `Room discovery: rejoined ${result.roomsRejoined.length} room(s)`);
  } else {
    logger.debug(logData, "Room discovery: no action needed");
  }

  return result;
}
