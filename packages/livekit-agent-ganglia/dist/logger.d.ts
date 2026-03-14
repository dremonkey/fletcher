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
export declare const noopLogger: Logger;
/**
 * debug namespaces for verbose tracing.
 * Enable with DEBUG=ganglia:* or specific namespaces like DEBUG=ganglia:openclaw:stream
 */
export declare const dbg: {
    factory: Debug.Debugger;
    openclawStream: Debug.Debugger;
    openclawClient: Debug.Debugger;
    openresponses: Debug.Debugger;
    nanoclawStream: Debug.Debugger;
    nanoclawClient: Debug.Debugger;
    relayStream: Debug.Debugger;
    relayClient: Debug.Debugger;
};
