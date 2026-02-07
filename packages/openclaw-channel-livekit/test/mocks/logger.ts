/**
 * Mock PluginLogger for testing.
 */
import { vi } from "vitest";

export interface MockLogger {
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;

  // Test helpers
  _logs: Array<{ level: string; message: string; args: unknown[] }>;
  _clear: () => void;
}

export function createMockLogger(): MockLogger {
  const logs: Array<{ level: string; message: string; args: unknown[] }> = [];

  const createLogFn = (level: string) =>
    vi.fn((message: string, ...args: unknown[]) => {
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
