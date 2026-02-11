import { OpenClawLLM } from './llm.js';

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
