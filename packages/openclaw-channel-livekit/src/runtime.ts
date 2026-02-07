/**
 * Runtime storage for the LiveKit channel plugin.
 *
 * This module stores the OpenClaw plugin runtime for later access
 * by channel components that need to send messages or access config.
 */
import type { PluginRuntime, PluginLogger } from "./types.js";

let runtime: PluginRuntime | undefined;
let logger: PluginLogger | undefined;

/**
 * Store the plugin runtime for later access.
 * Called during plugin registration.
 */
export function setLivekitRuntime(r: PluginRuntime): void {
  runtime = r;
}

/**
 * Get the stored plugin runtime.
 * Throws if called before registration.
 */
export function getLivekitRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("LiveKit runtime not initialized. Was the plugin registered?");
  }
  return runtime;
}

/**
 * Store the plugin logger for later access.
 * Called during plugin registration.
 */
export function setLivekitLogger(l: PluginLogger): void {
  logger = l;
}

/**
 * Get the stored plugin logger.
 * Returns a no-op logger if not set.
 */
export function getLivekitLogger(): PluginLogger {
  if (!logger) {
    // Return a no-op logger if not set
    return {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
    };
  }
  return logger;
}

/**
 * Check if the runtime has been initialized.
 */
export function isRuntimeInitialized(): boolean {
  return runtime !== undefined;
}

/**
 * Clear the runtime (for testing).
 */
export function clearRuntime(): void {
  runtime = undefined;
  logger = undefined;
}
