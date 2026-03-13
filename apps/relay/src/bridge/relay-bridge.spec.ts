import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "path";
import { RelayBridge } from "./relay-bridge";
import type { RoomManager, DataHandler } from "../livekit/room-manager";

// ---------------------------------------------------------------------------
// Mock RoomManager
// ---------------------------------------------------------------------------

interface MockRoomManager {
  onDataReceived: (handler: DataHandler) => void;
  sendToRoom: ReturnType<typeof mock>;
  joinRoom: ReturnType<typeof mock>;
  leaveRoom: ReturnType<typeof mock>;
  disconnectAll: ReturnType<typeof mock>;
  getRoom: ReturnType<typeof mock>;
  getActiveRooms: ReturnType<typeof mock>;
  touchRoom: ReturnType<typeof mock>;
  dataHandlers: DataHandler[];
  /** Simulate a mobile message arriving on the data channel. */
  simulateData: (roomName: string, data: unknown, identity: string) => void;
}

function createMockRoomManager(): MockRoomManager {
  const dataHandlers: DataHandler[] = [];

  return {
    dataHandlers,
    onDataReceived: (handler: DataHandler) => {
      dataHandlers.push(handler);
    },
    sendToRoom: mock(async (_roomName: string, _msg: object) => {}),
    joinRoom: mock(async (_roomName: string) => ({
      room: {},
      roomName: _roomName,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
    })),
    leaveRoom: mock(async (_roomName: string) => {}),
    disconnectAll: mock(async () => {}),
    getRoom: mock((_roomName: string) => undefined),
    getActiveRooms: mock(() => []),
    touchRoom: mock((_roomName: string) => {}),
    simulateData(roomName: string, data: unknown, identity: string) {
      for (const handler of dataHandlers) {
        handler(roomName, data, identity);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const MOCK_ACPX_PATH = path.resolve(
  import.meta.dir,
  "../../test/mock-acpx.ts",
);
const ROOM_NAME = "test-room";

function createBridge(mockRm: MockRoomManager): RelayBridge {
  return new RelayBridge({
    roomName: ROOM_NAME,
    roomManager: mockRm as unknown as RoomManager,
    acpCommand: "bun",
    acpArgs: [MOCK_ACPX_PATH],
  });
}

/** Wait briefly for async handlers to flush. */
function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RelayBridge", () => {
  let bridge: RelayBridge;
  let mockRm: MockRoomManager;

  beforeEach(() => {
    mockRm = createMockRoomManager();
  });

  afterEach(async () => {
    try {
      await bridge?.stop();
    } catch {
      // already stopped
    }
  });

  test("start() initializes ACP, creates session, stores sessionId", async () => {
    bridge = createBridge(mockRm);
    expect(bridge.getSessionId()).toBeNull();
    expect(bridge.isStarted).toBe(false);

    await bridge.start();

    expect(bridge.isStarted).toBe(true);
    expect(bridge.getSessionId()).toBe("mock-sess-001");
  });

  test("mobile session/prompt is forwarded to ACP with sessionId injected", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // Simulate mobile sending session/prompt
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "Hello" }],
        },
      },
      "mobile-user",
    );

    // Wait for the async ACP round-trip
    await tick(200);

    // Check that the result was forwarded back to mobile
    expect(mockRm.sendToRoom).toHaveBeenCalled();

    // Find the response call (not the update notification)
    const calls = mockRm.sendToRoom.mock.calls;
    const responseCalls = calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.id === 1 && "result" in msg;
      },
    );
    expect(responseCalls.length).toBe(1);

    const [roomName, response] = responseCalls[0] as [string, Record<string, unknown>];
    expect(roomName).toBe(ROOM_NAME);
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.result).toEqual({ stopReason: "completed" });
  });

  test("ACP session/update notifications are forwarded to mobile", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // Simulate mobile sending session/prompt (which triggers an update from mock-acpx)
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "Test update" }],
        },
      },
      "mobile-user",
    );

    await tick(200);

    // Find the update notification call
    const calls = mockRm.sendToRoom.mock.calls;
    const updateCalls = calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.method === "session/update";
      },
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    const [, notification] = updateCalls[0] as [string, Record<string, unknown>];
    expect(notification.jsonrpc).toBe("2.0");
    expect(notification.method).toBe("session/update");
    const params = notification.params as { updates: { kind: string; content: { text: string } }[] };
    expect(params.updates[0].kind).toBe("content_chunk");
    expect(params.updates[0].content.text).toBe("Echo: Test update");
  });

  test("mobile session/cancel is forwarded to ACP", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // session/cancel is a notification — should not throw
    expect(() => {
      mockRm.simulateData(
        ROOM_NAME,
        {
          jsonrpc: "2.0",
          method: "session/cancel",
          params: { sessionId: bridge.getSessionId() },
        },
        "mobile-user",
      );
    }).not.toThrow();
  });

  test("unknown method is silently ignored", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // Should not throw or send anything back
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 99,
        method: "unknown/method",
        params: {},
      },
      "mobile-user",
    );

    await tick(100);

    // sendToRoom should not have been called for this message
    // (it may have been called for other things like start, but no call with id 99)
    const calls = mockRm.sendToRoom.mock.calls;
    const matchingCalls = calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.id === 99;
      },
    );
    expect(matchingCalls.length).toBe(0);
  });

  test("messages for a different room are ignored", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    mockRm.simulateData(
      "other-room",
      {
        jsonrpc: "2.0",
        id: 10,
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: "Wrong room" }] },
      },
      "mobile-user",
    );

    await tick(100);

    const calls = mockRm.sendToRoom.mock.calls;
    const matchingCalls = calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.id === 10;
      },
    );
    expect(matchingCalls.length).toBe(0);
  });

  test("stop() shuts down the ACP client", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();
    expect(bridge.isStarted).toBe(true);

    await bridge.stop();
    expect(bridge.isStarted).toBe(false);
  });

  test("incoming mobile message resets idle timer via touchRoom()", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 50,
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: "Touch test" }] },
      },
      "mobile-user",
    );

    expect(mockRm.touchRoom).toHaveBeenCalledWith(ROOM_NAME);
  });

  test("non-object data is ignored", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // Should not throw
    expect(() => {
      mockRm.simulateData(ROOM_NAME, "not an object", "mobile-user");
      mockRm.simulateData(ROOM_NAME, null, "mobile-user");
      mockRm.simulateData(ROOM_NAME, 42, "mobile-user");
    }).not.toThrow();
  });
});
