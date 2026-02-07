/**
 * LiveKit Voice Channel Plugin for OpenClaw.
 *
 * Provides real-time voice conversations with OpenClaw agents via LiveKit.
 * Target latency: <1.5 seconds glass-to-glass.
 */
import { LivekitConfigSchema } from "./config.js";
import { setLivekitRuntime, setLivekitLogger } from "./runtime.js";
import { livekitPlugin } from "./channel.js";
import type { PluginRuntime, PluginLogger } from "./types.js";

/**
 * OpenClaw Plugin API interface (minimal typing for registration).
 */
interface OpenClawPluginApi {
  runtime: PluginRuntime;
  logger: PluginLogger;
  registerChannel: (registration: { plugin: unknown }) => void;
}

/**
 * LiveKit channel plugin definition.
 */
const plugin = {
  id: "livekit",
  name: "LiveKit Voice",
  description: "Real-time voice conversations with <1.5s latency",
  configSchema: LivekitConfigSchema,

  /**
   * Register the plugin with OpenClaw.
   */
  register(api: OpenClawPluginApi): void {
    // Store runtime and logger for later access
    setLivekitRuntime(api.runtime);
    setLivekitLogger(api.logger);

    // Register the channel plugin
    api.registerChannel({ plugin: livekitPlugin });
  },
};

export default plugin;

// Re-export types for external use
export type {
  LivekitAccountConfig,
  LivekitChannelConfig,
  ResolvedLivekitAccount,
  STTConfig,
  TTSConfig,
  Speaker,
} from "./types.js";

export {
  listLivekitAccountIds,
  resolveLivekitAccount,
  isLivekitAccountConfigured,
} from "./config.js";
