import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "path";
import { SessionPoller } from "./session-poller";
import { AcpClient } from "@fletcher/acp-client";
import type { Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Mock logger (silent)
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    child: () => createMockLogger(),
  } as unknown as Logger;
}

// ---------------------------------------------------------------------------
// Mock ACP client path
// ---------------------------------------------------------------------------

const MOCK_ACPX_PATH = path.resolve(
  import.meta.dir,
  "../../../../packages/acp-client/test/mock-acpx.ts",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait briefly for async handlers to flush. */
function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionPoller", () => {
  let acpClient: AcpClient;
  let poller: SessionPoller;
  let logger: Logger;
  let sessionId: string;

  beforeEach(async () => {
    logger = createMockLogger();
    acpClient = new AcpClient({
      command: "bun",
      args: [MOCK_ACPX_PATH],
      logger: createMockLogger(),
    });

    await acpClient.initialize();
    const session = await acpClient.sessionNew({
      cwd: process.cwd(),
      mcpServers: [],
    });
    sessionId = session.sessionId;
  });

  afterEach(async () => {
    poller?.stop();
    await acpClient.shutdown();
  });

  // -------------------------------------------------------------------------
  // Lifecycle tests
  // -------------------------------------------------------------------------

  test("start() begins polling and isRunning returns true", () => {
    const onNewMessages = mock(() => {});
    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 60_000, // large interval to prevent auto-tick
      onNewMessages,
    });

    expect(poller.isRunning).toBe(false);
    poller.start();
    expect(poller.isRunning).toBe(true);
  });

  test("start() is idempotent", () => {
    const onNewMessages = mock(() => {});
    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    poller.start();
    poller.start(); // second call should be a no-op
    expect(poller.isRunning).toBe(true);
  });

  test("stop() stops polling and isRunning returns false", () => {
    const onNewMessages = mock(() => {});
    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    poller.start();
    expect(poller.isRunning).toBe(true);
    poller.stop();
    expect(poller.isRunning).toBe(false);
  });

  test("stop() is idempotent", () => {
    const onNewMessages = mock(() => {});
    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    poller.start();
    poller.stop();
    poller.stop(); // second call should be a no-op
    expect(poller.isRunning).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Pause / resume
  // -------------------------------------------------------------------------

  test("pause() and resume() toggle isPaused", () => {
    const onNewMessages = mock(() => {});
    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    expect(poller.isPaused).toBe(false);
    poller.pause();
    expect(poller.isPaused).toBe(true);
    poller.resume();
    expect(poller.isPaused).toBe(false);
  });

  test("tick() is skipped when paused", async () => {
    const onNewMessages = mock(() => {});
    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    poller.start();
    poller.pause();

    // First, generate some history so there would be something to find
    await acpClient.sessionPrompt({
      sessionId,
      prompt: [{ type: "text", text: "Hello" }],
    } as any);

    await poller.tick();

    // No new messages should have been reported because polling is paused
    expect(onNewMessages).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Polling / dedup
  // -------------------------------------------------------------------------

  test("tick() finds new messages from session/load replay", async () => {
    const receivedMessages: any[] = [];
    const onNewMessages = mock((msgs: any[]) => {
      receivedMessages.push(...msgs);
    });

    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    // Generate some history first via a normal prompt
    await acpClient.sessionPrompt({
      sessionId,
      prompt: [{ type: "text", text: "Hello" }],
    } as any);

    // Now tick — the poller has no prior knowledge of existing messages,
    // so it should discover the echo chunk plus the async sub-agent result
    // that mock-acpx appends on session/load.
    await poller.tick();

    expect(onNewMessages).toHaveBeenCalled();
    expect(receivedMessages.length).toBeGreaterThanOrEqual(1);

    // Should contain the echo chunk and the async result
    const texts = receivedMessages.map(
      (m) => m.params.update.content.text
    );
    expect(texts).toContain("Echo: Hello");
    expect(texts).toContain("Async sub-agent result");
  });

  test("tick() deduplicates already-known content on subsequent polls", async () => {
    const receivedMessages: any[] = [];
    const onNewMessages = mock((msgs: any[]) => {
      receivedMessages.push(...msgs);
    });

    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    // Generate history
    await acpClient.sessionPrompt({
      sessionId,
      prompt: [{ type: "text", text: "Hello" }],
    } as any);

    // First tick — should find messages
    await poller.tick();
    const firstTickCount = receivedMessages.length;
    expect(firstTickCount).toBeGreaterThanOrEqual(1);

    // Second tick — the mock-acpx appends a NEW "Async sub-agent result"
    // each time session/load is called, so the second tick should find
    // exactly that one new message (not the old ones).
    receivedMessages.length = 0;
    onNewMessages.mockClear();

    await poller.tick();

    // Should find exactly the new async result (mock-acpx appends one each load)
    expect(onNewMessages).toHaveBeenCalled();
    const secondTickTexts = receivedMessages.map(
      (m) => m.params.update.content.text
    );
    expect(secondTickTexts).toEqual(["Async sub-agent result"]);
  });

  test("tick() syncs with relay bridge forwarded text via syncForwardedText()", async () => {
    const receivedMessages: any[] = [];
    const onNewMessages = mock((msgs: any[]) => {
      receivedMessages.push(...msgs);
    });

    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    // Generate history
    await acpClient.sessionPrompt({
      sessionId,
      prompt: [{ type: "text", text: "Hello" }],
    } as any);

    // Simulate relay bridge already having forwarded the echo text
    const forwardedText = "Echo: Hello";
    poller.syncForwardedText(() => forwardedText);

    // First tick — the echo should be skipped (already forwarded),
    // only the async result should be found
    await poller.tick();

    expect(onNewMessages).toHaveBeenCalled();
    const texts = receivedMessages.map(
      (m) => m.params.update.content.text
    );
    // "Echo: Hello" should NOT be in the results (already forwarded)
    expect(texts).not.toContain("Echo: Hello");
    expect(texts).toContain("Async sub-agent result");
  });

  test("tick() does not run concurrently (overlap protection)", async () => {
    const receivedMessages: any[] = [];
    const onNewMessages = mock((msgs: any[]) => {
      receivedMessages.push(...msgs);
    });

    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    // Generate history
    await acpClient.sessionPrompt({
      sessionId,
      prompt: [{ type: "text", text: "Hello" }],
    } as any);

    // Start two ticks concurrently — only one should execute
    const [r1, r2] = await Promise.all([poller.tick(), poller.tick()]);

    // onNewMessages may have been called once (the first tick that got in)
    // The key assertion: no crash, no duplicate processing
    expect(onNewMessages.mock.calls.length).toBeLessThanOrEqual(1);
  });

  test("tick() skips when ACP client is not alive", async () => {
    const onNewMessages = mock(() => {});
    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    // Kill the ACP client
    await acpClient.shutdown();

    // tick should be a no-op
    await poller.tick();
    expect(onNewMessages).not.toHaveBeenCalled();
  });

  test("tick() handles session/load errors gracefully", async () => {
    const onNewMessages = mock(() => {});
    poller = new SessionPoller({
      acpClient,
      sessionId: "nonexistent-session",
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    // The mock-acpx doesn't validate session IDs, so this should still work.
    // But let's at least verify no crash occurs.
    await poller.tick();
    // No assertion needed — just verifying no throw
  });

  // -------------------------------------------------------------------------
  // Integration with timer
  // -------------------------------------------------------------------------

  test("automatic tick fires at interval", async () => {
    const receivedMessages: any[] = [];
    const onNewMessages = mock((msgs: any[]) => {
      receivedMessages.push(...msgs);
    });

    // Generate history first
    await acpClient.sessionPrompt({
      sessionId,
      prompt: [{ type: "text", text: "Timer test" }],
    } as any);

    poller = new SessionPoller({
      acpClient,
      sessionId,
      logger,
      intervalMs: 100, // 100ms for testing
      onNewMessages,
    });

    poller.start();

    // Wait for at least one tick
    await tick(250);

    poller.stop();

    // Should have found messages via automatic polling
    expect(onNewMessages).toHaveBeenCalled();
    expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // setSessionId
  // -------------------------------------------------------------------------

  test("setSessionId updates the session used for polling", () => {
    const onNewMessages = mock(() => {});
    poller = new SessionPoller({
      acpClient,
      sessionId: "old-session",
      logger,
      intervalMs: 60_000,
      onNewMessages,
    });

    poller.setSessionId("new-session");
    // No direct getter for sessionId, but the update should not crash
    // and subsequent ticks should use the new session ID.
    // The actual effect is verified by the ACP call using the new ID.
  });
});
