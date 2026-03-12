import { Room, RoomEvent, DataPacketKind } from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoomConnection {
  room: Room;
  roomName: string;
  joinedAt: number;
  lastActivity: number;
}

/**
 * Called when a data-channel message arrives on the "relay" topic.
 *
 * @param roomName  - Which room the data came from
 * @param data      - Parsed JSON payload
 * @param participantIdentity - Identity of the sender
 */
export type DataHandler = (
  roomName: string,
  data: unknown,
  participantIdentity: string,
) => void;

/** Factory that creates Room instances. Override in tests to inject mocks. */
export type RoomFactory = () => Room;

export interface RoomManagerOptions {
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  /** Override Room construction for testing. Defaults to `() => new Room()`. */
  roomFactory?: RoomFactory;
}

// ---------------------------------------------------------------------------
// RoomManager
// ---------------------------------------------------------------------------

/**
 * Manages LiveKit room connections for the relay.
 *
 * The relay joins rooms as a non-agent participant (`relay-<roomName>`) and
 * communicates exclusively via the data channel on topic `"relay"`.
 */
export class RoomManager {
  private rooms = new Map<string, RoomConnection>();
  private dataHandlers: DataHandler[] = [];
  private createRoom: RoomFactory;

  constructor(private options: RoomManagerOptions) {
    this.createRoom = options.roomFactory ?? (() => new Room());
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Join a LiveKit room. Idempotent — if already connected to the room,
   * returns the existing connection.
   */
  async joinRoom(roomName: string): Promise<RoomConnection> {
    const existing = this.rooms.get(roomName);
    if (existing) {
      return existing;
    }

    const room = this.createRoom();
    const token = await this.generateToken(roomName);
    await room.connect(this.options.livekitUrl, token);

    // Subscribe to data channel messages on the "relay" topic
    room.on(
      RoomEvent.DataReceived,
      (
        payload: Uint8Array,
        participant?: { identity: string },
        _kind?: DataPacketKind,
        topic?: string,
      ) => {
        if (topic !== "relay") return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.from(payload).toString("utf-8"));
        } catch {
          // Ignore malformed JSON
          return;
        }

        const identity = participant?.identity ?? "unknown";
        for (const handler of this.dataHandlers) {
          handler(roomName, parsed, identity);
        }
      },
    );

    const now = Date.now();
    const conn: RoomConnection = {
      room,
      roomName,
      joinedAt: now,
      lastActivity: now,
    };

    this.rooms.set(roomName, conn);
    return conn;
  }

  /**
   * Leave a room and clean up the connection.
   */
  async leaveRoom(roomName: string): Promise<void> {
    const conn = this.rooms.get(roomName);
    if (!conn) return;

    await conn.room.disconnect();
    this.rooms.delete(roomName);
  }

  /**
   * Retrieve the connection for a given room, or undefined if not joined.
   */
  getRoom(roomName: string): RoomConnection | undefined {
    return this.rooms.get(roomName);
  }

  /**
   * Return all active room connections.
   */
  getActiveRooms(): RoomConnection[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Publish a JSON message to a room's data channel on the "relay" topic.
   * Throws if not currently in the specified room.
   */
  async sendToRoom(roomName: string, msg: object): Promise<void> {
    const conn = this.rooms.get(roomName);
    if (!conn) {
      throw new Error(`Not connected to room: ${roomName}`);
    }

    const data = Buffer.from(JSON.stringify(msg));
    await conn.room.localParticipant!.publishData(data, {
      reliable: true,
      topic: "relay",
    });

    conn.lastActivity = Date.now();
  }

  /**
   * Register a handler that is invoked whenever a "relay" topic data message
   * arrives in any joined room.
   */
  onDataReceived(handler: DataHandler): void {
    this.dataHandlers.push(handler);
  }

  /**
   * Disconnect from all rooms and clear state.
   */
  async disconnectAll(): Promise<void> {
    const disconnects = Array.from(this.rooms.values()).map((conn) =>
      conn.room.disconnect(),
    );
    await Promise.all(disconnects);
    this.rooms.clear();
  }

  /**
   * Update the `lastActivity` timestamp for a room.
   */
  touchRoom(roomName: string): void {
    const conn = this.rooms.get(roomName);
    if (conn) {
      conn.lastActivity = Date.now();
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Generate a LiveKit access token for the relay to join the given room.
   */
  private async generateToken(roomName: string): Promise<string> {
    const token = new AccessToken(
      this.options.apiKey,
      this.options.apiSecret,
      {
        identity: `relay-${roomName}`,
      },
    );
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublishData: true,
    });
    return token.toJwt();
  }
}
