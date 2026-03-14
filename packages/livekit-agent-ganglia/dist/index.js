/**
 * Livekit Agent Ganglia
 *
 * A unified LiveKit Agents LLM plugin supporting Relay and Nanoclaw backends.
 *
 * @example
 * ```typescript
 * import { createGangliaFromEnv, RelayLLM, NanoclawLLM } from '@knittt/livekit-agent-ganglia';
 *
 * // From environment variables (GANGLIA_TYPE=relay|nanoclaw)
 * const llm = await createGangliaFromEnv({ room: ctx.room });
 *
 * // Direct instantiation
 * const relayLlm = new RelayLLM({ room, logger });
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
 * Nanoclaw LLM namespace
 */
export const nanoclaw = {
    LLM: NanoclawLLM,
};
/**
 * Relay LLM namespace (default backend)
 */
export const relay = {
    LLM: RelayLLM,
};
export default relay;
