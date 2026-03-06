/**
 * Livekit Agent Ganglia
 *
 * A unified LiveKit Agents LLM plugin supporting OpenClaw and Nanoclaw backends.
 *
 * @example
 * ```typescript
 * import { createGanglia, createGangliaFromEnv, OpenClawLLM, NanoclawLLM } from '@knittt/livekit-agent-ganglia';
 *
 * // From explicit config (OpenClaw)
 * const llm = await createGanglia({
 *   type: 'openclaw',
 *   openclaw: { baseUrl: 'http://localhost:8080', apiKey: '...' },
 * });
 *
 * // From explicit config (Nanoclaw)
 * const llm = await createGanglia({
 *   type: 'nanoclaw',
 *   nanoclaw: { url: 'http://localhost:18789' },
 * });
 *
 * // From environment variables (GANGLIA_TYPE=openclaw|nanoclaw)
 * const llm = await createGangliaFromEnv();
 *
 * // Direct instantiation
 * const openclawLlm = new OpenClawLLM({ baseUrl: 'http://localhost:8080' });
 * const nanoclawLlm = new NanoclawLLM({ url: 'http://localhost:18789' });
 * ```
 */
export { noopLogger, type Logger } from './logger.js';
export type { GangliaConfig, GangliaSessionInfo, GangliaType, OpenClawConfig as GangliaOpenClawConfig, NanoclawConfig as GangliaNanoclawConfig, ConfigFor, } from './ganglia-types.js';
export { createGanglia, createGangliaFromEnv, registerGanglia, getRegisteredTypes, isGangliaAvailable, type GangliaLLM, } from './factory.js';
export type { GangliaEvent, StatusEvent, StatusAction, ArtifactEvent, ArtifactType, ContentEvent, DiffArtifact, CodeArtifact, FileArtifact, SearchResultsArtifact, ErrorArtifact, } from './events.js';
export { isStatusEvent, isArtifactEvent, isContentEvent, statusFromToolCall, toolToStatusAction, } from './events.js';
export { ToolInterceptor, createToolInterceptor, createReadFileArtifact, createEditArtifact, createSearchArtifact, createErrorArtifact, createArtifactFromToolResult, } from './tool-interceptor.js';
export type { ToolCall, ToolResult, ToolExecutor, EventEmitter, ToolInterceptorConfig, } from './tool-interceptor.js';
export { EventInterceptor, type EventInterceptorConfig } from './event-interceptor.js';
export { resolveSessionKey, resolveSessionKeySimple, type SessionKey, type SpeakerVerification, type SessionRoutingConfig, } from './session-routing.js';
import { OpenClawLLM } from './llm.js';
export { OpenClawLLM };
export { extractSessionFromContext } from './llm.js';
export { OpenClawClient, generateSessionId, buildSessionHeaders, buildMetadataHeaders, applySessionKey } from './client.js';
export * from './types/index.js';
import { NanoclawLLM } from './nanoclaw.js';
export { NanoclawLLM };
export { extractNanoclawSession } from './nanoclaw.js';
export { NanoclawClient, generateChannelJid, sessionKeyToChannel } from './nanoclaw-client.js';
export type { NanoclawChatOptions } from './nanoclaw-client.js';
/**
 * OpenClaw LLM namespace
 */
export declare const openclaw: {
    LLM: typeof OpenClawLLM;
};
/**
 * Nanoclaw LLM namespace
 */
export declare const nanoclaw: {
    LLM: typeof NanoclawLLM;
};
export default openclaw;
