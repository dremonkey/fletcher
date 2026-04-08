/**
 * Livekit Agent Ganglia
 *
 * A LiveKit Agents LLM plugin for the Relay backend (data channel bridge).
 *
 * @example
 * ```typescript
 * import { createGangliaFromEnv, RelayLLM } from '@knittt/livekit-agent-ganglia';
 *
 * // From environment variables (GANGLIA_TYPE=relay, the only option)
 * const llm = await createGangliaFromEnv({ room: ctx.room });
 *
 * // Direct instantiation
 * const relayLlm = new RelayLLM({ room, logger });
 * ```
 */

// Logging
export { noopLogger, type Logger } from './logger.js';

// Ganglia Types
export type {
  GangliaConfig,
  GangliaSessionInfo,
  GangliaType,
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

// Session Routing
export {
  resolveSessionKey,
  resolveSessionKeySimple,
  type SessionKey,
  type SpeakerVerification,
  type SessionRoutingConfig,
} from './session-routing.js';

// Relay Implementation
import { RelayLLM } from './relay-llm.js';
export { RelayLLM };
export type { RelayConfig } from './ganglia-types.js';
export { DataChannelTransport, VOICE_ACP_TOPIC, type StreamTransport } from './relay-transport.js';

// Pondering utilities
export { getShuffledPhrases } from './pondering.js';

/**
 * Relay LLM namespace (default backend)
 */
export const relay = {
  LLM: RelayLLM,
};

export default relay;
