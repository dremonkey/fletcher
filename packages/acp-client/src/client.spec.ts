import { describe, test, expect, afterEach } from "bun:test";
import path from "path";
import { AcpClient } from "./client";

const MOCK_ACPX_PATH = path.resolve(import.meta.dir, "../test/mock-acpx.ts");

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

  test("shutdown() escalates to SIGKILL when process ignores SIGTERM", async () => {
    // Spawn a process that traps SIGTERM and stays alive
    client = new AcpClient({
      command: "bun",
      args: [
        "-e",
        `
        // Handle SIGTERM — ignore it
        process.on("SIGTERM", () => {});
        // Respond to initialize so the client can proceed
        const decoder = new TextDecoder();
        for await (const chunk of Bun.stdin.stream()) {
          for (const line of decoder.decode(chunk).split("\\n").filter(Boolean)) {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") {
              console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } }));
            }
          }
        }
        `,
      ],
    });

    await client.initialize();

    // shutdown should complete (escalate to SIGKILL) within ~4s
    const start = Date.now();
    await client.shutdown();
    const elapsed = Date.now() - start;

    // Should have waited ~3s for SIGTERM grace period, then SIGKILL'd
    expect(elapsed).toBeGreaterThanOrEqual(2500);
    expect(elapsed).toBeLessThan(6000);

    // Process should be dead
    expect(client.isAlive).toBe(false);
  });

  test("shutdown() kills child processes via process group", async () => {
    // Spawn a process that forks a child, both ignore SIGTERM
    client = new AcpClient({
      command: "bun",
      args: [
        "-e",
        `
        process.on("SIGTERM", () => {});
        // Spawn a child that also ignores SIGTERM
        const child = Bun.spawn(["sleep", "300"], { stdout: "ignore", stderr: "ignore" });
        // Respond to initialize
        const decoder = new TextDecoder();
        for await (const chunk of Bun.stdin.stream()) {
          for (const line of decoder.decode(chunk).split("\\n").filter(Boolean)) {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") {
              console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } }));
            }
          }
        }
        `,
      ],
    });

    await client.initialize();
    await client.shutdown();

    // Process should be dead after SIGKILL escalation
    expect(client.isAlive).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Unsubscribe tests (new)
  // -------------------------------------------------------------------------

  test("onUpdate() returns an unsubscribe function that stops handler from receiving updates", async () => {
    client = createClient();
    await client.initialize();
    await client.sessionNew({});

    const receivedBefore: unknown[] = [];
    const receivedAfter: unknown[] = [];

    const unsubscribe = client.onUpdate((params) => {
      receivedBefore.push(params);
    });

    // First prompt — handler is subscribed
    await client.sessionPrompt({
      sessionId: "mock-sess-001",
      prompt: [{ type: "text", text: "First" }],
    });
    expect(receivedBefore.length).toBeGreaterThanOrEqual(1);

    // Unsubscribe
    unsubscribe();

    // Register a second handler to verify updates still flow
    client.onUpdate((params) => {
      receivedAfter.push(params);
    });

    const countBefore = receivedBefore.length;

    // Second prompt — first handler should NOT receive anything more
    await client.sessionPrompt({
      sessionId: "mock-sess-001",
      prompt: [{ type: "text", text: "Second" }],
    });

    expect(receivedBefore.length).toBe(countBefore); // no new updates to unsubscribed handler
    expect(receivedAfter.length).toBeGreaterThanOrEqual(1); // second handler still fires
  });

  test("onUpdate() unsubscribe is idempotent (calling twice does not throw)", async () => {
    client = createClient();
    await client.initialize();

    const unsubscribe = client.onUpdate(() => {});
    expect(() => {
      unsubscribe();
      unsubscribe(); // second call should be a no-op
    }).not.toThrow();
  });

  test("onExit() returns an unsubscribe function that stops handler from being called", async () => {
    // Use a client that will die on its own
    client = new AcpClient({
      command: "bun",
      args: ["-e", "process.exit(0)"],
    });

    const exitCalls: (number | null)[] = [];
    const unsubscribe = client.onExit((code) => {
      exitCalls.push(code);
    });

    // Immediately unsubscribe before spawning
    unsubscribe();

    // initialize will fail (process exits immediately), but that's OK
    try {
      await client.initialize();
    } catch {
      // expected
    }

    // Wait a bit for the exit event to fire
    await new Promise((r) => setTimeout(r, 200));

    // Handler was unsubscribed before process exited — should not have been called
    expect(exitCalls.length).toBe(0);
  });

  test("onExit() unsubscribe is idempotent", async () => {
    client = createClient();
    await client.initialize();

    const unsubscribe = client.onExit(() => {});
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });

  test("multiple onUpdate handlers can coexist and be individually unsubscribed", async () => {
    client = createClient();
    await client.initialize();
    await client.sessionNew({});

    const calls1: unknown[] = [];
    const calls2: unknown[] = [];
    const calls3: unknown[] = [];

    const unsub1 = client.onUpdate((p) => calls1.push(p));
    const unsub2 = client.onUpdate((p) => calls2.push(p));
    client.onUpdate((p) => calls3.push(p)); // never unsubscribed

    // First prompt — all three handlers fire
    await client.sessionPrompt({
      sessionId: "mock-sess-001",
      prompt: [{ type: "text", text: "Hello" }],
    });

    expect(calls1.length).toBeGreaterThanOrEqual(1);
    expect(calls2.length).toBeGreaterThanOrEqual(1);
    expect(calls3.length).toBeGreaterThanOrEqual(1);

    // Unsubscribe handlers 1 and 2
    unsub1();
    unsub2();

    const snap1 = calls1.length;
    const snap2 = calls2.length;

    // Second prompt — only handler 3 should fire
    await client.sessionPrompt({
      sessionId: "mock-sess-001",
      prompt: [{ type: "text", text: "World" }],
    });

    expect(calls1.length).toBe(snap1);
    expect(calls2.length).toBe(snap2);
    expect(calls3.length).toBeGreaterThan(snap1); // handler 3 accumulated more
  });
});
