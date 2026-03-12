import { describe, test, expect } from "bun:test";
import pino from "pino";
import { createLogger, rootLogger } from "./logger";

describe("createLogger", () => {
  test("returns a pino logger instance", () => {
    const log = createLogger("test");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  test("child logger includes component in bindings", () => {
    const log = createLogger("my-component");
    const bindings = log.bindings();
    expect(bindings.component).toBe("my-component");
  });

  test("child loggers with different components have different bindings", () => {
    const a = createLogger("alpha");
    const b = createLogger("beta");
    expect(a.bindings().component).toBe("alpha");
    expect(b.bindings().component).toBe("beta");
  });

  test("writes structured JSON to a writable stream", () => {
    const chunks: string[] = [];
    const stream = {
      write(chunk: string) {
        chunks.push(chunk);
        return true;
      },
    };
    const testRoot = pino({ level: "info" }, stream as any);
    const log = testRoot.child({ component: "json-test" });

    log.info({ event: "started", roomName: "room-abc" }, "test message");

    expect(chunks.length).toBe(1);
    const parsed = JSON.parse(chunks[0]);
    expect(parsed.level).toBe(30); // pino info level
    expect(parsed.component).toBe("json-test");
    expect(parsed.event).toBe("started");
    expect(parsed.roomName).toBe("room-abc");
    expect(parsed.msg).toBe("test message");
    expect(typeof parsed.time).toBe("number");
  });

  test("rootLogger is a pino instance", () => {
    expect(typeof rootLogger.info).toBe("function");
    expect(typeof rootLogger.child).toBe("function");
  });
});
