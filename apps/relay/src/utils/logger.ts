/**
 * Pino-based structured logger.
 *
 * JSON output in production, pretty-printed in local dev.
 * Set LOG_LEVEL env var to control verbosity (default: "info").
 */

import pino from "pino";

const isLocalDev =
  process.env.NODE_ENV !== "production" && !process.env.CI;

export const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(isLocalDev
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

export type Logger = pino.Logger;

/**
 * Create a child logger scoped to a component.
 *
 * Usage:
 *   const log = createLogger("relay-bridge");
 *   log.info({ event: "room_joined", roomName }, "joined room");
 */
export function createLogger(component: string): Logger {
  return rootLogger.child({ component });
}
