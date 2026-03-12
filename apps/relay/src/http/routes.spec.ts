import { describe, test, expect, beforeEach, mock } from "bun:test";
import { handleHttpRequest } from "./routes";
import type { RouteContext } from "./routes";
import type { BridgeManager } from "../bridge/bridge-manager";
import type { RoomManager, RoomConnection } from "../livekit/room-manager";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockBridgeManager(existingRooms: Set<string> = new Set()) {
  const addedRooms: string[] = [];

  return {
    hasRoom(roomName: string): boolean {
      return existingRooms.has(roomName);
    },
    async addRoom(roomName: string): Promise<void> {
      addedRooms.push(roomName);
      existingRooms.add(roomName);
    },
    getActiveRooms(): string[] {
      return Array.from(existingRooms);
    },
    getBridge(_roomName: string) {
      return undefined;
    },
    addedRooms,
  } as unknown as BridgeManager;
}

function createMockRoomManager(rooms: RoomConnection[] = []) {
  return {
    getActiveRooms: mock(() => rooms),
  } as unknown as RoomManager;
}

function createCtx(
  existingRooms: Set<string> = new Set(),
  roomConnections: RoomConnection[] = [],
): RouteContext {
  return {
    bridgeManager: createMockBridgeManager(existingRooms),
    roomManager: createMockRoomManager(roomConnections),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGet(path: string): Request {
  return new Request(`http://localhost${path}`);
}

function makePost(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePostRaw(path: string, rawBody: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  test("returns 200 with status and uptime", async () => {
    const ctx = createCtx();
    const res = await handleHttpRequest(makeGet("/health"), ctx);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  test("response has JSON content-type", async () => {
    const ctx = createCtx();
    const res = await handleHttpRequest(makeGet("/health"), ctx);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("includes room and ACP process counts", async () => {
    const roomConnections: RoomConnection[] = [
      { roomName: "room-a", joinedAt: 1000, lastActivity: 2000, room: {} as any },
      { roomName: "room-b", joinedAt: 1500, lastActivity: 2500, room: {} as any },
    ];
    const ctx: RouteContext = {
      bridgeManager: createMockBridgeManager(new Set(["room-a", "room-b"])),
      roomManager: createMockRoomManager(roomConnections),
    };
    const res = await handleHttpRequest(makeGet("/health"), ctx);
    const body = await res.json();

    expect(body.rooms).toBe(2);
    expect(body.acpProcesses).toBe(2);
  });

  test("returns zero counts when no rooms", async () => {
    const ctx = createCtx();
    const res = await handleHttpRequest(makeGet("/health"), ctx);
    const body = await res.json();

    expect(body.rooms).toBe(0);
    expect(body.acpProcesses).toBe(0);
  });
});

describe("POST /relay/join", () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createCtx();
  });

  test("with valid body returns { status: 'joined' }", async () => {
    const res = await handleHttpRequest(
      makePost("/relay/join", { roomName: "room-abc" }),
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("joined");
    expect(body.roomName).toBe("room-abc");
  });

  test("with existing room returns { status: 'already_joined' }", async () => {
    const ctxExisting = createCtx(new Set(["room-exists"]));

    const res = await handleHttpRequest(
      makePost("/relay/join", { roomName: "room-exists" }),
      ctxExisting,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("already_joined");
    expect(body.roomName).toBe("room-exists");
  });

  test("missing roomName returns 400", async () => {
    const res = await handleHttpRequest(
      makePost("/relay/join", { userId: "alice" }),
      ctx,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("roomName");
  });

  test("empty body returns 400", async () => {
    const res = await handleHttpRequest(
      makePost("/relay/join", {}),
      ctx,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("roomName");
  });

  test("invalid JSON returns 400", async () => {
    const res = await handleHttpRequest(
      makePostRaw("/relay/join", "not-json{{{"),
      ctx,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });

  test("addRoom failure returns 500", async () => {
    const failingCtx: RouteContext = {
      bridgeManager: {
        hasRoom: () => false,
        addRoom: async () => {
          throw new Error("connection refused");
        },
        getActiveRooms: () => [],
        getBridge: () => undefined,
      } as unknown as BridgeManager,
      roomManager: createMockRoomManager(),
    };

    const res = await handleHttpRequest(
      makePost("/relay/join", { roomName: "room-fail" }),
      failingCtx,
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("connection refused");
  });
});

// ---------------------------------------------------------------------------
// GET /rooms
// ---------------------------------------------------------------------------

describe("GET /rooms", () => {
  test("returns room details with ACP status", async () => {
    const now = Date.now();
    const roomConnections: RoomConnection[] = [
      { roomName: "room-abc", joinedAt: now - 5000, lastActivity: now - 1000, room: {} as any },
    ];

    const ctx: RouteContext = {
      bridgeManager: {
        ...createMockBridgeManager(new Set(["room-abc"])),
        getBridge(name: string) {
          if (name === "room-abc") {
            return { isStarted: true, getSessionId: () => "sess_abc" };
          }
          return undefined;
        },
      } as unknown as BridgeManager,
      roomManager: createMockRoomManager(roomConnections),
    };

    const res = await handleHttpRequest(makeGet("/rooms"), ctx);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.rooms).toHaveLength(1);

    const room = body.rooms[0];
    expect(room.roomName).toBe("room-abc");
    expect(room.joinedAt).toBe(now - 5000);
    expect(room.lastActivity).toBe(now - 1000);
    expect(room.acpStatus).toBe("connected");
    expect(room.sessionId).toBe("sess_abc");
  });

  test("returns empty array when no rooms", async () => {
    const ctx = createCtx();

    const res = await handleHttpRequest(makeGet("/rooms"), ctx);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.rooms).toEqual([]);
  });

  test("returns disconnected status when bridge not started", async () => {
    const now = Date.now();
    const roomConnections: RoomConnection[] = [
      { roomName: "room-xyz", joinedAt: now, lastActivity: now, room: {} as any },
    ];

    const ctx: RouteContext = {
      bridgeManager: {
        ...createMockBridgeManager(new Set(["room-xyz"])),
        getBridge(name: string) {
          if (name === "room-xyz") {
            return { isStarted: false, getSessionId: () => null };
          }
          return undefined;
        },
      } as unknown as BridgeManager,
      roomManager: createMockRoomManager(roomConnections),
    };

    const res = await handleHttpRequest(makeGet("/rooms"), ctx);
    const body = await res.json();

    expect(body.rooms[0].acpStatus).toBe("disconnected");
    expect(body.rooms[0].sessionId).toBeNull();
  });

  test("returns disconnected when no bridge exists for room", async () => {
    const now = Date.now();
    const roomConnections: RoomConnection[] = [
      { roomName: "room-orphan", joinedAt: now, lastActivity: now, room: {} as any },
    ];

    const ctx: RouteContext = {
      bridgeManager: createMockBridgeManager(),
      roomManager: createMockRoomManager(roomConnections),
    };

    const res = await handleHttpRequest(makeGet("/rooms"), ctx);
    const body = await res.json();

    expect(body.rooms[0].acpStatus).toBe("disconnected");
    expect(body.rooms[0].sessionId).toBeNull();
  });

  test("returns multiple rooms", async () => {
    const now = Date.now();
    const roomConnections: RoomConnection[] = [
      { roomName: "room-a", joinedAt: now - 3000, lastActivity: now - 500, room: {} as any },
      { roomName: "room-b", joinedAt: now - 1000, lastActivity: now - 100, room: {} as any },
    ];

    const ctx: RouteContext = {
      bridgeManager: {
        ...createMockBridgeManager(new Set(["room-a", "room-b"])),
        getBridge(name: string) {
          if (name === "room-a") return { isStarted: true, getSessionId: () => "sess_a" };
          if (name === "room-b") return { isStarted: true, getSessionId: () => "sess_b" };
          return undefined;
        },
      } as unknown as BridgeManager,
      roomManager: createMockRoomManager(roomConnections),
    };

    const res = await handleHttpRequest(makeGet("/rooms"), ctx);
    const body = await res.json();

    expect(body.rooms).toHaveLength(2);
    expect(body.rooms[0].roomName).toBe("room-a");
    expect(body.rooms[1].roomName).toBe("room-b");
  });
});

// ---------------------------------------------------------------------------
// Unknown paths
// ---------------------------------------------------------------------------

describe("Unknown paths", () => {
  test("returns 404 with error message", async () => {
    const ctx = createCtx();
    const res = await handleHttpRequest(makeGet("/unknown"), ctx);

    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("404 response has JSON content-type", async () => {
    const ctx = createCtx();
    const res = await handleHttpRequest(makeGet("/not-a-route"), ctx);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
