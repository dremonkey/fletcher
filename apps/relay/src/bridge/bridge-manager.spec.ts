import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "path";
import { BridgeManager } from "./bridge-manager";
import type { RoomManager, RoomConnection, DataHandler, DisconnectHandler } from "../livekit/room-manager";

// ---------------------------------------------------------------------------
// Mock RoomManager
// ---------------------------------------------------------------------------

function createMockRoomManager() {
  const topicHandlers = new Map<string, DataHandler[]>();
  const disconnectHandlers: DisconnectHandler[] = [];

  return {
    topicHandlers,
    disconnectHandlers,
    onDataReceived: (topic: string, handler: DataHandler) => {
      const handlers = topicHandlers.get(topic);
      if (handlers) {
        handlers.push(handler);
      } else {
        topicHandlers.set(topic, [handler]);
      }
    },
    onRoomDisconnected: (handler: DisconnectHandler) => {
      disconnectHandlers.push(handler);
    },
    /** Test helper: simulate an unexpected disconnect event */
    _emitDisconnect: (roomName: string, reason: number = 0) => {
      for (const handler of disconnectHandlers) {
        handler(roomName, reason as any);
      }
    },
    /** Test helper: simulate a data channel message arriving on a given topic */
    simulateData: function(roomName: string, data: unknown, identity: string, topic = "relay") {
      const handlers = topicHandlers.get(topic) ?? [];
      for (const handler of handlers) {
        handler(roomName, data, identity);
      }
    },
    sendToRoom: mock(async (_roomName: string, _msg: object) => {}),
    joinRoom: mock(async (roomName: string) => ({
      room: {},
      roomName,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
    })),
    leaveRoom: mock(async (_roomName: string) => {}),
    disconnectAll: mock(async () => {}),
    getRoom: mock((_roomName: string) => undefined),
    getActiveRooms: mock((): RoomConnection[] => []),
    touchRoom: mock((_roomName: string) => {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_ACPX_PATH = path.resolve(
  import.meta.dir,
  "../../../../packages/acp-client/test/mock-acpx.ts",
);

/** Wait briefly for async handlers to flush. */
function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simulate the full addRoom + session/bind handshake.
 * This is the normal happy path that all tests requiring a live bridge should use.
 */
async function addRoomAndBind(
  manager: BridgeManager,
  mockRm: ReturnType<typeof createMockRoomManager>,
  roomName: string,
  sessionKey = `agent:main:relay:${roomName}`,
): Promise<void> {
  await manager.addRoom(roomName);
  // Send session/bind on the "relay" topic
  mockRm.simulateData(
    roomName,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "session/bind",
      params: { sessionKey },
    },
    "mobile-user",
  );
  // Wait for async bridge creation
  await tick(200);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BridgeManager", () => {
  let manager: BridgeManager;
  let mockRm: ReturnType<typeof createMockRoomManager>;

  beforeEach(() => {
    mockRm = createMockRoomManager();
  });

  afterEach(async () => {
    try {
      manager?.stopIdleTimer();
      manager?.stopDiscoveryTimer();
      await manager?.shutdownAll();
    } catch {
      // already shut down
    }
  });

  test("addRoom() joins room and enters pending-bind state", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await manager.addRoom("room-alpha");

    expect(mockRm.joinRoom).toHaveBeenCalledWith("room-alpha");
    // No bridge yet — pending bind
    expect(manager.getBridge("room-alpha")).toBeUndefined();
    // But hasRoom returns true (pending counts)
    expect(manager.hasRoom("room-alpha")).toBe(true);
  });

  test("addRoom() + session/bind creates a bridge with correct sessionKey", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await addRoomAndBind(manager, mockRm, "room-alpha");

    expect(mockRm.joinRoom).toHaveBeenCalledWith("room-alpha");
    expect(manager.getBridge("room-alpha")).toBeDefined();
    expect(manager.getBridge("room-alpha")!.isStarted).toBe(true);
    expect(manager.getActiveRooms()).toEqual(["room-alpha"]);
  });

  test("addRoom() is idempotent for pending-bind state", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await manager.addRoom("room-beta");
    await manager.addRoom("room-beta");

    // Should only have joined once
    expect(mockRm.joinRoom.mock.calls.length).toBe(1);
  });

  test("addRoom() is idempotent after bind completes", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await addRoomAndBind(manager, mockRm, "room-beta");
    await manager.addRoom("room-beta"); // second call should be no-op

    // Should only have joined once
    expect(mockRm.joinRoom.mock.calls.length).toBe(1);
    expect(manager.getActiveRooms()).toEqual(["room-beta"]);
  });

  test("removeRoom() stops bridge and leaves room", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await addRoomAndBind(manager, mockRm, "room-gamma");
    expect(manager.getBridge("room-gamma")!.isStarted).toBe(true);

    await manager.removeRoom("room-gamma");

    expect(manager.getBridge("room-gamma")).toBeUndefined();
    expect(mockRm.leaveRoom).toHaveBeenCalledWith("room-gamma");
    expect(manager.getActiveRooms()).toEqual([]);
  });

  test("removeRoom() is a no-op for unknown rooms", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    // Should not throw
    await manager.removeRoom("nonexistent");
    expect(mockRm.leaveRoom).not.toHaveBeenCalled();
  });

  test("getActiveRooms() lists all rooms with bridges", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await addRoomAndBind(manager, mockRm, "room-1");
    await addRoomAndBind(manager, mockRm, "room-2");
    await addRoomAndBind(manager, mockRm, "room-3");

    const rooms = manager.getActiveRooms();
    expect(rooms).toContain("room-1");
    expect(rooms).toContain("room-2");
    expect(rooms).toContain("room-3");
    expect(rooms.length).toBe(3);
  });

  test("shutdownAll() stops all bridges and disconnects", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await addRoomAndBind(manager, mockRm, "room-x");
    await addRoomAndBind(manager, mockRm, "room-y");

    await manager.shutdownAll();

    expect(manager.getActiveRooms()).toEqual([]);
    expect(mockRm.disconnectAll).toHaveBeenCalled();
  });

  test("hasRoom() returns true for existing rooms, false otherwise", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    expect(manager.hasRoom("room-nope")).toBe(false);

    await addRoomAndBind(manager, mockRm, "room-nope");
    expect(manager.hasRoom("room-nope")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Idle timeout
  // -------------------------------------------------------------------------

  test("checkIdleRooms() removes rooms that exceeded the timeout", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await addRoomAndBind(manager, mockRm, "room-idle");

    // Simulate an idle room by making getActiveRooms return a connection
    // with lastActivity in the past
    mockRm.getActiveRooms.mockImplementation((): RoomConnection[] => [
      {
        room: {} as any,
        roomName: "room-idle",
        joinedAt: Date.now() - 600_000,
        lastActivity: Date.now() - 600_000, // 10 minutes ago
      },
    ]);

    expect(manager.hasRoom("room-idle")).toBe(true);

    await manager.checkIdleRooms(300_000); // 5-minute timeout

    expect(manager.hasRoom("room-idle")).toBe(false);
    expect(mockRm.leaveRoom).toHaveBeenCalledWith("room-idle");
  });

  test("checkIdleRooms() does not remove active rooms", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await addRoomAndBind(manager, mockRm, "room-active");

    // Room has recent activity
    mockRm.getActiveRooms.mockImplementation((): RoomConnection[] => [
      {
        room: {} as any,
        roomName: "room-active",
        joinedAt: Date.now(),
        lastActivity: Date.now(), // just now
      },
    ]);

    await manager.checkIdleRooms(300_000); // 5-minute timeout

    expect(manager.hasRoom("room-active")).toBe(true);
    expect(mockRm.leaveRoom).not.toHaveBeenCalled();
  });

  test("direct removeRoom() clears room", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await addRoomAndBind(manager, mockRm, "room-direct");

    await manager.removeRoom("room-direct");

    expect(manager.hasRoom("room-direct")).toBe(false);
  });

  test("stopIdleTimer() prevents idle removal", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await addRoomAndBind(manager, mockRm, "room-timer");

    // Start and immediately stop
    manager.startIdleTimer(100, 50);
    manager.stopIdleTimer();

    // Simulate idle room
    mockRm.getActiveRooms.mockImplementation((): RoomConnection[] => [
      {
        room: {} as any,
        roomName: "room-timer",
        joinedAt: 0,
        lastActivity: 0,
      },
    ]);

    // Wait longer than the interval would have fired
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Room should still be there because timer was stopped
    expect(manager.hasRoom("room-timer")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Disconnect recovery
  // -------------------------------------------------------------------------

  test("auto-rejoins room after unexpected disconnect", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
      undefined,
      { rejoinBaseDelayMs: 50 },
    );

    await addRoomAndBind(manager, mockRm, "room-dc");
    expect(manager.hasRoom("room-dc")).toBe(true);

    // Simulate unexpected disconnect — bridge should be cleaned up
    mockRm._emitDisconnect("room-dc");
    expect(manager.hasRoom("room-dc")).toBe(false);

    // Wait for backoff timer to fire and rejoin (into pending-bind state)
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(manager.hasRoom("room-dc")).toBe(true);
    // joinRoom called: once for initial addRoom, once for rejoin
    expect(mockRm.joinRoom.mock.calls.length).toBe(2);
  });

  test("retries with exponential backoff on failure", async () => {
    let joinCallCount = 0;
    mockRm.joinRoom.mockImplementation(async (roomName: string) => {
      joinCallCount++;
      if (joinCallCount <= 2) {
        // First two calls succeed (initial add + first rejoin attempt fails)
        if (joinCallCount === 2) throw new Error("connection refused");
      }
      return {
        room: {},
        roomName,
        joinedAt: Date.now(),
        lastActivity: Date.now(),
      } as any;
    });

    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
      undefined,
      { rejoinBaseDelayMs: 30, rejoinMaxRetries: 3 },
    );

    await manager.addRoom("room-retry");
    expect(joinCallCount).toBe(1);

    // Simulate disconnect
    mockRm._emitDisconnect("room-retry");

    // Wait long enough for multiple retries (30ms + 60ms + 120ms)
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Should have retried: call 2 fails, call 3 succeeds
    expect(joinCallCount).toBeGreaterThanOrEqual(3);
    expect(manager.hasRoom("room-retry")).toBe(true);
  });

  test("gives up after max retries exhausted", async () => {
    let joinCallCount = 0;
    mockRm.joinRoom.mockImplementation(async (roomName: string) => {
      joinCallCount++;
      if (joinCallCount === 1) {
        // Initial addRoom succeeds
        return {
          room: {},
          roomName,
          joinedAt: Date.now(),
          lastActivity: Date.now(),
        } as any;
      }
      // All rejoin attempts fail
      throw new Error("connection refused");
    });

    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
      undefined,
      { rejoinBaseDelayMs: 20, rejoinMaxRetries: 2 },
    );

    await manager.addRoom("room-giveup");
    expect(joinCallCount).toBe(1);

    mockRm._emitDisconnect("room-giveup");

    // Wait for all retries to exhaust (20ms + 40ms + margin)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should have tried twice and given up
    expect(joinCallCount).toBe(3); // 1 initial + 2 retries
    expect(manager.hasRoom("room-giveup")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Periodic room discovery
  // -------------------------------------------------------------------------

  test("startDiscoveryTimer calls function periodically", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    let callCount = 0;
    const discoveryFn = async () => { callCount++; };

    manager.startDiscoveryTimer(discoveryFn, 50);

    await new Promise((resolve) => setTimeout(resolve, 175));

    // Should have been called ~3 times (50ms, 100ms, 150ms)
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(callCount).toBeLessThanOrEqual(4);
  });

  test("stopDiscoveryTimer stops calls", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    let callCount = 0;
    const discoveryFn = async () => { callCount++; };

    manager.startDiscoveryTimer(discoveryFn, 50);

    await new Promise((resolve) => setTimeout(resolve, 75));
    manager.stopDiscoveryTimer();
    const countAfterStop = callCount;

    await new Promise((resolve) => setTimeout(resolve, 150));

    // No more calls after stopping
    expect(callCount).toBe(countAfterStop);
  });

  // -------------------------------------------------------------------------
  // session/bind protocol
  // -------------------------------------------------------------------------

  describe("session/bind", () => {
    test("session/bind creates bridge with client-specified sessionKey", async () => {
      manager = new BridgeManager(
        mockRm as unknown as RoomManager,
        "bun",
        [MOCK_ACPX_PATH],
      );

      await manager.addRoom("room-bind");

      // No bridge yet — pending bind
      expect(manager.getBridge("room-bind")).toBeUndefined();

      // Send session/bind
      mockRm.simulateData(
        "room-bind",
        {
          jsonrpc: "2.0",
          id: 42,
          method: "session/bind",
          params: { sessionKey: "user:alice:session:abc123" },
        },
        "mobile-user",
      );

      // Wait for async bridge creation
      await tick(200);

      expect(manager.getBridge("room-bind")).toBeDefined();
      expect(manager.getBridge("room-bind")!.isStarted).toBe(true);
    });

    test("session/bind responds with bound:true and the sessionKey", async () => {
      manager = new BridgeManager(
        mockRm as unknown as RoomManager,
        "bun",
        [MOCK_ACPX_PATH],
      );

      await manager.addRoom("room-bind-resp");

      mockRm.simulateData(
        "room-bind-resp",
        {
          jsonrpc: "2.0",
          id: 7,
          method: "session/bind",
          params: { sessionKey: "user:bob:session:xyz" },
        },
        "mobile-user",
      );

      await tick(200);

      // Find the bind response
      const calls = mockRm.sendToRoom.mock.calls;
      const bindResponses = calls.filter((c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.id === 7 && "result" in msg;
      });

      expect(bindResponses.length).toBe(1);
      const [roomName, response] = bindResponses[0] as [string, Record<string, unknown>];
      expect(roomName).toBe("room-bind-resp");
      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe(7);
      const result = response.result as Record<string, unknown>;
      expect(result.bound).toBe(true);
      expect(result.sessionKey).toBe("user:bob:session:xyz");
    });

    test("session/bind with missing sessionKey returns error", async () => {
      manager = new BridgeManager(
        mockRm as unknown as RoomManager,
        "bun",
        [MOCK_ACPX_PATH],
      );

      await manager.addRoom("room-bad-bind");

      // Send bind with no sessionKey
      mockRm.simulateData(
        "room-bad-bind",
        {
          jsonrpc: "2.0",
          id: 99,
          method: "session/bind",
          params: {},
        },
        "mobile-user",
      );

      await tick(100);

      // Should get an error response
      const calls = mockRm.sendToRoom.mock.calls;
      const errorResponses = calls.filter((c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.id === 99 && "error" in msg;
      });

      expect(errorResponses.length).toBe(1);
      const [, errMsg] = errorResponses[0] as [string, Record<string, unknown>];
      expect(errMsg.jsonrpc).toBe("2.0");
      const err = errMsg.error as Record<string, unknown>;
      expect(err.code).toBe(-32602);

      // Room should still be in pending state (no bridge created)
      expect(manager.getBridge("room-bad-bind")).toBeUndefined();
      // Room remains pending (hasn't been cleaned up)
      expect(manager.hasRoom("room-bad-bind")).toBe(true);
    });

    test("bind timeout cleans up room after configured timeout", async () => {
      manager = new BridgeManager(
        mockRm as unknown as RoomManager,
        "bun",
        [MOCK_ACPX_PATH],
        undefined,
        { bindTimeoutMs: 100 }, // short timeout for testing
      );

      await manager.addRoom("room-timeout");
      expect(manager.hasRoom("room-timeout")).toBe(true);

      // Wait past the bind timeout
      await tick(200);

      // Room should have been cleaned up
      expect(manager.hasRoom("room-timeout")).toBe(false);
      expect(mockRm.leaveRoom).toHaveBeenCalledWith("room-timeout");
    });

    test("bind timeout does NOT fire if bind arrives in time", async () => {
      manager = new BridgeManager(
        mockRm as unknown as RoomManager,
        "bun",
        [MOCK_ACPX_PATH],
        undefined,
        { bindTimeoutMs: 200 }, // 200ms timeout
      );

      await manager.addRoom("room-timely-bind");

      // Send bind before timeout
      mockRm.simulateData(
        "room-timely-bind",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "session/bind",
          params: { sessionKey: "agent:main:relay:room-timely-bind" },
        },
        "mobile-user",
      );

      await tick(100); // wait for bind to process

      // Advance past what would have been the timeout
      await tick(300);

      // Room should still exist (bind arrived in time)
      expect(manager.hasRoom("room-timely-bind")).toBe(true);
      expect(manager.getBridge("room-timely-bind")).toBeDefined();
      // leaveRoom should NOT have been called
      expect(mockRm.leaveRoom).not.toHaveBeenCalled();
    });

    test("duplicate session/bind is idempotent — second bind returns success", async () => {
      manager = new BridgeManager(
        mockRm as unknown as RoomManager,
        "bun",
        [MOCK_ACPX_PATH],
      );

      await addRoomAndBind(manager, mockRm, "room-dup-bind", "key:v1");

      // Verify bridge exists
      expect(manager.getBridge("room-dup-bind")).toBeDefined();
      const firstBridge = manager.getBridge("room-dup-bind");

      // Send a second bind
      mockRm.simulateData(
        "room-dup-bind",
        {
          jsonrpc: "2.0",
          id: 55,
          method: "session/bind",
          params: { sessionKey: "key:v1" },
        },
        "mobile-user",
      );

      await tick(100);

      // Should still have exactly one bridge (the original)
      expect(manager.getBridge("room-dup-bind")).toBe(firstBridge);

      // Should have gotten a success response for the second bind
      const calls = mockRm.sendToRoom.mock.calls;
      const secondBindResp = calls.filter((c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.id === 55 && "result" in msg;
      });
      expect(secondBindResp.length).toBe(1);
      const result = (secondBindResp[0][1] as any).result;
      expect(result.bound).toBe(true);
    });

    test("removeRoom() cleans up pending bind and cancels timer", async () => {
      manager = new BridgeManager(
        mockRm as unknown as RoomManager,
        "bun",
        [MOCK_ACPX_PATH],
        undefined,
        { bindTimeoutMs: 5_000 }, // long timeout — we remove before it fires
      );

      await manager.addRoom("room-remove-pending");
      expect(manager.hasRoom("room-remove-pending")).toBe(true);

      // Remove before bind arrives
      await manager.removeRoom("room-remove-pending");

      expect(manager.hasRoom("room-remove-pending")).toBe(false);
      expect(mockRm.leaveRoom).toHaveBeenCalledWith("room-remove-pending");
    });

    test("hasRoom() returns true for pending-bind rooms", async () => {
      manager = new BridgeManager(
        mockRm as unknown as RoomManager,
        "bun",
        [MOCK_ACPX_PATH],
        undefined,
        { bindTimeoutMs: 5_000 }, // won't fire during test
      );

      await manager.addRoom("room-pending");

      // No bind sent yet — still pending
      expect(manager.getBridge("room-pending")).toBeUndefined();
      expect(manager.hasRoom("room-pending")).toBe(true);
    });

    test("addRoom() idempotent when already in pending-bind state", async () => {
      manager = new BridgeManager(
        mockRm as unknown as RoomManager,
        "bun",
        [MOCK_ACPX_PATH],
        undefined,
        { bindTimeoutMs: 5_000 },
      );

      await manager.addRoom("room-idem-pending");
      await manager.addRoom("room-idem-pending"); // second call — no-op

      // Should have joined only once
      expect(mockRm.joinRoom.mock.calls.length).toBe(1);
    });

    test("prompt before bind — message arrives after bind (bridge handles it)", async () => {
      // session/prompt arriving before bind: there's no bridge yet, so the
      // BridgeManager's global relay handler sees it but has no matching
      // pending bind handler for session/prompt — it falls through to
      // RelayBridge once bind creates one.
      // This test verifies that a prompt sent AFTER bind completes still works.
      manager = new BridgeManager(
        mockRm as unknown as RoomManager,
        "bun",
        [MOCK_ACPX_PATH],
      );

      await addRoomAndBind(manager, mockRm, "room-prompt-after-bind");

      // Send prompt after bind
      mockRm.simulateData(
        "room-prompt-after-bind",
        {
          jsonrpc: "2.0",
          id: 200,
          method: "session/prompt",
          params: { prompt: [{ type: "text", text: "Hello" }] },
        },
        "mobile-user",
      );

      await tick(300);

      // Should have received a prompt response
      const calls = mockRm.sendToRoom.mock.calls;
      const promptResponses = calls.filter((c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.id === 200 && "result" in msg;
      });
      expect(promptResponses.length).toBe(1);
    });
  });
});
