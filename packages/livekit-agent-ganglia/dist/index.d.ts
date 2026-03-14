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
export { noopLogger, type Logger } from './logger.js';
export type { GangliaConfig, GangliaSessionInfo, GangliaType, NanoclawConfig as GangliaNanoclawConfig, RelayConfig as GangliaRelayConfig, RelayRoom as GangliaRelayRoom, ConfigFor, } from './ganglia-types.js';
export { createGanglia, createGangliaFromEnv, registerGanglia, getRegisteredTypes, isGangliaAvailable, type GangliaLLM, } from './factory.js';
export type { GangliaEvent, StatusEvent, StatusAction, ArtifactEvent, ArtifactType, ContentEvent, DiffArtifact, CodeArtifact, FileArtifact, SearchResultsArtifact, ErrorArtifact, } from './events.js';
export { isStatusEvent, isArtifactEvent, isContentEvent, statusFromToolCall, toolToStatusAction, } from './events.js';
export { ToolInterceptor, createToolInterceptor, createReadFileArtifact, createEditArtifact, createSearchArtifact, createErrorArtifact, createArtifactFromToolResult, } from './tool-interceptor.js';
export type { ToolCall, ToolResult, ToolExecutor, EventEmitter, ToolInterceptorConfig, } from './tool-interceptor.js';
export { EventInterceptor, type EventInterceptorConfig } from './event-interceptor.js';
export { resolveSessionKey, resolveSessionKeySimple, type SessionKey, type SpeakerVerification, type SessionRoutingConfig, } from './session-routing.js';
import { NanoclawLLM } from './nanoclaw.js';
export { NanoclawLLM };
export { extractNanoclawSession } from './nanoclaw.js';
export { NanoclawClient, generateChannelJid, sessionKeyToChannel } from './nanoclaw-client.js';
export type { NanoclawChatOptions } from './nanoclaw-client.js';
import { RelayLLM } from './relay-llm.js';
export { RelayLLM };
export type { RelayConfig } from './ganglia-types.js';
export { DataChannelTransport, VOICE_ACP_TOPIC, type StreamTransport } from './relay-transport.js';
/**
 * Nanoclaw LLM namespace
 */
export declare const nanoclaw: {
    LLM: typeof NanoclawLLM;
};
/**
 * Relay LLM namespace (default backend)
 */
export declare const relay: {
    LLM: typeof RelayLLM;
};
export default relay;
