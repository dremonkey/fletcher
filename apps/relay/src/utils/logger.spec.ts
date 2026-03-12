import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createLogger } from "./logger";

// ---------------------------------------------------------------------------
// Capture console output
// ---------------------------------------------------------------------------

let captured: { method: string; args: unknown[] }[] = [];
let origLog: typeof console.log;
let origWarn: typeof console.warn;
let origError: typeof console.error;

beforeEach(() => {
  captured = [];
  origLog = console.log;
  origWarn = console.warn;
  origError = console.error;

  console.log = (...args: unknown[]) => {
    captured.push({ method: "log", args });
  };
  console.warn = (...args: unknown[]) => {
    captured.push({ method: "warn", args });
  };
  console.error = (...args: unknown[]) => {
    captured.push({ method: "error", args });
  };
});

afterEach(() => {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createLogger", () => {
  test("returns object with info, warn, error methods", () => {
    const log = createLogger("test");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  test("info() produces valid JSON with correct level and component", () => {
    const log = createLogger("my-component");
    log.info({ event: "started" });

    expect(captured.length).toBe(1);
    expect(captured[0].method).toBe("log");

    const parsed = JSON.parse(captured[0].args[0] as string);
    expect(parsed.level).toBe("info");
    expect(parsed.component).toBe("my-component");
    expect(parsed.event).toBe("started");
    expect(typeof parsed.ts).toBe("number");
  });

  test("warn() produces valid JSON with correct level and component", () => {
    const log = createLogger("warnings");
    log.warn({ event: "slow_response", latencyMs: 5000 });

    expect(captured.length).toBe(1);
    expect(captured[0].method).toBe("warn");

    const parsed = JSON.parse(captured[0].args[0] as string);
    expect(parsed.level).toBe("warn");
    expect(parsed.component).toBe("warnings");
    expect(parsed.event).toBe("slow_response");
    expect(parsed.latencyMs).toBe(5000);
  });

  test("error() produces valid JSON with correct level and component", () => {
    const log = createLogger("errors");
    log.error({ event: "crash", exitCode: 1 });

    expect(captured.length).toBe(1);
    expect(captured[0].method).toBe("error");

    const parsed = JSON.parse(captured[0].args[0] as string);
    expect(parsed.level).toBe("error");
    expect(parsed.component).toBe("errors");
    expect(parsed.event).toBe("crash");
    expect(parsed.exitCode).toBe(1);
  });

  test("ts is a recent timestamp", () => {
    const before = Date.now();
    const log = createLogger("ts-test");
    log.info({ event: "check" });
    const after = Date.now();

    const parsed = JSON.parse(captured[0].args[0] as string);
    expect(parsed.ts).toBeGreaterThanOrEqual(before);
    expect(parsed.ts).toBeLessThanOrEqual(after);
  });

  test("user data fields are included in output", () => {
    const log = createLogger("data-test");
    log.info({ event: "room_joined", roomName: "room-abc", count: 3 });

    const parsed = JSON.parse(captured[0].args[0] as string);
    expect(parsed.roomName).toBe("room-abc");
    expect(parsed.count).toBe(3);
  });
});
