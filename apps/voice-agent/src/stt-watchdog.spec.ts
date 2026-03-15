import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createSttWatchdog,
  type SttWatchdogDeps,
  type SttWatchdog,
  type AgentState,
  DEFAULT_STT_WATCHDOG_TIMEOUT_MS,
  WATCHDOG_CHECK_INTERVAL_MS,
} from "./stt-watchdog";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Short timeout and check interval for fast tests. */
const TEST_TIMEOUT_MS = 100;
const TEST_CHECK_INTERVAL_MS = 25;

function createTestDeps(
  agentState: AgentState = "listening",
): {
  deps: SttWatchdogDeps;
  publishedEvents: Record<string, unknown>[];
  logMessages: { level: string; msg: string }[];
  disconnectCount: number;
  getDisconnectCount: () => number;
  setAgentState: (state: AgentState) => void;
} {
  let _agentState = agentState;
  let _disconnectCount = 0;
  const publishedEvents: Record<string, unknown>[] = [];
  const logMessages: { level: string; msg: string }[] = [];

  const deps: SttWatchdogDeps = {
    getAgentState: () => _agentState,
    disconnectRoom: () => {
      _disconnectCount++;
    },
    publishEvent: (event) => publishedEvents.push(event),
    logger: {
      info: (_obj, msg) => logMessages.push({ level: "info", msg }),
      warn: (_obj, msg) => logMessages.push({ level: "warn", msg }),
      debug: (_obj, msg) => logMessages.push({ level: "debug", msg }),
    },
  };

  return {
    deps,
    publishedEvents,
    logMessages,
    get disconnectCount() {
      return _disconnectCount;
    },
    getDisconnectCount: () => _disconnectCount,
    setAgentState: (state: AgentState) => {
      _agentState = state;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSttWatchdog", () => {
  let watchdog: SttWatchdog;
  let ctx: ReturnType<typeof createTestDeps>;

  afterEach(() => {
    watchdog?.dispose();
  });

  // -------------------------------------------------------------------------
  // Initialization & activation
  // -------------------------------------------------------------------------

  it("starts deactivated with no prior activity", () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    expect(watchdog.activated).toBe(false);
    expect(watchdog.sttEverActive).toBe(false);
    expect(watchdog.lastActivityMs).toBe(0);
  });

  it("sets activated=true after activate() is called", () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    watchdog.activate();
    expect(watchdog.activated).toBe(true);
  });

  it("logs activation with timeout config", () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    watchdog.activate();
    const infoLogs = ctx.logMessages.filter((m) => m.level === "info");
    expect(infoLogs.some((m) => m.msg.includes("watchdog activated"))).toBe(
      true,
    );
  });

  it("activate is idempotent", () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    watchdog.activate();
    watchdog.activate();
    const activationLogs = ctx.logMessages.filter(
      (m) => m.level === "info" && m.msg.includes("watchdog activated"),
    );
    expect(activationLogs).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // STT activity tracking
  // -------------------------------------------------------------------------

  it("records onSttActivity and updates lastActivityMs", () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    const before = Date.now();
    watchdog.onSttActivity();
    const after = Date.now();

    expect(watchdog.sttEverActive).toBe(true);
    expect(watchdog.lastActivityMs).toBeGreaterThanOrEqual(before);
    expect(watchdog.lastActivityMs).toBeLessThanOrEqual(after);
  });

  it("logs on first STT activity", () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    watchdog.onSttActivity();
    const debugLogs = ctx.logMessages.filter((m) => m.level === "debug");
    expect(debugLogs.some((m) => m.msg.includes("first STT activity"))).toBe(
      true,
    );

    // Second call should not log again
    const countBefore = ctx.logMessages.length;
    watchdog.onSttActivity();
    const newDebugLogs = ctx.logMessages
      .slice(countBefore)
      .filter((m) => m.level === "debug" && m.msg.includes("first STT"));
    expect(newDebugLogs).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // No false alarms before activation / before STT ever active
  // -------------------------------------------------------------------------

  it("does NOT trigger before activation even with silence", async () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    // STT was active, then went silent, but watchdog not activated
    watchdog.onSttActivity();
    watchdog.onAgentListening();

    await sleep(TEST_TIMEOUT_MS + TEST_CHECK_INTERVAL_MS * 2);

    expect(ctx.getDisconnectCount()).toBe(0);
    // No events published (not even early hold) because not activated
    expect(ctx.publishedEvents).toHaveLength(0);
  });

  it("does NOT trigger before STT ever fires even when activated and listening", async () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    watchdog.activate();
    watchdog.onAgentListening();

    // Wait well past the timeout — no STT events have ever arrived
    await sleep(TEST_TIMEOUT_MS + TEST_CHECK_INTERVAL_MS * 2);

    expect(ctx.getDisconnectCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Trigger recovery on silence
  // -------------------------------------------------------------------------

  it("triggers recovery after timeout of silence while listening", async () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    // Simulate normal startup: STT active, activated, listening
    watchdog.onSttActivity();
    watchdog.activate();
    watchdog.onAgentListening();

    // Wait for timeout + check interval
    await sleep(TEST_TIMEOUT_MS + TEST_CHECK_INTERVAL_MS * 2);

    expect(ctx.getDisconnectCount()).toBe(1);
    // Early session_hold is sent at first silence detection (checkInterval)
    expect(ctx.publishedEvents.some((e) => e.type === "session_hold")).toBe(true);
  });

  it("logs a warning when triggering recovery", async () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    watchdog.onSttActivity();
    watchdog.activate();
    watchdog.onAgentListening();

    await sleep(TEST_TIMEOUT_MS + TEST_CHECK_INTERVAL_MS * 2);

    const warnLogs = ctx.logMessages.filter((m) => m.level === "warn");
    expect(warnLogs.some((m) => m.msg.includes("pipeline may be dead"))).toBe(
      true,
    );
  });

  // -------------------------------------------------------------------------
  // Activity resets the clock
  // -------------------------------------------------------------------------

  it("sends early session_hold before full timeout", async () => {
    ctx = createTestDeps();
    // Long timeout so disconnect doesn't fire, but check interval is short
    watchdog = createSttWatchdog(ctx.deps, 200, TEST_CHECK_INTERVAL_MS);

    watchdog.onSttActivity();
    watchdog.activate();
    watchdog.onAgentListening();

    // Wait past one check interval but before the full timeout
    await sleep(TEST_CHECK_INTERVAL_MS * 3);

    // Early session_hold should be published
    expect(ctx.publishedEvents.some((e) => e.type === "session_hold")).toBe(true);
    // But disconnect should NOT have fired yet
    expect(ctx.getDisconnectCount()).toBe(0);
  });

  it("resets early hold flag when STT activity resumes", async () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, 200, TEST_CHECK_INTERVAL_MS);

    watchdog.onSttActivity();
    watchdog.activate();
    watchdog.onAgentListening();

    // Wait for early hold
    await sleep(TEST_CHECK_INTERVAL_MS * 3);
    expect(ctx.publishedEvents.some((e) => e.type === "session_hold")).toBe(true);

    // STT comes back — reset
    watchdog.onSttActivity();

    // Clear events for clean check
    ctx.publishedEvents.length = 0;

    // Wait again — should send another early hold since flag was reset
    await sleep(TEST_CHECK_INTERVAL_MS * 3);
    expect(ctx.publishedEvents.some((e) => e.type === "session_hold")).toBe(true);

    // Still no disconnect (200ms timeout not reached)
    expect(ctx.getDisconnectCount()).toBe(0);
  });

  it("does NOT trigger if STT activity keeps resetting the clock", async () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    watchdog.onSttActivity();
    watchdog.activate();
    watchdog.onAgentListening();

    // Keep sending activity faster than the timeout
    for (let i = 0; i < 6; i++) {
      await sleep(TEST_TIMEOUT_MS / 3);
      watchdog.onSttActivity();
    }

    expect(ctx.getDisconnectCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Agent state transitions
  // -------------------------------------------------------------------------

  it("does NOT trigger while agent is busy (thinking/speaking)", async () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    watchdog.onSttActivity();
    watchdog.activate();
    watchdog.onAgentListening();

    // Agent starts thinking — watchdog should not trigger during this
    watchdog.onAgentBusy();

    await sleep(TEST_TIMEOUT_MS + TEST_CHECK_INTERVAL_MS * 2);

    expect(ctx.getDisconnectCount()).toBe(0);
  });

  it("respects listening-start time to avoid false alarms after speaking", async () => {
    ctx = createTestDeps();
    // Slightly longer timeout for this test to avoid flakiness
    const timeout = 150;
    watchdog = createSttWatchdog(ctx.deps, timeout, TEST_CHECK_INTERVAL_MS);

    // STT was active long ago
    watchdog.onSttActivity();
    watchdog.activate();
    watchdog.onAgentListening();

    // Agent speaks for a while (busy)
    watchdog.onAgentBusy();
    await sleep(timeout + 50);

    // Agent finishes speaking — re-enters listening
    // At this point lastActivityMs is old, but listeningStartMs is fresh
    watchdog.onAgentListening();

    // Check immediately after returning to listening — should NOT trigger
    // because we haven't been listening for long enough
    await sleep(TEST_CHECK_INTERVAL_MS * 2);
    expect(ctx.getDisconnectCount()).toBe(0);

    // Now wait for the full timeout from when listening started
    await sleep(timeout);
    expect(ctx.getDisconnectCount()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  it("stops triggering after dispose", async () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    watchdog.onSttActivity();
    watchdog.activate();
    watchdog.onAgentListening();

    // Dispose before timeout
    watchdog.dispose();

    await sleep(TEST_TIMEOUT_MS + TEST_CHECK_INTERVAL_MS * 2);

    expect(ctx.getDisconnectCount()).toBe(0);
  });

  it("only disconnects once per trigger (stops checking after recovery)", async () => {
    ctx = createTestDeps();
    watchdog = createSttWatchdog(ctx.deps, TEST_TIMEOUT_MS, TEST_CHECK_INTERVAL_MS);

    watchdog.onSttActivity();
    watchdog.activate();
    watchdog.onAgentListening();

    // Wait for trigger
    await sleep(TEST_TIMEOUT_MS + TEST_CHECK_INTERVAL_MS * 2);
    expect(ctx.getDisconnectCount()).toBe(1);

    // Wait more — should not trigger again
    await sleep(TEST_TIMEOUT_MS + TEST_CHECK_INTERVAL_MS * 2);
    expect(ctx.getDisconnectCount()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Default constants
  // -------------------------------------------------------------------------

  it("exports correct default constants", () => {
    expect(DEFAULT_STT_WATCHDOG_TIMEOUT_MS).toBe(30_000);
    expect(WATCHDOG_CHECK_INTERVAL_MS).toBe(10_000);
  });
});
