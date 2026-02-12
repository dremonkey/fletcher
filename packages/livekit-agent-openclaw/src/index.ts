import { OpenClawLLM } from './llm.js';

// Re-export ganglia interface for convenience
export {
  createGanglia,
  createGangliaFromEnv,
  type GangliaLLM,
  type GangliaConfig,
  type GangliaSessionInfo,
} from '@anthropic/livekit-ganglia-interface';

export { OpenClawLLM };
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
