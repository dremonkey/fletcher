import { describe, expect, it, mock } from "bun:test";
import { discoverAndRejoinRooms } from "./room-discovery";
import { PARTICIPANT_KIND_AGENT } from "./participant-filter";

/** Minimal mock logger */
function createMockLogger() {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    child: () => createMockLogger(),
  };
}

/** Minimal mock BridgeManager */
function createMockBridgeManager(existingRooms: string[] = [], blacklistedRooms: string[] = []) {
  const added: string[] = [];
  return {
    hasRoom: (name: string) => existingRooms.includes(name),
    isBindBlacklisted: (name: string) => blacklistedRooms.includes(name),
    addRoom: mock(async (name: string) => {
      added.push(name);
    }),
    _added: added,
  };
}

describe("discoverAndRejoinRooms", () => {
  it("rejoins rooms with human participants and no relay", async () => {
    const roomService = {
      listRooms: mock(async () => [{ name: "room-1" }, { name: "room-2" }]),
      listParticipants: mock(async (room: string) => {
        if (room === "room-1") return [{ identity: "user-a", kind: 0 }];
        return [{ identity: "user-b", kind: 0 }];
      }),
    };
    const bridgeManager = createMockBridgeManager();
    const logger = createMockLogger();

    const result = await discoverAndRejoinRooms({
      roomService: roomService as any,
      bridgeManager: bridgeManager as any,
      logger: logger as any,
    });

    expect(result.roomsChecked).toBe(2);
    expect(result.roomsRejoined).toEqual(["room-1", "room-2"]);
    expect(result.roomsSkipped).toEqual([]);
    expect(result.roomsFailed).toEqual([]);
    expect(bridgeManager.addRoom).toHaveBeenCalledTimes(2);
  });

  it("skips rooms that already have a relay participant", async () => {
    const roomService = {
      listRooms: mock(async () => [{ name: "room-1" }]),
      listParticipants: mock(async () => [
        { identity: "user-a", kind: 0 },
        { identity: "relay-abc", kind: 0 },
      ]),
    };
    const bridgeManager = createMockBridgeManager();
    const logger = createMockLogger();

    const result = await discoverAndRejoinRooms({
      roomService: roomService as any,
      bridgeManager: bridgeManager as any,
      logger: logger as any,
    });

    expect(result.roomsSkipped).toEqual(["room-1"]);
    expect(result.roomsRejoined).toEqual([]);
    expect(bridgeManager.addRoom).not.toHaveBeenCalled();
  });

  it("skips rooms with only agent participants", async () => {
    const roomService = {
      listRooms: mock(async () => [{ name: "room-1" }]),
      listParticipants: mock(async () => [
        { identity: "voice-agent", kind: PARTICIPANT_KIND_AGENT },
      ]),
    };
    const bridgeManager = createMockBridgeManager();
    const logger = createMockLogger();

    const result = await discoverAndRejoinRooms({
      roomService: roomService as any,
      bridgeManager: bridgeManager as any,
      logger: logger as any,
    });

    expect(result.roomsSkipped).toEqual(["room-1"]);
    expect(result.roomsRejoined).toEqual([]);
  });

  it("skips rooms already tracked by bridgeManager", async () => {
    const roomService = {
      listRooms: mock(async () => [{ name: "room-1" }]),
      listParticipants: mock(async () => []),
    };
    const bridgeManager = createMockBridgeManager(["room-1"]);
    const logger = createMockLogger();

    const result = await discoverAndRejoinRooms({
      roomService: roomService as any,
      bridgeManager: bridgeManager as any,
      logger: logger as any,
    });

    expect(result.roomsSkipped).toEqual(["room-1"]);
    // Should not even call listParticipants
    expect(roomService.listParticipants).not.toHaveBeenCalled();
  });

  it("returns empty result when listRooms fails", async () => {
    const roomService = {
      listRooms: mock(async () => {
        throw new Error("connection refused");
      }),
      listParticipants: mock(async () => []),
    };
    const bridgeManager = createMockBridgeManager();
    const logger = createMockLogger();

    const result = await discoverAndRejoinRooms({
      roomService: roomService as any,
      bridgeManager: bridgeManager as any,
      logger: logger as any,
    });

    expect(result.roomsChecked).toBe(0);
    expect(result.roomsRejoined).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("catches per-room errors without blocking others", async () => {
    const roomService = {
      listRooms: mock(async () => [{ name: "room-ok" }, { name: "room-fail" }]),
      listParticipants: mock(async (room: string) => {
        if (room === "room-fail") throw new Error("timeout");
        return [{ identity: "user-a", kind: 0 }];
      }),
    };
    const bridgeManager = createMockBridgeManager();
    const logger = createMockLogger();

    const result = await discoverAndRejoinRooms({
      roomService: roomService as any,
      bridgeManager: bridgeManager as any,
      logger: logger as any,
    });

    expect(result.roomsRejoined).toEqual(["room-ok"]);
    expect(result.roomsFailed).toEqual(["room-fail"]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("skips empty rooms (no participants at all)", async () => {
    const roomService = {
      listRooms: mock(async () => [{ name: "empty-room" }]),
      listParticipants: mock(async () => []),
    };
    const bridgeManager = createMockBridgeManager();
    const logger = createMockLogger();

    const result = await discoverAndRejoinRooms({
      roomService: roomService as any,
      bridgeManager: bridgeManager as any,
      logger: logger as any,
    });

    expect(result.roomsSkipped).toEqual(["empty-room"]);
    expect(result.roomsRejoined).toEqual([]);
  });

  it("skips bind-blacklisted rooms (ghost room suppression)", async () => {
    const roomService = {
      listRooms: mock(async () => [{ name: "ghost-room" }, { name: "live-room" }]),
      listParticipants: mock(async () => [{ identity: "user-a", kind: 0 }]),
    };
    // "ghost-room" is blacklisted, "live-room" is not
    const bridgeManager = createMockBridgeManager([], ["ghost-room"]);
    const logger = createMockLogger();

    const result = await discoverAndRejoinRooms({
      roomService: roomService as any,
      bridgeManager: bridgeManager as any,
      logger: logger as any,
    });

    // ghost-room should be skipped without calling listParticipants
    expect(result.roomsSkipped).toContain("ghost-room");
    // live-room has humans and is not blacklisted — should be rejoined
    expect(result.roomsRejoined).toEqual(["live-room"]);
    expect(bridgeManager.addRoom).toHaveBeenCalledTimes(1);
    expect(bridgeManager.addRoom).toHaveBeenCalledWith("live-room");
    // listParticipants should only be called for live-room (ghost-room was skipped early)
    expect(roomService.listParticipants).toHaveBeenCalledTimes(1);
    expect(roomService.listParticipants).toHaveBeenCalledWith("live-room");
  });
});
