/**
 * Mock PluginLogger for testing.
 */
import { mock } from "bun:test";

export interface MockLogger {
  info: ReturnType<typeof mock>;
  debug: ReturnType<typeof mock>;
  warn: ReturnType<typeof mock>;
  error: ReturnType<typeof mock>;

  // Test helpers
  _logs: Array<{ level: string; message: string; args: unknown[] }>;
  _clear: () => void;
}

export function createMockLogger(): MockLogger {
  const logs: Array<{ level: string; message: string; args: unknown[] }> = [];

  const createLogFn = (level: string) =>
    mock((message: string, ...args: unknown[]) => {
      logs.push({ level, message, args });
    });

  return {
    info: createLogFn("info"),
    debug: createLogFn("debug"),
    warn: createLogFn("warn"),
    error: createLogFn("error"),

    _logs: logs,
    _clear: () => {
      logs.length = 0;
    },
  };
}
