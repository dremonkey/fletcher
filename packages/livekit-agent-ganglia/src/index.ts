/**
 * Livekit Agent Ganglia
 *
 * A unified LiveKit Agents LLM plugin supporting OpenClaw and Nanoclaw backends.
 *
 * @example
 * ```typescript
 * import { createGanglia, createGangliaFromEnv, OpenClawLLM } from '@knittt/livekit-agent-ganglia';
 *
 * // From explicit config
 * const llm = await createGanglia({
 *   type: 'openclaw',
 *   openclaw: { endpoint: 'http://localhost:8080', token: '...' },
 * });
 *
 * // From environment variables
 * const llm = await createGangliaFromEnv();
 *
 * // Direct instantiation
 * const llm = new OpenClawLLM({ baseUrl: 'http://localhost:8080' });
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
export { OpenClawLLM } from './llm.js';
export { extractSessionFromContext } from './llm.js';
export { OpenClawClient, generateSessionId, buildSessionHeaders } from './client.js';
export * from './types/index.js';

/**
 * Default OpenClaw LLM instance
 */
export const openclaw = {
  LLM: OpenClawLLM,
};

export default openclaw;
