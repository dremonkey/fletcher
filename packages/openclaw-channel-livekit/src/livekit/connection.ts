/**
 * LiveKit room connection management.
 */
import { AccessToken } from "livekit-server-sdk";
import { Room, RoomEvent } from "@livekit/rtc-node";
import { getLivekitLogger } from "../runtime.js";

/**
 * Parameters for generating an agent token.
 */
export interface GenerateTokenParams {
  url: string;
  apiKey: string;
  apiSecret: string;
  roomName: string;
  participantName: string;
  participantIdentity: string;
  ttl?: number;
}

/**
 * Parameters for connecting to a room.
 */
export interface ConnectParams {
  url: string;
  token: string;
}

/**
 * Generate a LiveKit access token for the agent.
 */
export async function generateAgentToken(params: GenerateTokenParams): Promise<string> {
  const {
    apiKey,
    apiSecret,
    roomName,
    participantName,
    participantIdentity,
    ttl = 60 * 60, // 1 hour default
  } = params;

  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    name: participantName,
    ttl,
  });

  // Grant permissions for agent
  token.addGrant({
    room: roomName,
    roomJoin: true,
    roomCreate: true, // Allow creating rooms
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return await token.toJwt();
}

/**
 * Connect to a LiveKit room.
 */
export async function connectToRoom(params: ConnectParams): Promise<Room> {
  const { url, token } = params;
  const log = getLivekitLogger();

  const room = new Room();

  // Set up event handlers before connecting
  room.on(RoomEvent.Connected, () => {
    log.info(`Connected to room: ${room.name}`);
  });

  room.on(RoomEvent.Disconnected, (reason) => {
    log.info(`Disconnected from room: ${room.name}, reason: ${reason}`);
  });

  room.on(RoomEvent.Reconnecting, () => {
    log.debug(`Reconnecting to room: ${room.name}`);
  });

  room.on(RoomEvent.Reconnected, () => {
    log.info(`Reconnected to room: ${room.name}`);
  });

  // Connect to the room
  await room.connect(url, token);

  return room;
}

/**
 * Disconnect from a LiveKit room.
 */
export function disconnectRoom(room: unknown): void {
  if (room && typeof room === "object" && "disconnect" in room) {
    (room as Room).disconnect();
  }
}

/**
 * Generate a token for mobile clients to join a room.
 */
export async function generateClientToken(params: {
  apiKey: string;
  apiSecret: string;
  roomName: string;
  participantIdentity: string;
  participantName?: string;
  ttl?: number;
}): Promise<string> {
  const {
    apiKey,
    apiSecret,
    roomName,
    participantIdentity,
    participantName = participantIdentity,
    ttl = 60 * 60, // 1 hour default
  } = params;

  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    name: participantName,
    ttl,
  });

  // Grant permissions for client (more restricted than agent)
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true, // Can publish audio
    canSubscribe: true, // Can receive agent audio
    canPublishData: true, // Can send data messages
  });

  return await token.toJwt();
}
