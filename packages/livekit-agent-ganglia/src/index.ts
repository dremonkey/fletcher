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
 *   openclaw: { endpoint: 'http://localhost:8080', token: '...' },
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

// Ganglia Types
export type {
  GangliaConfig,
  GangliaSessionInfo,
  GangliaType,
  OpenClawConfig as GangliaOpenClawConfig,
  NanoclawConfig as GangliaNanoclawConfig,
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

// OpenClaw Implementation
import { OpenClawLLM } from './llm.js';
export { OpenClawLLM };
export { extractSessionFromContext } from './llm.js';
export { OpenClawClient, generateSessionId, buildSessionHeaders } from './client.js';
export * from './types/index.js';

// Nanoclaw Implementation
import { NanoclawLLM } from './nanoclaw.js';
export { NanoclawLLM };
export { extractNanoclawSession } from './nanoclaw.js';
export { NanoclawClient, generateChannelJid } from './nanoclaw-client.js';
export type { NanoclawChatOptions } from './nanoclaw-client.js';

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
