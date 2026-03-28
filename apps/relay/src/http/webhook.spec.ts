import { describe, test, expect, beforeEach, mock } from "bun:test";
import { createWebhookHandler } from "./webhook";
import type { BridgeManager } from "../bridge/bridge-manager";
import pino from "pino";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockBridgeManager(
  existingRooms: Set<string> = new Set(),
  pendingTeardownRooms: Set<string> = new Set(),
) {
  const addedRooms: string[] = [];
  const removedRooms: string[] = [];
  const scheduledRooms: string[] = [];
  const cancelledRooms: string[] = [];
  const validatedRooms: string[] = [];
  const blacklistCleared: string[] = [];

  return {
    hasRoom(roomName: string): boolean {
      return existingRooms.has(roomName);
    },
    async addRoom(roomName: string): Promise<void> {
      addedRooms.push(roomName);
      existingRooms.add(roomName);
    },
    async removeRoom(roomName: string): Promise<void> {
      removedRooms.push(roomName);
      existingRooms.delete(roomName);
    },
    scheduleRemoveRoom(roomName: string): void {
      scheduledRooms.push(roomName);
    },
    cancelPendingTeardown(roomName: string): boolean {
      cancelledRooms.push(roomName);
      if (pendingTeardownRooms.has(roomName)) {
        pendingTeardownRooms.delete(roomName);
        return true;
      }
      return false;
    },
    async validateOrReplaceBridge(roomName: string): Promise<void> {
      validatedRooms.push(roomName);
    },
    clearBindBlacklist(roomName: string): void {
      blacklistCleared.push(roomName);
    },
    addedRooms,
    removedRooms,
    scheduledRooms,
    cancelledRooms,
    validatedRooms,
    blacklistCleared,
  } as unknown as BridgeManager & {
    addedRooms: string[];
    removedRooms: string[];
    scheduledRooms: string[];
    cancelledRooms: string[];
    validatedRooms: string[];
    blacklistCleared: string[];
  };
}

function createMockWebhookReceiver(eventToReturn: unknown) {
  return {
    receive: mock(async (_body: string, _auth?: string) => eventToReturn),
  };
}

function createFailingWebhookReceiver() {
  return {
    receive: mock(async () => {
      throw new Error("invalid token");
    }),
  };
}

const silentLogger = pino({ level: "silent" });

function makeWebhookRequest(body: object, authHeader = "Bearer test-token"): Request {
  return new Request("http://localhost/webhooks/livekit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("webhook handler", () => {
  describe("participant_joined from standard participant", () => {
    test("calls addRoom with the room name", async () => {
      const bridgeManager = createMockBridgeManager();
      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: { name: "room-abc" },
        participant: { identity: "alice", kind: 0 }, // STANDARD = 0
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.received).toBe(true);
      expect(bridgeManager.addedRooms).toEqual(["room-abc"]);
    });
  });

  describe("participant_joined from relay identity", () => {
    test("does not call addRoom", async () => {
      const bridgeManager = createMockBridgeManager();
      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: { name: "room-abc" },
        participant: { identity: "relay-main", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.addedRooms).toEqual([]);
    });
  });

  describe("participant_joined from agent participant", () => {
    test("does not call addRoom", async () => {
      const bridgeManager = createMockBridgeManager();
      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: { name: "room-abc" },
        participant: { identity: "agent-voice", kind: 4 }, // AGENT = 4
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.addedRooms).toEqual([]);
    });
  });

  describe("other event types", () => {
    test("room_started returns 200 but does not call addRoom", async () => {
      const bridgeManager = createMockBridgeManager();
      const receiver = createMockWebhookReceiver({
        event: "room_started",
        room: { name: "room-abc" },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.received).toBe(true);
      expect(bridgeManager.addedRooms).toEqual([]);
    });

    test("track_published returns 200 but does not call addRoom", async () => {
      const bridgeManager = createMockBridgeManager();
      const receiver = createMockWebhookReceiver({
        event: "track_published",
        room: { name: "room-abc" },
        participant: { identity: "alice", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.addedRooms).toEqual([]);
    });
  });

  describe("invalid signature", () => {
    test("returns 401", async () => {
      const bridgeManager = createMockBridgeManager();
      const receiver = createFailingWebhookReceiver();

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Invalid signature");
    });
  });

  describe("already-joined room", () => {
    test("is idempotent — does not call addRoom again", async () => {
      const bridgeManager = createMockBridgeManager(new Set(["room-abc"]));
      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: { name: "room-abc" },
        participant: { identity: "alice", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.addedRooms).toEqual([]);
    });
  });

  describe("participant_joined cancels pending teardown", () => {
    test("calls cancelPendingTeardown when room already has bridge", async () => {
      const bridgeManager = createMockBridgeManager(new Set(["room-abc"]));
      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: { name: "room-abc" },
        participant: { identity: "alice", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.cancelledRooms).toEqual(["room-abc"]);
      expect(bridgeManager.addedRooms).toEqual([]); // room already existed
    });

    test("calls cancelPendingTeardown even when room is new", async () => {
      const bridgeManager = createMockBridgeManager();
      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: { name: "room-new" },
        participant: { identity: "alice", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.cancelledRooms).toEqual(["room-new"]);
      expect(bridgeManager.addedRooms).toEqual(["room-new"]);
    });
  });

  describe("addRoom failure", () => {
    test("returns 200 (webhook ack) even when addRoom throws", async () => {
      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: { name: "room-fail" },
        participant: { identity: "alice", kind: 0 },
      });

      const failingBridgeManager = {
        hasRoom: () => false,
        addRoom: async () => {
          throw new Error("connection refused");
        },
        cancelPendingTeardown: () => false,
        validateOrReplaceBridge: async () => {},
        clearBindBlacklist: () => {},
      } as unknown as BridgeManager & { addedRooms: string[] };

      const handler = createWebhookHandler(receiver as any, failingBridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      // Webhook should still return 200 to avoid LiveKit retries
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.received).toBe(true);
    });
  });

  describe("participant_left from standard participant", () => {
    test("calls removeRoom immediately when room has a bridge", async () => {
      const bridgeManager = createMockBridgeManager(new Set(["room-abc"]));
      const receiver = createMockWebhookReceiver({
        event: "participant_left",
        room: { name: "room-abc" },
        participant: { identity: "alice", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.removedRooms).toEqual(["room-abc"]);
      expect(bridgeManager.scheduledRooms).toEqual([]);
    });

    test("does not schedule teardown when room has no bridge", async () => {
      const bridgeManager = createMockBridgeManager();
      const receiver = createMockWebhookReceiver({
        event: "participant_left",
        room: { name: "room-abc" },
        participant: { identity: "alice", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.scheduledRooms).toEqual([]);
    });
  });

  describe("participant_left from relay identity", () => {
    test("does not schedule teardown", async () => {
      const bridgeManager = createMockBridgeManager(new Set(["room-abc"]));
      const receiver = createMockWebhookReceiver({
        event: "participant_left",
        room: { name: "room-abc" },
        participant: { identity: "relay-room-abc", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.scheduledRooms).toEqual([]);
    });
  });

  describe("participant_left from agent participant", () => {
    test("does not schedule teardown", async () => {
      const bridgeManager = createMockBridgeManager(new Set(["room-abc"]));
      const receiver = createMockWebhookReceiver({
        event: "participant_left",
        room: { name: "room-abc" },
        participant: { identity: "agent-voice", kind: 4 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.scheduledRooms).toEqual([]);
    });
  });

  describe("missing room name", () => {
    test("returns 200 without calling addRoom", async () => {
      const bridgeManager = createMockBridgeManager();
      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: {},
        participant: { identity: "alice", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.addedRooms).toEqual([]);
    });
  });

  describe("participant_joined after deferred teardown (network switch scenario)", () => {
    test("cancels teardown and validates bridge when participant rejoins during grace period", async () => {
      // Room exists AND has a pending teardown (participant is reconnecting)
      const existingRooms = new Set(["room-reconnect"]);
      const pendingTeardowns = new Set(["room-reconnect"]);
      const bridgeManager = createMockBridgeManager(existingRooms, pendingTeardowns);

      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: { name: "room-reconnect" },
        participant: { identity: "alice", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      // Should have cancelled the teardown
      expect(bridgeManager.cancelledRooms).toEqual(["room-reconnect"]);
      // Should have validated the bridge (not added a new room)
      expect(bridgeManager.validatedRooms).toEqual(["room-reconnect"]);
      expect(bridgeManager.addedRooms).toEqual([]);
    });

    test("does not validate when room already joined without pending teardown", async () => {
      // Room exists but NO pending teardown (normal duplicate join)
      const existingRooms = new Set(["room-dup"]);
      const bridgeManager = createMockBridgeManager(existingRooms);

      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: { name: "room-dup" },
        participant: { identity: "alice", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      // cancelPendingTeardown was called but returned false
      expect(bridgeManager.cancelledRooms).toEqual(["room-dup"]);
      // Should NOT validate — just skip (room already joined normally)
      expect(bridgeManager.validatedRooms).toEqual([]);
      expect(bridgeManager.addedRooms).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Bind blacklist (ghost room suppression)
  // -------------------------------------------------------------------------

  describe("participant_joined clears bind blacklist", () => {
    test("clearBindBlacklist is called before cancelPendingTeardown for human participants", async () => {
      const calls: string[] = [];
      const bridgeManager = {
        hasRoom: () => false,
        addRoom: mock(async () => {}),
        cancelPendingTeardown: mock(() => {
          calls.push("cancelPendingTeardown");
          return false;
        }),
        clearBindBlacklist: mock((_roomName: string) => {
          calls.push("clearBindBlacklist");
        }),
        validateOrReplaceBridge: mock(async () => {}),
      } as unknown as BridgeManager & { addedRooms: string[] };

      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: { name: "room-ghost" },
        participant: { identity: "user-alice", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      // clearBindBlacklist must be first, then cancelPendingTeardown
      expect(calls).toEqual(["clearBindBlacklist", "cancelPendingTeardown"]);
    });

    test("clearBindBlacklist is called with the room name", async () => {
      const bridgeManager = createMockBridgeManager();
      const receiver = createMockWebhookReceiver({
        event: "participant_joined",
        room: { name: "room-comeback" },
        participant: { identity: "user-bob", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      await handler(makeWebhookRequest({}));

      expect(bridgeManager.blacklistCleared).toEqual(["room-comeback"]);
    });
  });
});
