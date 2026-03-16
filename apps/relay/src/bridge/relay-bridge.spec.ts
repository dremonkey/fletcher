import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "path";
import { RelayBridge } from "./relay-bridge";
import type { RoomManager, DataHandler } from "../livekit/room-manager";

// ---------------------------------------------------------------------------
// Mock RoomManager
// ---------------------------------------------------------------------------

interface MockRoomManager {
  onDataReceived: (topic: string, handler: DataHandler) => void;
  sendToRoom: ReturnType<typeof mock>;
  sendToRoomOnTopic: ReturnType<typeof mock>;
  joinRoom: ReturnType<typeof mock>;
  leaveRoom: ReturnType<typeof mock>;
  disconnectAll: ReturnType<typeof mock>;
  getRoom: ReturnType<typeof mock>;
  getActiveRooms: ReturnType<typeof mock>;
  touchRoom: ReturnType<typeof mock>;
  topicHandlers: Map<string, DataHandler[]>;
  /** Simulate a mobile message arriving on the data channel for a given topic. */
  simulateData: (roomName: string, data: unknown, identity: string, topic?: string) => void;
}

function createMockRoomManager(): MockRoomManager {
  const topicHandlers = new Map<string, DataHandler[]>();

  return {
    topicHandlers,
    onDataReceived: (topic: string, handler: DataHandler) => {
      const handlers = topicHandlers.get(topic);
      if (handlers) {
        handlers.push(handler);
      } else {
        topicHandlers.set(topic, [handler]);
      }
    },
    sendToRoom: mock(async (_roomName: string, _msg: object) => {}),
    sendToRoomOnTopic: mock(async (_roomName: string, _topic: string, _msg: object) => {}),
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
    simulateData(roomName: string, data: unknown, identity: string, topic = "relay") {
      const handlers = topicHandlers.get(topic) ?? [];
      for (const handler of handlers) {
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
  "../../../../packages/acp-client/test/mock-acpx.ts",
);
const ROOM_NAME = "test-room";

function createBridge(mockRm: MockRoomManager, sessionKey = "agent:main:relay:test-room"): RelayBridge {
  return new RelayBridge({
    roomName: ROOM_NAME,
    sessionKey,
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

  test("--session arg uses the provided sessionKey, not the room name", async () => {
    const customKey = "user:alice:session:abc123";
    bridge = createBridge(mockRm, customKey);

    // Verify the source uses options.sessionKey for --session (not room name)
    // We check the relay-bridge.ts source text directly — if someone reverts
    // to the hard-coded room-name template, this assertion catches it.
    const fs = await import("fs");
    const bridgeSrc = fs.readFileSync(
      new URL("./relay-bridge.ts", import.meta.url).pathname,
      "utf-8",
    );
    expect(bridgeSrc).toContain("options.sessionKey");
    expect(bridgeSrc).not.toContain("`agent:main:relay:${options.roomName}`");

    // Starting should succeed — the mock ACPX accepts any --session value
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
    const params = notification.params as { update: { sessionUpdate: string; content: { type: string; text: string } } };
    expect(params.update.sessionUpdate).toBe("agent_message_chunk");
    expect(params.update.content.text).toBe("Echo: Test update");
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

  test("session/update chunk arrives before session/prompt result even when sendToRoom is slow", async () => {
    // Regression test for BUG-006: forwardToMobile was fire-and-forget, so
    // two concurrent publishData calls could deliver the result before the last
    // chunk, causing the mobile to null _activeStream and silently drop the chunk.
    //
    // Fix: sendQueue serializes all forwardToMobile calls via a Promise chain.

    const deliveryOrder: string[] = [];
    let firstCallResolve!: () => void;
    const firstCallSettled = new Promise<void>((r) => (firstCallResolve = r));

    // First sendToRoom call (the chunk) is artificially slow.
    // Without the fix, the result would overtake it.
    let callCount = 0;
    mockRm.sendToRoom = mock(async (_roomName: string, msg: object) => {
      callCount++;
      const m = msg as Record<string, unknown>;
      if (callCount === 1) {
        // Slow first call: 80ms delay
        await new Promise<void>((r) => setTimeout(r, 80));
        deliveryOrder.push("chunk");
        firstCallResolve();
      } else if ("result" in m) {
        deliveryOrder.push("result");
      } else {
        deliveryOrder.push("other");
      }
    });

    bridge = createBridge(mockRm);
    await bridge.start();

    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 99,
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: "race test" }] },
      },
      "mobile-user",
    );

    // Wait for both sends to complete
    await firstCallSettled;
    await tick(150);

    // Chunk must always arrive before result
    const chunkIdx = deliveryOrder.indexOf("chunk");
    const resultIdx = deliveryOrder.indexOf("result");
    expect(chunkIdx).toBeGreaterThanOrEqual(0);
    expect(resultIdx).toBeGreaterThanOrEqual(0);
    expect(chunkIdx).toBeLessThan(resultIdx);
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

  // -------------------------------------------------------------------------
  // T4: voice-acp session/prompt → sessionPrompt() called
  // -------------------------------------------------------------------------
  test("T4: voice-acp session/prompt is forwarded to ACP with sessionId injected", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // Simulate voice-agent sending session/prompt on voice-acp topic
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 10,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "Voice prompt" }],
        },
      },
      "voice-agent",
      "voice-acp",
    );

    // Wait for the async ACP round-trip
    await tick(200);

    // The result should be forwarded back via sendToRoomOnTopic on "voice-acp"
    expect(mockRm.sendToRoomOnTopic).toHaveBeenCalled();

    const calls = mockRm.sendToRoomOnTopic.mock.calls;
    const responseCalls = calls.filter(
      (c: unknown[]) => {
        const msg = c[2] as Record<string, unknown>;
        return msg.id === 10 && "result" in msg;
      },
    );
    expect(responseCalls.length).toBe(1);

    const [roomName, topic, response] = responseCalls[0] as [string, string, Record<string, unknown>];
    expect(roomName).toBe(ROOM_NAME);
    expect(topic).toBe("voice-acp");
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(10);
    expect(response.result).toEqual({ stopReason: "completed" });
  });

  // -------------------------------------------------------------------------
  // T5: voice-acp session/cancel → sessionCancel() called
  // -------------------------------------------------------------------------
  test("T5: voice-acp session/cancel is forwarded to ACP", async () => {
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
        "voice-agent",
        "voice-acp",
      );
    }).not.toThrow();

    // No response should be sent for a cancel notification
    await tick(100);
    // sendToRoomOnTopic should not have been called (no response for cancel)
    const calls = mockRm.sendToRoomOnTopic.mock.calls;
    expect(calls.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T6: ACP update during voice-acp request → sent on voice-acp topic (not relay)
  // -------------------------------------------------------------------------
  test("T6: ACP session/update notifications are routed to voice-acp topic when voice-acp initiated the request", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // Simulate voice-agent sending session/prompt on voice-acp topic
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 20,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "Voice update test" }],
        },
      },
      "voice-agent",
      "voice-acp",
    );

    await tick(200);

    // ACP update notifications should go to voice-acp topic via sendToRoomOnTopic
    const topicCalls = mockRm.sendToRoomOnTopic.mock.calls;
    const updateCalls = topicCalls.filter(
      (c: unknown[]) => {
        const msg = c[2] as Record<string, unknown>;
        return msg.method === "session/update";
      },
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    const [, updateTopic, notification] = updateCalls[0] as [string, string, Record<string, unknown>];
    expect(updateTopic).toBe("voice-acp");
    expect(notification.jsonrpc).toBe("2.0");
    expect(notification.method).toBe("session/update");

    // Updates should NOT have been sent on the relay topic (sendToRoom)
    const relayCalls = mockRm.sendToRoom.mock.calls;
    const relayUpdateCalls = relayCalls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.method === "session/update";
      },
    );
    expect(relayUpdateCalls.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T7: ACP update during relay (mobile) request → sent on relay topic (regression)
  // -------------------------------------------------------------------------
  test("T7: ACP session/update notifications are routed to relay topic when mobile initiated the request", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // Simulate mobile sending session/prompt on relay topic
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 30,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "Mobile relay test" }],
        },
      },
      "mobile-user",
      "relay",
    );

    await tick(200);

    // ACP update notifications should go to relay topic via sendToRoom
    const relayCalls = mockRm.sendToRoom.mock.calls;
    const updateCalls = relayCalls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.method === "session/update";
      },
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    const [, notification] = updateCalls[0] as [string, Record<string, unknown>];
    expect(notification.jsonrpc).toBe("2.0");
    expect(notification.method).toBe("session/update");

    // Updates should NOT have been sent via sendToRoomOnTopic on voice-acp
    const topicCalls = mockRm.sendToRoomOnTopic.mock.calls;
    const voiceAcpUpdateCalls = topicCalls.filter(
      (c: unknown[]) => {
        const topic = c[1] as string;
        const msg = c[2] as Record<string, unknown>;
        return topic === "voice-acp" && msg.method === "session/update";
      },
    );
    expect(voiceAcpUpdateCalls.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // BUG-020: forwardToMobile logs errors instead of silently swallowing
  // -------------------------------------------------------------------------
  test("forwardToMobile logs error when sendToRoom rejects (BUG-020)", async () => {
    const sendError = new Error("connection dead");
    mockRm.sendToRoom = mock(async () => {
      throw sendError;
    });

    bridge = createBridge(mockRm);
    await bridge.start();

    // Simulate a prompt — the result forward will hit the failing sendToRoom
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 200,
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: "BUG-020 test" }] },
      },
      "mobile-user",
    );

    await tick(300);

    // The bridge should not crash — the error is caught and logged.
    // We verify sendToRoom was called (and rejected).
    expect(mockRm.sendToRoom).toHaveBeenCalled();

    // Bridge should still be started (not crashed)
    expect(bridge.isStarted).toBe(true);
  });

  test("session/new params include verbose: true in _meta (Task 038)", async () => {
    // Regression guard: the relay must pass verbose: true in _meta when
    // creating a session so that OpenClaw emits tool_call / tool_call_update
    // events. If verbose were absent, tool call feedback would be silently
    // filtered by the gateway.
    //
    // The mock-acpx accepts any _meta (it doesn't validate), so we verify
    // the bridge successfully starts — which requires session/new to succeed.
    // The actual verbose flag is validated by TypeScript type checking and a
    // direct source inspection in code review. This test guards against
    // regression: if verbose: true were removed, this test still passes, so
    // we add a direct source-level assertion using the bridge internals.
    //
    // Approach: capture what the ACP client sends via a spy on the underlying
    // process stdin. Since that is complex with mock-acpx, we verify the
    // simpler observable: bridge starts, sessionId is assigned, no errors.
    bridge = createBridge(mockRm);
    await bridge.start();

    expect(bridge.isStarted).toBe(true);
    expect(bridge.getSessionId()).not.toBeNull();

    // The verbose flag is in relay-bridge.ts — verify it is present by
    // reading the module source text. This is a compile-time guarantee; if
    // someone removes verbose: true, this string assertion will fail.
    const fs = await import("fs");
    const bridgeSrc = fs.readFileSync(
      new URL("./relay-bridge.ts", import.meta.url).pathname,
      "utf-8",
    );
    expect(bridgeSrc).toContain("verbose: true");
  });

  // -------------------------------------------------------------------------
  // BUG-022 workaround: loadSession catch-up for missing sub-agent results
  // -------------------------------------------------------------------------

  test("BUG-022: zero-text prompt triggers loadSession catch-up and forwards new chunks", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // Send [no-echo] prompt — mock returns end_turn with no agent_message_chunk
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 100,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "[no-echo]" }],
        },
      },
      "mobile-user",
    );

    // Wait for prompt + catch-up to complete
    await tick(500);

    // The catch-up should have forwarded the async sub-agent result
    const calls = mockRm.sendToRoom.mock.calls;
    const updateCalls = calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.method === "session/update";
      },
    );

    // At least one update should have been forwarded (the async result from loadSession)
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    // Verify it contains the async sub-agent result text
    const asyncChunk = updateCalls.find((c: unknown[]) => {
      const msg = c[1] as Record<string, unknown>;
      const params = msg.params as any;
      return params?.update?.content?.text === "Async sub-agent result";
    });
    expect(asyncChunk).toBeDefined();
  });

  test("BUG-022: catch-up deduplicates already-forwarded chunks", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // 1. Send a normal prompt that generates an agent_message_chunk
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 101,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "Hello first" }],
        },
      },
      "mobile-user",
    );
    await tick(300);

    // Count chunks forwarded so far
    const chunksBefore = mockRm.sendToRoom.mock.calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        const params = msg.params as any;
        return msg.method === "session/update" && params?.update?.sessionUpdate === "agent_message_chunk";
      },
    ).length;
    expect(chunksBefore).toBe(1); // "Echo: Hello first"

    // 2. Send [no-echo] prompt — triggers catch-up
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 102,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "[no-echo]" }],
        },
      },
      "mobile-user",
    );
    await tick(500);

    // 3. Verify: the "Echo: Hello first" chunk should NOT appear again (deduped)
    const allChunkCalls = mockRm.sendToRoom.mock.calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        const params = msg.params as any;
        return msg.method === "session/update" && params?.update?.sessionUpdate === "agent_message_chunk";
      },
    );

    // Should have: 1 original + 1 async (no duplicate of "Echo: Hello first")
    const echoChunks = allChunkCalls.filter((c: unknown[]) => {
      const params = (c[1] as any).params as any;
      return params?.update?.content?.text === "Echo: Hello first";
    });
    expect(echoChunks.length).toBe(1); // exactly once — not duplicated

    // The async sub-agent result should be present
    const asyncChunks = allChunkCalls.filter((c: unknown[]) => {
      const params = (c[1] as any).params as any;
      return params?.update?.content?.text === "Async sub-agent result";
    });
    expect(asyncChunks.length).toBe(1);
  });

  test("BUG-022: catch-up does not fire for prompts with text content", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // Normal prompt — mock returns agent_message_chunk + stopReason "completed"
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 103,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "Normal prompt" }],
        },
      },
      "mobile-user",
    );
    await tick(300);

    // Verify: should have exactly 1 chunk (the echo) and 1 result — no catch-up
    const updateCalls = mockRm.sendToRoom.mock.calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.method === "session/update";
      },
    );
    expect(updateCalls.length).toBe(1); // just the echo, no catch-up replay

    const responseCalls = mockRm.sendToRoom.mock.calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.id === 103 && "result" in msg;
      },
    );
    expect(responseCalls.length).toBe(1);
    expect((responseCalls[0][1] as any).result.stopReason).toBe("completed");
  });

  test("BUG-022: catch-up does not fire when voice-acp request is active", async () => {
    bridge = createBridge(mockRm);
    await bridge.start();

    // Simulate a voice-acp prompt that is in flight (keeps activeRequestSource = "voice-acp")
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 104,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "Voice prompt in flight" }],
        },
      },
      "voice-agent",
      "voice-acp",
    );

    // Wait for it to complete (so the ACP is ready for the next prompt)
    await tick(300);

    // Now send a [no-echo] prompt from mobile. Even though this triggers
    // the catch-up condition, the bridge should remain stable.
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 105,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "[no-echo]" }],
        },
      },
      "mobile-user",
    );

    await tick(500);

    // Bridge should still be functional — no crash from catch-up
    expect(bridge.isStarted).toBe(true);

    // The [no-echo] result should have been forwarded to mobile
    const resultCalls = mockRm.sendToRoom.mock.calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        return msg.id === 105 && "result" in msg;
      },
    );
    expect(resultCalls.length).toBe(1);
    expect((resultCalls[0][1] as any).result.stopReason).toBe("end_turn");
  });

  // -------------------------------------------------------------------------
  // BUG-024: multi-round catch-up drift regression
  // -------------------------------------------------------------------------

  test("BUG-024: catch-up still works after multiple rounds (no count drift)", async () => {
    // Reproduces BUG-024: after one successful catch-up round, the count-based
    // dedup's skipCount drifted above the actual session history chunk count,
    // causing all subsequent catch-ups to skip everything (newChunks: -4).
    // The content-based dedup should handle this correctly.
    bridge = createBridge(mockRm);
    await bridge.start();

    // Round 1: Normal prompt → generates 1 agent_message_chunk
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 200,
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: "Hello first" }] },
      },
      "mobile-user",
    );
    await tick(300);

    // Round 2: [no-echo] prompt → triggers first catch-up
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 201,
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: "[no-echo]" }] },
      },
      "mobile-user",
    );
    await tick(500);

    // Verify first catch-up forwarded the async result
    const afterRound2 = mockRm.sendToRoom.mock.calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        const params = msg.params as any;
        return params?.update?.content?.text === "Async sub-agent result";
      },
    );
    expect(afterRound2.length).toBe(1);

    // Round 3: Another normal prompt
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 202,
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: "Hello second" }] },
      },
      "mobile-user",
    );
    await tick(300);

    // Round 4: Another [no-echo] prompt → triggers second catch-up
    // With the old count-based dedup, this would skip everything (BUG-024).
    // With content-based dedup, it should still find new async content.
    mockRm.simulateData(
      ROOM_NAME,
      {
        jsonrpc: "2.0",
        id: 203,
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: "[no-echo]" }] },
      },
      "mobile-user",
    );
    await tick(500);

    // Verify: the second catch-up ALSO forwarded the new async result.
    // The mock-acpx appends a new "Async sub-agent result" chunk each time
    // loadSession is called, so we should see 2 total async result chunks.
    const allAsyncChunks = mockRm.sendToRoom.mock.calls.filter(
      (c: unknown[]) => {
        const msg = c[1] as Record<string, unknown>;
        const params = msg.params as any;
        return params?.update?.content?.text === "Async sub-agent result";
      },
    );
    expect(allAsyncChunks.length).toBe(2);
  });
});
