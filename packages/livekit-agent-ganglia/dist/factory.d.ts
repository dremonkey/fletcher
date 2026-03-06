/**
 * Ganglia Factory
 *
 * Creates LLM instances based on configuration.
 * Both OpenClaw and Nanoclaw backends are included in this package.
 */
import type { llm } from '@livekit/agents';
import type { GangliaConfig, GangliaSessionInfo } from './ganglia-types.js';
import type { SessionKey } from './session-routing.js';
import { type Logger } from './logger.js';
/**
 * Extended LLM interface with session management.
 */
export interface GangliaLLM extends llm.LLM {
    /**
     * Sets the default session info (metadata) for all subsequent requests.
     */
    setDefaultSession?(session: GangliaSessionInfo): void;
    /**
     * Sets the session key for routing. This determines which backend
     * session the conversation routes to (owner/guest/room).
     */
    setSessionKey?(sessionKey: SessionKey): void;
    /**
     * Returns the backend type identifier.
     */
    gangliaType(): string;
}
/**
 * Registers a ganglia implementation.
 * Called by backend implementations to make themselves available.
 *
 * @example
 * ```typescript
 * // In llm.ts
 * import { registerGanglia } from './factory.js';
 * registerGanglia('openclaw', async () => OpenClawLLM);
 * ```
 */
export declare function registerGanglia(type: string, factory: () => Promise<new (config: any) => GangliaLLM>): void;
/**
 * Creates a ganglia LLM instance based on configuration.
 *
 * @example
 * ```typescript
 * const llm = await createGanglia({
 *   type: 'openclaw',
 *   openclaw: {
 *     baseUrl: 'http://localhost:8080',
 *     apiKey: process.env.OPENCLAW_API_KEY!,
 *   },
 * });
 * ```
 */
export declare function createGanglia(config: GangliaConfig): Promise<GangliaLLM>;
/**
 * Returns list of registered ganglia types.
 */
export declare function getRegisteredTypes(): string[];
/**
 * Checks if a ganglia type is registered or available.
 */
export declare function isGangliaAvailable(type: string): boolean;
/**
 * Creates a ganglia instance from environment variables.
 *
 * Reads:
 * - GANGLIA_TYPE (default: 'openclaw')
 * - OPENCLAW_GATEWAY_URL, OPENCLAW_API_KEY (for openclaw)
 * - NANOCLAW_URL (for nanoclaw)
 */
export declare function createGangliaFromEnv(opts?: {
    logger?: Logger;
    /** Callback for pondering status phrases while waiting for LLM first token. */
    onPondering?: (phrase: string | null, streamId: string) => void;
    /** Callback for each content chunk from the LLM stream. */
    onContent?: (delta: string, fullText: string, streamId: string) => void;
}): Promise<GangliaLLM>;
