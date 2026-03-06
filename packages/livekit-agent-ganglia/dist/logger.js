import Debug from 'debug';
/**
 * Silent no-op logger (default for libraries — be quiet unless told otherwise).
 */
export const noopLogger = {
    debug() { },
    info() { },
    warn() { },
    error() { },
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
