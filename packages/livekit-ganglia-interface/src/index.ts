/**
 * Livekit Ganglia Interface
 *
 * Shared interface for pluggable LLM backends in LiveKit voice agents.
 *
 * @example
 * ```typescript
 * import { createGanglia, createGangliaFromEnv } from '@anthropic/livekit-ganglia-interface';
 *
 * // From explicit config
 * const llm = await createGanglia({
 *   type: 'openclaw',
 *   openclaw: { endpoint: 'http://localhost:8080', token: '...' },
 * });
 *
 * // From environment variables
 * const llm = await createGangliaFromEnv();
 * ```
 */

// Types
export type {
  GangliaConfig,
  GangliaSessionInfo,
  GangliaType,
  OpenClawConfig,
  NanoclawConfig,
  ConfigFor,
} from './types.js';

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
