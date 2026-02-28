import Debug from 'debug';

/**
 * Logger interface — compatible with console, pino, or any standard logger.
 * Libraries should accept this via config and default to noopLogger.
 */
export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/**
 * Silent no-op logger (default for libraries — be quiet unless told otherwise).
 */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * debug namespaces for verbose tracing.
 * Enable with DEBUG=ganglia:* or specific namespaces like DEBUG=ganglia:openclaw:stream
 */
export const dbg = {
  factory: Debug('ganglia:factory'),
  openclawStream: Debug('ganglia:openclaw:stream'),
  openclawClient: Debug('ganglia:openclaw:client'),
  nanoclawStream: Debug('ganglia:nanoclaw:stream'),
  nanoclawClient: Debug('ganglia:nanoclaw:client'),
};
