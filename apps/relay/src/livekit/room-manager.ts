import { Room, RoomEvent, DataPacketKind, DisconnectReason } from "@livekit/rtc-node";
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
 * Called when a data-channel message arrives on a registered topic.
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

/**
 * Called when the relay is unexpectedly disconnected from a room.
 */
export type DisconnectHandler = (
  roomName: string,
  reason: DisconnectReason,
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
 * communicates via the data channel. Handlers can be registered per-topic
 * so that multiple data channel topics (e.g. "relay", "voice-acp") can be
 * handled independently.
 */
export class RoomManager {
  private rooms = new Map<string, RoomConnection>();
  private topicHandlers = new Map<string, DataHandler[]>();
  private disconnectHandlers: DisconnectHandler[] = [];
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

    // Subscribe to data channel messages and dispatch by topic
    room.on(
      RoomEvent.DataReceived,
      (
        payload: Uint8Array,
        participant?: { identity: string },
        _kind?: DataPacketKind,
        topic?: string,
      ) => {
        if (!topic) return;
        const handlers = this.topicHandlers.get(topic);
        if (!handlers?.length) return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.from(payload).toString("utf-8"));
        } catch {
          // Ignore malformed JSON
          return;
        }

        const identity = participant?.identity ?? "unknown";
        for (const handler of handlers) {
          handler(roomName, parsed, identity);
        }
      },
    );

    // Detect unexpected disconnects (network glitch, server restart, etc.)
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (!this.rooms.has(roomName)) return; // intentional leaveRoom() already cleaned up
      this.rooms.delete(roomName);
      for (const handler of this.disconnectHandlers) {
        handler(roomName, reason ?? DisconnectReason.UNKNOWN_REASON);
      }
    });

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

    // Delete before disconnect so the Disconnected handler (skip logic) knows
    // this was intentional and doesn't trigger reconnect.
    this.rooms.delete(roomName);
    await conn.room.disconnect();
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
   * Convenience wrapper for `sendToRoomOnTopic(roomName, "relay", msg)`.
   * Throws if not currently in the specified room.
   */
  async sendToRoom(roomName: string, msg: object): Promise<void> {
    return this.sendToRoomOnTopic(roomName, "relay", msg);
  }

  /** Timeout for publishData calls — prevents FFI hangs from blocking the send queue. */
  static readonly PUBLISH_TIMEOUT_MS = 5_000;

  /**
   * Publish a JSON message to a room's data channel on the specified topic.
   * Throws if not currently in the specified room or if publishData times out.
   */
  async sendToRoomOnTopic(roomName: string, topic: string, msg: object): Promise<void> {
    const conn = this.rooms.get(roomName);
    if (!conn) {
      throw new Error(`Not connected to room: ${roomName}`);
    }

    const data = Buffer.from(JSON.stringify(msg));

    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([
      conn.room.localParticipant!.publishData(data, {
        reliable: true,
        topic,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(
            `publishData timed out after ${RoomManager.PUBLISH_TIMEOUT_MS}ms (room: ${roomName}, topic: ${topic})`,
          )),
          RoomManager.PUBLISH_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timer!));

    conn.lastActivity = Date.now();
  }

  /**
   * Register a handler that is invoked whenever a data message on the given
   * topic arrives in any joined room.
   */
  onDataReceived(topic: string, handler: DataHandler): void {
    const handlers = this.topicHandlers.get(topic);
    if (handlers) {
      handlers.push(handler);
    } else {
      this.topicHandlers.set(topic, [handler]);
    }
  }

  /**
   * Register a handler invoked when the relay is unexpectedly disconnected
   * from a room (network glitch, server restart, etc.).
   * Not called for intentional `leaveRoom()` / `disconnectAll()`.
   */
  onRoomDisconnected(handler: DisconnectHandler): void {
    this.disconnectHandlers.push(handler);
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
