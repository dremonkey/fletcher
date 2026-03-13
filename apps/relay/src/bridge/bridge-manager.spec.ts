import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "path";
import { BridgeManager } from "./bridge-manager";
import type { RoomManager, RoomConnection, DataHandler, DisconnectHandler } from "../livekit/room-manager";

// ---------------------------------------------------------------------------
// Mock RoomManager
// ---------------------------------------------------------------------------

function createMockRoomManager() {
  const dataHandlers: DataHandler[] = [];
  const disconnectHandlers: DisconnectHandler[] = [];

  return {
    dataHandlers,
    disconnectHandlers,
    onDataReceived: (handler: DataHandler) => {
      dataHandlers.push(handler);
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

  test("addRoom() creates a bridge and joins room", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await manager.addRoom("room-alpha");

    expect(mockRm.joinRoom).toHaveBeenCalledWith("room-alpha");
    expect(manager.getBridge("room-alpha")).toBeDefined();
    expect(manager.getBridge("room-alpha")!.isStarted).toBe(true);
    expect(manager.getActiveRooms()).toEqual(["room-alpha"]);
  });

  test("addRoom() is idempotent", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await manager.addRoom("room-beta");
    await manager.addRoom("room-beta");

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

    await manager.addRoom("room-gamma");
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

    await manager.addRoom("room-1");
    await manager.addRoom("room-2");
    await manager.addRoom("room-3");

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

    await manager.addRoom("room-x");
    await manager.addRoom("room-y");

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

    await manager.addRoom("room-nope");
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

    await manager.addRoom("room-idle");

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

    await manager.addRoom("room-active");

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

  // -------------------------------------------------------------------------
  // Deferred teardown (departure grace period)
  // -------------------------------------------------------------------------

  test("scheduleRemoveRoom() does not remove bridge immediately", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
      undefined,
      { departureGraceMs: 500 },
    );

    await manager.addRoom("room-grace");
    expect(manager.hasRoom("room-grace")).toBe(true);

    manager.scheduleRemoveRoom("room-grace");

    // Bridge should still be alive immediately after scheduling
    expect(manager.hasRoom("room-grace")).toBe(true);
    expect(manager.hasPendingTeardown("room-grace")).toBe(true);
    expect(manager.getPendingTeardowns()).toEqual(["room-grace"]);
  });

  test("scheduleRemoveRoom() removes bridge after grace period expires", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
      undefined,
      { departureGraceMs: 100 },
    );

    await manager.addRoom("room-expire");
    manager.scheduleRemoveRoom("room-expire");

    // Wait for grace period to expire
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(manager.hasRoom("room-expire")).toBe(false);
    expect(manager.hasPendingTeardown("room-expire")).toBe(false);
    expect(mockRm.leaveRoom).toHaveBeenCalledWith("room-expire");
  });

  test("cancelPendingTeardown() prevents the deferred removal", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
      undefined,
      { departureGraceMs: 100 },
    );

    await manager.addRoom("room-cancel");
    manager.scheduleRemoveRoom("room-cancel");
    expect(manager.hasPendingTeardown("room-cancel")).toBe(true);

    const cancelled = manager.cancelPendingTeardown("room-cancel");
    expect(cancelled).toBe(true);
    expect(manager.hasPendingTeardown("room-cancel")).toBe(false);

    // Wait past grace period — bridge should still be alive
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(manager.hasRoom("room-cancel")).toBe(true);
  });

  test("duplicate scheduleRemoveRoom() is a no-op", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
      undefined,
      { departureGraceMs: 500 },
    );

    await manager.addRoom("room-dup");
    manager.scheduleRemoveRoom("room-dup");
    manager.scheduleRemoveRoom("room-dup");

    // Only one pending teardown
    expect(manager.getPendingTeardowns()).toEqual(["room-dup"]);
  });

  test("direct removeRoom() clears pending teardown", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
      undefined,
      { departureGraceMs: 500 },
    );

    await manager.addRoom("room-direct");
    manager.scheduleRemoveRoom("room-direct");
    expect(manager.hasPendingTeardown("room-direct")).toBe(true);

    await manager.removeRoom("room-direct");

    expect(manager.hasRoom("room-direct")).toBe(false);
    expect(manager.hasPendingTeardown("room-direct")).toBe(false);
  });

  test("shutdownAll() clears all pending teardowns", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
      undefined,
      { departureGraceMs: 500 },
    );

    await manager.addRoom("room-sd1");
    await manager.addRoom("room-sd2");
    manager.scheduleRemoveRoom("room-sd1");
    manager.scheduleRemoveRoom("room-sd2");

    expect(manager.getPendingTeardowns().length).toBe(2);

    await manager.shutdownAll();

    expect(manager.getPendingTeardowns()).toEqual([]);
    expect(manager.getActiveRooms()).toEqual([]);
  });

  test("stopIdleTimer() prevents idle removal", async () => {
    manager = new BridgeManager(
      mockRm as unknown as RoomManager,
      "bun",
      [MOCK_ACPX_PATH],
    );

    await manager.addRoom("room-timer");

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

    await manager.addRoom("room-dc");
    expect(manager.hasRoom("room-dc")).toBe(true);

    // Simulate unexpected disconnect — bridge should be cleaned up
    mockRm._emitDisconnect("room-dc");
    expect(manager.hasRoom("room-dc")).toBe(false);

    // Wait for backoff timer to fire and rejoin
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
});
