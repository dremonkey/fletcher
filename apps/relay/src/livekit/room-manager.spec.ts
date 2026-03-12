import { describe, test, expect, mock, beforeEach } from "bun:test";
import { RoomManager } from "./room-manager";
import type { RoomConnection, RoomManagerOptions } from "./room-manager";
import { RoomEvent } from "@livekit/rtc-node";

// ---------------------------------------------------------------------------
// Mock Room
// ---------------------------------------------------------------------------

/**
 * Minimal mock that satisfies the Room interface as used by RoomManager.
 * Stores event listeners so tests can simulate incoming data events.
 */
function createMockRoom() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  const publishDataMock = mock(async () => {});
  const connectMock = mock(async () => {});
  const disconnectMock = mock(async () => {});

  const room = {
    connect: connectMock,
    disconnect: disconnectMock,

    on(event: string, handler: (...args: unknown[]) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
      return room; // chainable
    },

    localParticipant: {
      publishData: publishDataMock,
    },

    // Test helper: fire a stored event
    _emit(event: string, ...args: unknown[]) {
      const handlers = listeners.get(event) ?? [];
      for (const h of handlers) {
        h(...args);
      }
    },

    // Test helper: access mocks
    _mocks: {
      connect: connectMock,
      disconnect: disconnectMock,
      publishData: publishDataMock,
    },
  };

  return room;
}

type MockRoom = ReturnType<typeof createMockRoom>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOptions(overrides?: Partial<RoomManagerOptions>): RoomManagerOptions {
  return {
    livekitUrl: "ws://localhost:7880",
    apiKey: "devkey",
    apiSecret: "secret",
    ...overrides,
  };
}

/** Create a RoomManager with a mock room factory that returns `mockRoom`. */
function createTestManager(mockRoom: MockRoom) {
  return new RoomManager(
    makeOptions({
      roomFactory: () => mockRoom as never,
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RoomManager", () => {
  let mockRoom: MockRoom;
  let manager: RoomManager;

  beforeEach(() => {
    mockRoom = createMockRoom();
    manager = createTestManager(mockRoom);
  });

  // -----------------------------------------------------------------------
  // joinRoom
  // -----------------------------------------------------------------------

  test("joinRoom creates and tracks a room connection", async () => {
    const conn = await manager.joinRoom("test-room");

    expect(conn.roomName).toBe("test-room");
    expect(conn.room).toBe(mockRoom as never);
    expect(conn.joinedAt).toBeGreaterThan(0);
    expect(conn.lastActivity).toBe(conn.joinedAt);
    expect(mockRoom._mocks.connect).toHaveBeenCalledTimes(1);
  });

  test("joinRoom is idempotent — joining same room twice returns same connection", async () => {
    const conn1 = await manager.joinRoom("test-room");
    const conn2 = await manager.joinRoom("test-room");

    expect(conn1).toBe(conn2);
    // connect() should only be called once
    expect(mockRoom._mocks.connect).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // leaveRoom
  // -----------------------------------------------------------------------

  test("leaveRoom disconnects and removes the room", async () => {
    await manager.joinRoom("test-room");
    expect(manager.getRoom("test-room")).toBeDefined();

    await manager.leaveRoom("test-room");

    expect(manager.getRoom("test-room")).toBeUndefined();
    expect(mockRoom._mocks.disconnect).toHaveBeenCalledTimes(1);
  });

  test("leaveRoom is a no-op for unknown rooms", async () => {
    // Should not throw
    await manager.leaveRoom("nonexistent");
  });

  // -----------------------------------------------------------------------
  // getRoom
  // -----------------------------------------------------------------------

  test("getRoom returns correct connection or undefined", async () => {
    expect(manager.getRoom("nope")).toBeUndefined();

    await manager.joinRoom("alpha");
    const conn = manager.getRoom("alpha");
    expect(conn).toBeDefined();
    expect(conn!.roomName).toBe("alpha");
  });

  // -----------------------------------------------------------------------
  // getActiveRooms
  // -----------------------------------------------------------------------

  test("getActiveRooms returns all tracked rooms", async () => {
    expect(manager.getActiveRooms()).toHaveLength(0);

    // Each call to joinRoom for a new room name needs a fresh mock
    const mockA = createMockRoom();
    const mockB = createMockRoom();
    let callCount = 0;
    const multiManager = new RoomManager(
      makeOptions({
        roomFactory: () => {
          callCount++;
          return (callCount === 1 ? mockA : mockB) as never;
        },
      }),
    );

    await multiManager.joinRoom("room-a");
    await multiManager.joinRoom("room-b");

    const rooms = multiManager.getActiveRooms();
    expect(rooms).toHaveLength(2);

    const names = rooms.map((r) => r.roomName).sort();
    expect(names).toEqual(["room-a", "room-b"]);
  });

  // -----------------------------------------------------------------------
  // sendToRoom
  // -----------------------------------------------------------------------

  test("sendToRoom calls publishData with correct params", async () => {
    await manager.joinRoom("test-room");

    const payload = { type: "hello", data: 42 };
    await manager.sendToRoom("test-room", payload);

    expect(mockRoom._mocks.publishData).toHaveBeenCalledTimes(1);

    const [data, opts] = mockRoom._mocks.publishData.mock.calls[0] as unknown as [
      Buffer,
      { reliable: boolean; topic: string },
    ];
    expect(JSON.parse(data.toString("utf-8"))).toEqual(payload);
    expect(opts.reliable).toBe(true);
    expect(opts.topic).toBe("relay");
  });

  test("sendToRoom throws for unknown room", async () => {
    await expect(
      manager.sendToRoom("nonexistent", { x: 1 }),
    ).rejects.toThrow("Not connected to room: nonexistent");
  });

  test("sendToRoom updates lastActivity", async () => {
    const conn = await manager.joinRoom("test-room");
    const before = conn.lastActivity;

    // Small delay to ensure timestamp changes
    await new Promise((r) => setTimeout(r, 5));
    await manager.sendToRoom("test-room", { ping: true });

    expect(conn.lastActivity).toBeGreaterThanOrEqual(before);
  });

  // -----------------------------------------------------------------------
  // onDataReceived
  // -----------------------------------------------------------------------

  test("onDataReceived handler fires for relay topic", async () => {
    const received: { room: string; data: unknown; identity: string }[] = [];

    manager.onDataReceived((room, data, identity) => {
      received.push({ room, data, identity });
    });

    await manager.joinRoom("test-room");

    // Simulate a DataReceived event on the "relay" topic
    const payload = new TextEncoder().encode(JSON.stringify({ msg: "hi" }));
    const participant = { identity: "mobile-user" };

    mockRoom._emit(
      RoomEvent.DataReceived,
      payload,
      participant,
      undefined, // kind
      "relay",   // topic
    );

    expect(received).toHaveLength(1);
    expect(received[0].room).toBe("test-room");
    expect(received[0].data).toEqual({ msg: "hi" });
    expect(received[0].identity).toBe("mobile-user");
  });

  test("onDataReceived ignores non-relay topics", async () => {
    const received: unknown[] = [];

    manager.onDataReceived((_room, data) => {
      received.push(data);
    });

    await manager.joinRoom("test-room");

    const payload = new TextEncoder().encode(JSON.stringify({ msg: "hi" }));
    mockRoom._emit(
      RoomEvent.DataReceived,
      payload,
      { identity: "someone" },
      undefined,
      "other-topic",
    );

    expect(received).toHaveLength(0);
  });

  test("onDataReceived ignores malformed JSON", async () => {
    const received: unknown[] = [];

    manager.onDataReceived((_room, data) => {
      received.push(data);
    });

    await manager.joinRoom("test-room");

    const badPayload = new TextEncoder().encode("not valid json {{{");
    mockRoom._emit(
      RoomEvent.DataReceived,
      badPayload,
      { identity: "someone" },
      undefined,
      "relay",
    );

    expect(received).toHaveLength(0);
  });

  test("onDataReceived uses 'unknown' when participant is undefined", async () => {
    const received: { identity: string }[] = [];

    manager.onDataReceived((_room, _data, identity) => {
      received.push({ identity });
    });

    await manager.joinRoom("test-room");

    const payload = new TextEncoder().encode(JSON.stringify({ x: 1 }));
    mockRoom._emit(
      RoomEvent.DataReceived,
      payload,
      undefined, // no participant
      undefined,
      "relay",
    );

    expect(received).toHaveLength(1);
    expect(received[0].identity).toBe("unknown");
  });

  // -----------------------------------------------------------------------
  // disconnectAll
  // -----------------------------------------------------------------------

  test("disconnectAll disconnects and clears all rooms", async () => {
    const mockA = createMockRoom();
    const mockB = createMockRoom();
    let callCount = 0;
    const multiManager = new RoomManager(
      makeOptions({
        roomFactory: () => {
          callCount++;
          return (callCount === 1 ? mockA : mockB) as never;
        },
      }),
    );

    await multiManager.joinRoom("room-a");
    await multiManager.joinRoom("room-b");
    expect(multiManager.getActiveRooms()).toHaveLength(2);

    await multiManager.disconnectAll();

    expect(multiManager.getActiveRooms()).toHaveLength(0);
    expect(mockA._mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mockB._mocks.disconnect).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // touchRoom
  // -----------------------------------------------------------------------

  test("touchRoom updates lastActivity timestamp", async () => {
    const conn = await manager.joinRoom("test-room");
    const before = conn.lastActivity;

    // Small delay so timestamp differs
    await new Promise((r) => setTimeout(r, 5));
    manager.touchRoom("test-room");

    expect(conn.lastActivity).toBeGreaterThan(before);
  });

  test("touchRoom is a no-op for unknown rooms", () => {
    // Should not throw
    manager.touchRoom("nonexistent");
  });
});
