/**
 * Sub-agent visibility — barrel export and provider registration.
 *
 * Import this module to register all built-in sub-agent providers.
 */

export type { SubAgentInfo, SubAgentStatus, SubAgentSnapshot } from "./types";
export type { SubAgentProvider, SubAgentUpdateCallback } from "./provider";
export {
  registerSubAgentProvider,
  createSubAgentProvider,
  getRegisteredProviders,
} from "./registry";
export type { SubAgentProviderOptions } from "./registry";

// ---------------------------------------------------------------------------
// Register built-in providers
// ---------------------------------------------------------------------------

import { registerSubAgentProvider } from "./registry";
import { ClaudeCodeProvider } from "./claude-code-provider";
import { OpenClawProvider } from "./openclaw-provider";

registerSubAgentProvider("claude", (opts) => new ClaudeCodeProvider(opts));
registerSubAgentProvider("openclaw", (opts) => new OpenClawProvider(opts));
