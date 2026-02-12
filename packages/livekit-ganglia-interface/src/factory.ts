/**
 * Ganglia Factory
 *
 * Creates LLM instances based on configuration.
 * Dynamically imports the appropriate backend package.
 */

import type { llm } from '@livekit/agents';
import type { GangliaConfig, GangliaSessionInfo } from './types.js';

/**
 * Extended LLM interface with session management.
 */
export interface GangliaLLM extends llm.LLM {
  /**
   * Sets the default session info for all subsequent requests.
   */
  setDefaultSession?(session: GangliaSessionInfo): void;

  /**
   * Returns the backend type identifier.
   */
  gangliaType(): string;
}

/**
 * Registry of ganglia implementations.
 * Packages register themselves here when imported.
 */
const registry = new Map<string, () => Promise<new (config: any) => GangliaLLM>>();

/**
 * Registers a ganglia implementation.
 * Called by backend packages to make themselves available.
 *
 * @example
 * ```typescript
 * // In livekit-agent-openclaw/src/index.ts
 * import { registerGanglia } from '@knittt/livekit-ganglia-interface';
 * registerGanglia('openclaw', async () => {
 *   const { OpenClawLLM } = await import('./llm.js');
 *   return OpenClawLLM;
 * });
 * ```
 */
export function registerGanglia(
  type: string,
  factory: () => Promise<new (config: any) => GangliaLLM>,
): void {
  registry.set(type, factory);
}

/**
 * Creates a ganglia LLM instance based on configuration.
 *
 * @example
 * ```typescript
 * const llm = await createGanglia({
 *   type: 'openclaw',
 *   openclaw: {
 *     endpoint: 'http://localhost:8080',
 *     token: process.env.OPENCLAW_API_KEY!,
 *   },
 * });
 * ```
 */
export async function createGanglia(config: GangliaConfig): Promise<GangliaLLM> {
  const factory = registry.get(config.type);

  if (!factory) {
    // Try dynamic import as fallback
    const llmClass = await tryDynamicImport(config.type);
    if (!llmClass) {
      throw new Error(
        `Unknown ganglia type: ${config.type}. ` +
          `Available types: ${Array.from(registry.keys()).join(', ') || 'none registered'}. ` +
          `Make sure to import the backend package before calling createGanglia().`,
      );
    }
    return new llmClass(config[config.type as keyof typeof config]);
  }

  const LLMClass = await factory();
  return new LLMClass(config[config.type as keyof typeof config]);
}

/**
 * Attempts to dynamically import a ganglia backend package.
 */
async function tryDynamicImport(
  type: string,
): Promise<(new (config: any) => GangliaLLM) | null> {
  const packageNames: Record<string, string> = {
    openclaw: '@knittt/livekit-agent-openclaw',
    nanoclaw: '@knittt/livekit-agent-nanoclaw',
  };

  const packageName = packageNames[type];
  if (!packageName) return null;

  try {
    const module = await import(packageName);
    // Look for the LLM class - try common export patterns
    return (
      module.default?.LLM ||
      module.LLM ||
      module[`${type.charAt(0).toUpperCase()}${type.slice(1)}LLM`] ||
      null
    );
  } catch {
    // Package not installed
    return null;
  }
}

/**
 * Returns list of registered ganglia types.
 */
export function getRegisteredTypes(): string[] {
  return Array.from(registry.keys());
}

/**
 * Checks if a ganglia type is registered or available.
 */
export function isGangliaAvailable(type: string): boolean {
  return registry.has(type);
}

/**
 * Creates a ganglia instance from environment variables.
 *
 * Reads:
 * - GANGLIA_TYPE (default: 'openclaw')
 * - OPENCLAW_GATEWAY_URL, OPENCLAW_API_KEY (for openclaw)
 * - NANOCLAW_URL (for nanoclaw)
 */
export async function createGangliaFromEnv(): Promise<GangliaLLM> {
  const type = (process.env.GANGLIA_TYPE || process.env.BRAIN_TYPE || 'openclaw') as GangliaConfig['type'];

  if (type === 'openclaw') {
    return createGanglia({
      type: 'openclaw',
      openclaw: {
        endpoint: process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:8080',
        token: process.env.OPENCLAW_API_KEY || '',
      },
    });
  }

  if (type === 'nanoclaw') {
    return createGanglia({
      type: 'nanoclaw',
      nanoclaw: {
        url: process.env.NANOCLAW_URL || 'http://localhost:3000',
        channelPrefix: process.env.NANOCLAW_CHANNEL_PREFIX || 'lk',
      },
    });
  }

  throw new Error(`Unknown GANGLIA_TYPE: ${type}`);
}
