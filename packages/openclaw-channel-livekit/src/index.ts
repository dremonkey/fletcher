/**
 * LiveKit Voice Channel Plugin for OpenClaw.
 *
 * Provides real-time voice conversations with OpenClaw agents via LiveKit.
 * Target latency: <1.5 seconds glass-to-glass.
 */
import { LivekitConfigSchema } from "./config.js";
import { setLivekitRuntime, setLivekitLogger } from "./runtime.js";
import { livekitPlugin } from "./channel.js";
import { handleTokenRequest } from "./auth.js";
import type { OpenClawPluginApi } from "./types.js";

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

    // Register token generation route (Sovereign Pairing)
    api.registerHttpRoute({
      method: "POST",
      path: "/fletcher/token",
      handler: handleTokenRequest,
    });
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

export { VoiceAgent } from "./livekit/audio.js";
export type { VoiceAgentConfig } from "./livekit/audio.js";

export {
  listLivekitAccountIds,
  resolveLivekitAccount,
  isLivekitAccountConfigured,
} from "./config.js";
