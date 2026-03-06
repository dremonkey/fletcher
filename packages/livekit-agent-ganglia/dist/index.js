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
// Logging
export { noopLogger } from './logger.js';
// Factory
export { createGanglia, createGangliaFromEnv, registerGanglia, getRegisteredTypes, isGangliaAvailable, } from './factory.js';
export { isStatusEvent, isArtifactEvent, isContentEvent, statusFromToolCall, toolToStatusAction, } from './events.js';
// Tool Interception
export { ToolInterceptor, createToolInterceptor, createReadFileArtifact, createEditArtifact, createSearchArtifact, createErrorArtifact, createArtifactFromToolResult, } from './tool-interceptor.js';
// Event Interception (Protocol)
export { EventInterceptor } from './event-interceptor.js';
// Session Routing
export { resolveSessionKey, resolveSessionKeySimple, } from './session-routing.js';
// OpenClaw Implementation
import { OpenClawLLM } from './llm.js';
export { OpenClawLLM };
export { extractSessionFromContext } from './llm.js';
export { OpenClawClient, generateSessionId, buildSessionHeaders, buildMetadataHeaders, applySessionKey } from './client.js';
export * from './types/index.js';
// Nanoclaw Implementation
import { NanoclawLLM } from './nanoclaw.js';
export { NanoclawLLM };
export { extractNanoclawSession } from './nanoclaw.js';
export { NanoclawClient, generateChannelJid, sessionKeyToChannel } from './nanoclaw-client.js';
/**
 * OpenClaw LLM namespace
 */
export const openclaw = {
    LLM: OpenClawLLM,
};
/**
 * Nanoclaw LLM namespace
 */
export const nanoclaw = {
    LLM: NanoclawLLM,
};
export default openclaw;
