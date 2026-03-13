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
export { noopLogger, type Logger } from './logger.js';

// Ganglia Types
export type {
  GangliaConfig,
  GangliaSessionInfo,
  GangliaType,
  AcpConfig as GangliaAcpConfig,
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

// ACP Implementation
import { AcpLLM } from './acp-llm.js';
export { AcpLLM };
export type { AcpConfig } from './ganglia-types.js';

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
