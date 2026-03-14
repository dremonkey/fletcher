/**
 * Livekit Agent Ganglia
 *
 * A unified LiveKit Agents LLM plugin supporting ACP and Nanoclaw backends.
 *
 * @example
 * ```typescript
 * import { createGanglia, createGangliaFromEnv, AcpLLM, NanoclawLLM } from '@knittt/livekit-agent-ganglia';
 *
 * // From explicit config (ACP — default)
 * const llm = await createGanglia({
 *   type: 'acp',
 *   acp: { command: 'openclaw', args: ['acp'] },
 * });
 *
 * // From explicit config (Nanoclaw)
 * const llm = await createGanglia({
 *   type: 'nanoclaw',
 *   nanoclaw: { url: 'http://localhost:18789' },
 * });
 *
 * // From environment variables (GANGLIA_TYPE=acp|nanoclaw)
 * const llm = await createGangliaFromEnv();
 *
 * // Direct instantiation
 * const acpLlm = new AcpLLM({ command: 'openclaw', args: ['acp'] });
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
// ACP Implementation
import { AcpLLM } from './acp-llm.js';
export { AcpLLM };
// Nanoclaw Implementation
import { NanoclawLLM } from './nanoclaw.js';
export { NanoclawLLM };
export { extractNanoclawSession } from './nanoclaw.js';
export { NanoclawClient, generateChannelJid, sessionKeyToChannel } from './nanoclaw-client.js';
// Relay Implementation
import { RelayLLM } from './relay-llm.js';
export { RelayLLM };
export { DataChannelTransport, VOICE_ACP_TOPIC } from './relay-transport.js';
/**
 * ACP LLM namespace (default backend)
 */
export const acp = {
    LLM: AcpLLM,
};
/**
 * Nanoclaw LLM namespace
 */
export const nanoclaw = {
    LLM: NanoclawLLM,
};
/**
 * Relay LLM namespace
 */
export const relay = {
    LLM: RelayLLM,
};
export default acp;
