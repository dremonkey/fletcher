import { describe, test, expect, afterEach } from "bun:test";
import path from "path";
import { AcpClient } from "./client";

const MOCK_ACPX_PATH = path.resolve(import.meta.dir, "../../test/mock-acpx.ts");

function createClient(): AcpClient {
  return new AcpClient({
    command: "bun",
    args: [MOCK_ACPX_PATH],
  });
}

describe("AcpClient", () => {
  let client: AcpClient;

  afterEach(async () => {
    try {
      await client?.shutdown();
    } catch {
      // already shut down
    }
  });

  test("initialize() spawns process and returns capabilities", async () => {
    client = createClient();
    const result = await client.initialize();

    expect(result).toBeDefined();
    expect(result.capabilities).toEqual({});
  });

  test("sessionNew() creates a session and returns sessionId", async () => {
    client = createClient();
    await client.initialize();

    const result = await client.sessionNew({
      cwd: "/",
      mcpServers: [],
      _meta: {
        session_key: { type: "owner", key: "alice" },
        room_name: "room_abc",
        participant_identity: "alice",
      },
    });

    expect(result.sessionId).toBe("mock-sess-001");
  });

  test("sessionPrompt() sends prompt and receives update + result", async () => {
    client = createClient();
    await client.initialize();
    await client.sessionNew({});

    const updates: unknown[] = [];
    client.onUpdate((params) => {
      updates.push(params);
    });

    const result = await client.sessionPrompt({
      sessionId: "mock-sess-001",
      prompt: [{ type: "text", text: "Hello" }],
    });

    expect(result.stopReason).toBe("completed");

    // The update notification should have arrived before the response
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const firstUpdate = updates[0] as { updates: { kind: string; content: { text: string } }[] };
    expect(firstUpdate.updates[0].kind).toBe("content_chunk");
    expect(firstUpdate.updates[0].content.text).toBe("Echo: Hello");
  });

  test("sessionCancel() sends notification without error", async () => {
    client = createClient();
    await client.initialize();
    await client.sessionNew({});

    // sessionCancel is a notification — should not throw
    expect(() => {
      client.sessionCancel({ sessionId: "mock-sess-001" });
    }).not.toThrow();
  });

  test("full lifecycle: initialize, sessionNew, sessionPrompt, shutdown", async () => {
    client = createClient();

    // 1. Initialize
    const initResult = await client.initialize();
    expect(initResult.capabilities).toBeDefined();

    // 2. Create session
    const session = await client.sessionNew({
      cwd: "/",
      _meta: {
        session_key: { type: "owner", key: "bob" },
        room_name: "room_xyz",
        participant_identity: "bob",
      },
    });
    expect(session.sessionId).toBe("mock-sess-001");

    // 3. Send prompt
    const updates: unknown[] = [];
    client.onUpdate((params) => updates.push(params));

    const promptResult = await client.sessionPrompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "How are you?" }],
    });
    expect(promptResult.stopReason).toBe("completed");
    expect(updates.length).toBeGreaterThanOrEqual(1);

    // 4. Shutdown
    await client.shutdown();
  });

  test("subprocess crash rejects pending promises", async () => {
    // Use a command that will exit immediately
    client = new AcpClient({
      command: "bun",
      args: ["-e", 'process.exit(0)'],
    });

    // The process exits immediately, so initialize should fail
    // because the response never comes
    await expect(client.initialize()).rejects.toThrow();
  });

  test("shutdown() completes cleanly", async () => {
    client = createClient();
    await client.initialize();

    // Shutdown should not throw
    await client.shutdown();
  });
});
