/**
 * Ganglia Factory
 *
 * Creates LLM instances based on configuration.
 * ACP (JSON-RPC 2.0 over stdio) and Nanoclaw backends are included in this package.
 */
import { noopLogger, dbg } from './logger.js';
/**
 * Registry of ganglia implementations.
 * Packages register themselves here when imported.
 */
const registry = new Map();
/**
 * Registers a ganglia implementation.
 * Called by backend implementations to make themselves available.
 *
 * @example
 * ```typescript
 * // In acp-llm.ts
 * import { registerGanglia } from './factory.js';
 * registerGanglia('acp', async () => AcpLLM);
 * ```
 */
export function registerGanglia(type, factory) {
    registry.set(type, factory);
}
/**
 * Creates a ganglia LLM instance based on configuration.
 *
 * @example
 * ```typescript
 * const llm = await createGanglia({
 *   type: 'acp',
 *   acp: {
 *     command: 'openclaw',
 *     args: ['acp'],
 *   },
 * });
 * ```
 */
export async function createGanglia(config) {
    const factory = registry.get(config.type);
    if (!factory) {
        throw new Error(`Unknown ganglia type: ${config.type}. ` +
            `Available types: ${Array.from(registry.keys()).join(', ') || 'none registered'}. ` +
            `Make sure the backend is registered before calling createGanglia().`);
    }
    const LLMClass = await factory();
    return new LLMClass(config[config.type]);
}
/**
 * Returns list of registered ganglia types.
 */
export function getRegisteredTypes() {
    return Array.from(registry.keys());
}
/**
 * Checks if a ganglia type is registered or available.
 */
export function isGangliaAvailable(type) {
    return registry.has(type);
}
/**
 * Creates a ganglia instance from environment variables.
 *
 * Reads:
 * - GANGLIA_TYPE (default: 'acp')
 * - ACP_COMMAND (default: 'openclaw'), ACP_ARGS (default: 'acp'), ACP_PROMPT_TIMEOUT_MS (for acp)
 * - NANOCLAW_URL (for nanoclaw)
 */
export async function createGangliaFromEnv(opts) {
    const logger = opts?.logger || noopLogger;
    const type = (process.env.GANGLIA_TYPE || process.env.BRAIN_TYPE || 'acp');
    dbg.factory('createGangliaFromEnv: GANGLIA_TYPE=%s BRAIN_TYPE=%s resolved=%s', process.env.GANGLIA_TYPE, process.env.BRAIN_TYPE, type);
    dbg.factory('registered types: %s', Array.from(registry.keys()).join(', ') || 'none');
    if (type === 'acp') {
        const command = process.env.ACP_COMMAND || 'openclaw';
        const argsRaw = process.env.ACP_ARGS || 'acp';
        const args = argsRaw.split(',').map((a) => a.trim()).filter(Boolean);
        const promptTimeoutMs = process.env.ACP_PROMPT_TIMEOUT_MS
            ? parseInt(process.env.ACP_PROMPT_TIMEOUT_MS, 10)
            : undefined;
        dbg.factory('creating acp: command=%s args=%o promptTimeoutMs=%s', command, args, promptTimeoutMs);
        logger.info(`Creating ganglia backend: acp (command: ${command} ${args.join(' ')})`);
        return createGanglia({
            type: 'acp',
            acp: {
                command,
                args,
                promptTimeoutMs,
                logger,
                onPondering: opts?.onPondering,
                onContent: opts?.onContent,
            },
        });
    }
    if (type === 'relay') {
        if (!opts?.room) {
            throw new Error('GANGLIA_TYPE=relay requires a room in opts. ' +
                'Pass { room: ctx.room } to createGangliaFromEnv().');
        }
        dbg.factory('creating relay: room=%s', opts.room?.name ?? '(unknown)');
        logger.info('Creating ganglia backend: relay');
        return createGanglia({
            type: 'relay',
            relay: {
                room: opts.room,
                logger,
                onPondering: opts?.onPondering,
                onContent: opts?.onContent,
            },
        });
    }
    if (type === 'nanoclaw') {
        const url = process.env.NANOCLAW_URL || 'http://localhost:18789';
        const prefix = process.env.NANOCLAW_CHANNEL_PREFIX || 'lk';
        dbg.factory('creating nanoclaw: url=%s channelPrefix=%s', url, prefix);
        logger.info(`Creating ganglia backend: nanoclaw (${url})`);
        return createGanglia({
            type: 'nanoclaw',
            nanoclaw: {
                url,
                channelPrefix: prefix,
                logger,
            },
        });
    }
    throw new Error(`Unknown GANGLIA_TYPE: ${type}`);
}
