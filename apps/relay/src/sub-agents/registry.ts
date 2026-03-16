/**
 * Sub-agent provider registry.
 *
 * Follows the Ganglia factory pattern: backends register themselves,
 * and the relay bridge creates the appropriate provider based on acpCommand.
 */

import type { SubAgentProvider } from "./provider";
import type { Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

export interface SubAgentProviderOptions {
  /** ACP session ID from session/new. */
  sessionId: string;
  /** Working directory of the relay (used by Claude Code provider for path resolution). */
  cwd: string;
  /** Logger for structured output. */
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type ProviderFactory = (opts: SubAgentProviderOptions) => SubAgentProvider;

const registry = new Map<string, ProviderFactory>();

/**
 * Register a sub-agent provider factory for a given ACP command name.
 *
 * @example
 * ```ts
 * registerSubAgentProvider("claude", (opts) => new ClaudeCodeProvider(opts));
 * ```
 */
export function registerSubAgentProvider(
  name: string,
  factory: ProviderFactory,
): void {
  registry.set(name, factory);
}

/**
 * Create a sub-agent provider for the given ACP command.
 * Returns null if no provider is registered for the command.
 */
export function createSubAgentProvider(
  acpCommand: string,
  opts: SubAgentProviderOptions,
): SubAgentProvider | null {
  const factory = registry.get(acpCommand);
  if (!factory) return null;
  return factory(opts);
}

/** List registered provider names (for diagnostics). */
export function getRegisteredProviders(): string[] {
  return Array.from(registry.keys());
}
