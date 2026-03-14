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
export { noopLogger, type Logger } from './logger.js';

// Ganglia Types
export type {
  GangliaConfig,
  GangliaSessionInfo,
  GangliaType,
  NanoclawConfig as GangliaNanoclawConfig,
  RelayConfig as GangliaRelayConfig,
  RelayRoom as GangliaRelayRoom,
  ConfigFor,
} from './ganglia-types.js';

// Factory
export {
  createGanglia,
  createGangliaFromEnv,
  registerGanglia,
  getRegisteredTypes,
  isGangliaAvailable,
  type GangliaLLM,
} from './factory.js';

// Events
export type {
  GangliaEvent,
  StatusEvent,
  StatusAction,
  ArtifactEvent,
  ArtifactType,
  ContentEvent,
  DiffArtifact,
  CodeArtifact,
  FileArtifact,
  SearchResultsArtifact,
  ErrorArtifact,
} from './events.js';

export {
  isStatusEvent,
  isArtifactEvent,
  isContentEvent,
  statusFromToolCall,
  toolToStatusAction,
} from './events.js';

// Tool Interception
export {
  ToolInterceptor,
  createToolInterceptor,
  createReadFileArtifact,
  createEditArtifact,
  createSearchArtifact,
  createErrorArtifact,
  createArtifactFromToolResult,
} from './tool-interceptor.js';

export type {
  ToolCall,
  ToolResult,
  ToolExecutor,
  EventEmitter,
  ToolInterceptorConfig,
} from './tool-interceptor.js';

// Event Interception (Protocol)
export { EventInterceptor, type EventInterceptorConfig } from './event-interceptor.js';

// Session Routing
export {
  resolveSessionKey,
  resolveSessionKeySimple,
  type SessionKey,
  type SpeakerVerification,
  type SessionRoutingConfig,
} from './session-routing.js';

// Nanoclaw Implementation
import { NanoclawLLM } from './nanoclaw.js';
export { NanoclawLLM };
export { extractNanoclawSession } from './nanoclaw.js';
export { NanoclawClient, generateChannelJid, sessionKeyToChannel } from './nanoclaw-client.js';
export type { NanoclawChatOptions } from './nanoclaw-client.js';

// Relay Implementation
import { RelayLLM } from './relay-llm.js';
export { RelayLLM };
export type { RelayConfig } from './ganglia-types.js';
export { DataChannelTransport, VOICE_ACP_TOPIC, type StreamTransport } from './relay-transport.js';

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
