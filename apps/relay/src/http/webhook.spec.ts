import { describe, test, expect, beforeEach, mock } from "bun:test";
import { createWebhookHandler } from "./webhook";
import type { BridgeManager } from "../bridge/bridge-manager";
import pino from "pino";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockBridgeManager(existingRooms: Set<string> = new Set()) {
  const addedRooms: string[] = [];
  const removedRooms: string[] = [];

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
    addedRooms,
    removedRooms,
  } as unknown as BridgeManager & {
    addedRooms: string[];
    removedRooms: string[];
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
    test("calls removeRoom when room has a bridge", async () => {
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
    });

    test("does not call removeRoom when room has no bridge", async () => {
      const bridgeManager = createMockBridgeManager();
      const receiver = createMockWebhookReceiver({
        event: "participant_left",
        room: { name: "room-abc" },
        participant: { identity: "alice", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.removedRooms).toEqual([]);
    });
  });

  describe("participant_left from relay identity", () => {
    test("does not call removeRoom", async () => {
      const bridgeManager = createMockBridgeManager(new Set(["room-abc"]));
      const receiver = createMockWebhookReceiver({
        event: "participant_left",
        room: { name: "room-abc" },
        participant: { identity: "relay-room-abc", kind: 0 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.removedRooms).toEqual([]);
    });
  });

  describe("participant_left from agent participant", () => {
    test("does not call removeRoom", async () => {
      const bridgeManager = createMockBridgeManager(new Set(["room-abc"]));
      const receiver = createMockWebhookReceiver({
        event: "participant_left",
        room: { name: "room-abc" },
        participant: { identity: "agent-voice", kind: 4 },
      });

      const handler = createWebhookHandler(receiver as any, bridgeManager, silentLogger);
      const res = await handler(makeWebhookRequest({}));

      expect(res.status).toBe(200);
      expect(bridgeManager.removedRooms).toEqual([]);
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
});
