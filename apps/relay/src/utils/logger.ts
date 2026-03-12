/**
 * Minimal structured JSON logger.
 *
 * Outputs one JSON line per log call to stdout/stderr.
 * No dependencies — just JSON.stringify to console.
 */

export interface Logger {
  info(data: Record<string, unknown>): void;
  warn(data: Record<string, unknown>): void;
  error(data: Record<string, unknown>): void;
}

export function createLogger(component: string): Logger {
  return {
    info(data) {
      console.log(
        JSON.stringify({ level: "info", component, ts: Date.now(), ...data }),
      );
    },
    warn(data) {
      console.warn(
        JSON.stringify({ level: "warn", component, ts: Date.now(), ...data }),
      );
    },
    error(data) {
      console.error(
        JSON.stringify({ level: "error", component, ts: Date.now(), ...data }),
      );
    },
  };
}
