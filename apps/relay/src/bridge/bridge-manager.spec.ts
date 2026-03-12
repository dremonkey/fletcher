import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "path";
import { BridgeManager } from "./bridge-manager";
import type { RoomManager, RoomConnection, DataHandler } from "../livekit/room-manager";

// ---------------------------------------------------------------------------
// Mock RoomManager
// ---------------------------------------------------------------------------

function createMockRoomManager() {
  const dataHandlers: DataHandler[] = [];

  return {
    dataHandlers,
    onDataReceived: (handler: DataHandler) => {
      dataHandlers.push(handler);
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
  "../../test/mock-acpx.ts",
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
});
