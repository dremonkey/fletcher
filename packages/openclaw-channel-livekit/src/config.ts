/**
 * Configuration schema for the LiveKit channel plugin.
 * Uses TypeBox for runtime validation.
 *
 * Configuration priority:
 * 1. OpenClaw config (channels.livekit.*)
 * 2. Environment variables (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
 */
import { Type, type Static } from "@sinclair/typebox";
import type {
  LivekitAccountConfig,
  LivekitChannelConfig,
  ResolvedLivekitAccount,
} from "./types.js";

/**
 * Default account ID when not using multi-account config.
 */
export const DEFAULT_ACCOUNT_ID = "default";

/**
 * Environment variable names for LiveKit credentials.
 */
export const ENV_VARS = {
  LIVEKIT_URL: "LIVEKIT_URL",
  LIVEKIT_API_KEY: "LIVEKIT_API_KEY",
  LIVEKIT_API_SECRET: "LIVEKIT_API_SECRET",
  DEEPGRAM_API_KEY: "DEEPGRAM_API_KEY",
  CARTESIA_API_KEY: "CARTESIA_API_KEY",
  ELEVENLABS_API_KEY: "ELEVENLABS_API_KEY",
} as const;

/**
 * Load LiveKit credentials from environment variables.
 */
export function loadEnvCredentials(): Partial<LivekitAccountConfig> {
  return {
    url: process.env[ENV_VARS.LIVEKIT_URL],
    apiKey: process.env[ENV_VARS.LIVEKIT_API_KEY],
    apiSecret: process.env[ENV_VARS.LIVEKIT_API_SECRET],
    stt: {
      provider: "deepgram",
      apiKey: process.env[ENV_VARS.DEEPGRAM_API_KEY],
    },
    tts: {
      provider: "cartesia",
      apiKey: process.env[ENV_VARS.CARTESIA_API_KEY],
    },
  };
}

/**
 * Check if required environment variables are set.
 */
export function hasEnvCredentials(): boolean {
  return Boolean(
    process.env[ENV_VARS.LIVEKIT_URL] &&
    process.env[ENV_VARS.LIVEKIT_API_KEY] &&
    process.env[ENV_VARS.LIVEKIT_API_SECRET]
  );
}

/**
 * Deepgram STT configuration schema.
 */
const DeepgramConfigSchema = Type.Object({
  model: Type.Optional(Type.String({ default: "nova-3" })),
  language: Type.Optional(Type.String({ default: "en" })),
});

/**
 * Cartesia TTS configuration schema.
 */
const CartesiaConfigSchema = Type.Object({
  voiceId: Type.String(),
  model: Type.Optional(Type.String({ default: "sonic-3" })),
  speed: Type.Optional(Type.Number({ default: 1.0, minimum: 0.5, maximum: 2.0 })),
  emotion: Type.Optional(Type.String({ default: "neutral" })),
});

/**
 * ElevenLabs TTS configuration schema.
 */
const ElevenLabsConfigSchema = Type.Object({
  voiceId: Type.String(),
  model: Type.Optional(Type.String({ default: "eleven_turbo_v2_5" })),
  stability: Type.Optional(Type.Number({ default: 0.5, minimum: 0, maximum: 1 })),
  similarityBoost: Type.Optional(Type.Number({ default: 0.75, minimum: 0, maximum: 1 })),
  style: Type.Optional(Type.Number({ default: 0.0, minimum: 0, maximum: 1 })),
  useSpeakerBoost: Type.Optional(Type.Boolean({ default: true })),
});

/**
 * STT configuration schema.
 */
const STTConfigSchema = Type.Object({
  provider: Type.Literal("deepgram", { default: "deepgram" }),
  apiKey: Type.Optional(Type.String()),
  deepgram: Type.Optional(DeepgramConfigSchema),
});

/**
 * TTS configuration schema.
 */
const TTSConfigSchema = Type.Object({
  provider: Type.Union([Type.Literal("cartesia"), Type.Literal("elevenlabs")], {
    default: "cartesia",
  }),
  apiKey: Type.Optional(Type.String()),
  cartesia: Type.Optional(CartesiaConfigSchema),
  elevenlabs: Type.Optional(ElevenLabsConfigSchema),
});

/**
 * DM policy configuration schema.
 */
const DMConfigSchema = Type.Object({
  policy: Type.Union(
    [Type.Literal("open"), Type.Literal("allowlist"), Type.Literal("pairing")],
    { default: "pairing" }
  ),
  allowFrom: Type.Optional(Type.Array(Type.String())),
});

/**
 * LiveKit account configuration schema.
 */
const LivekitAccountConfigSchema = Type.Object({
  enabled: Type.Optional(Type.Boolean({ default: true })),
  url: Type.String({ description: "LiveKit server URL (e.g., wss://your-livekit.com)" }),
  apiKey: Type.String({ description: "LiveKit API key" }),
  apiSecret: Type.String({ description: "LiveKit API secret" }),
  roomPrefix: Type.Optional(Type.String({ default: "openclaw-" })),
  stt: Type.Optional(STTConfigSchema),
  tts: Type.Optional(TTSConfigSchema),
  dm: Type.Optional(DMConfigSchema),
});

/**
 * Full LiveKit channel configuration schema.
 */
export const LivekitConfigSchema = Type.Object({
  accounts: Type.Optional(Type.Record(Type.String(), LivekitAccountConfigSchema)),
  // Top-level defaults
  url: Type.Optional(Type.String()),
  apiKey: Type.Optional(Type.String()),
  apiSecret: Type.Optional(Type.String()),
  roomPrefix: Type.Optional(Type.String()),
  stt: Type.Optional(STTConfigSchema),
  tts: Type.Optional(TTSConfigSchema),
  dm: Type.Optional(DMConfigSchema),
});

export type LivekitConfigSchemaType = Static<typeof LivekitConfigSchema>;

/**
 * Default configuration values.
 */
const DEFAULTS = {
  roomPrefix: "openclaw-",
  stt: {
    provider: "deepgram" as const,
    deepgram: {
      model: "nova-3",
      language: "en",
    },
  },
  tts: {
    provider: "cartesia" as const,
    cartesia: {
      voiceId: "", // Must be provided by user
      model: "sonic-3",
      speed: 1.0,
      emotion: "neutral",
    },
    elevenlabs: {
      voiceId: "", // Must be provided by user
      model: "eleven_turbo_v2_5",
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.0,
      useSpeakerBoost: true,
    },
  },
  dm: {
    policy: "pairing" as const,
    allowFrom: [] as string[],
  },
};

/**
 * List all account IDs from the configuration.
 */
export function listLivekitAccountIds(cfg: { channels?: { livekit?: LivekitChannelConfig } }): string[] {
  const livekitConfig = cfg.channels?.livekit;

  // If accounts section exists, return those IDs
  if (livekitConfig?.accounts) {
    return Object.keys(livekitConfig.accounts);
  }

  // Check if top-level config exists (legacy single-account mode)
  if (livekitConfig?.url && livekitConfig.apiKey) {
    return [DEFAULT_ACCOUNT_ID];
  }

  // Fall back to environment variables
  if (hasEnvCredentials()) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return [];
}

/**
 * Resolve a LiveKit account configuration with defaults applied.
 * Falls back to environment variables if no config is provided.
 */
export function resolveLivekitAccount(params: {
  cfg: { channels?: { livekit?: LivekitChannelConfig } };
  accountId?: string;
}): ResolvedLivekitAccount {
  const { cfg, accountId = DEFAULT_ACCOUNT_ID } = params;
  const livekitConfig = cfg.channels?.livekit;
  const envCredentials = loadEnvCredentials();

  // Get account-specific config or fall back to top-level, then env vars
  let accountConfig: LivekitAccountConfig | undefined =
    livekitConfig?.accounts?.[accountId] ??
    (accountId === DEFAULT_ACCOUNT_ID && livekitConfig
      ? {
          url: livekitConfig.url ?? "",
          apiKey: livekitConfig.apiKey ?? "",
          apiSecret: livekitConfig.apiSecret ?? "",
          roomPrefix: livekitConfig.roomPrefix,
          stt: livekitConfig.stt,
          tts: livekitConfig.tts,
          dm: livekitConfig.dm,
        }
      : undefined);

  // Fall back to environment variables for default account
  if (!accountConfig && accountId === DEFAULT_ACCOUNT_ID && hasEnvCredentials()) {
    accountConfig = {
      url: envCredentials.url!,
      apiKey: envCredentials.apiKey!,
      apiSecret: envCredentials.apiSecret!,
      stt: envCredentials.stt,
      tts: envCredentials.tts,
    };
  }

  if (!accountConfig) {
    throw new Error(`LiveKit account "${accountId}" not found. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET environment variables.`);
  }

  // Merge env credentials as fallback for API keys
  const sttApiKey = accountConfig.stt?.apiKey ?? envCredentials.stt?.apiKey;
  const ttsApiKey = accountConfig.tts?.apiKey ?? envCredentials.tts?.apiKey;

  // Merge with defaults
  return {
    accountId,
    enabled: accountConfig.enabled ?? true,
    url: accountConfig.url,
    apiKey: accountConfig.apiKey,
    apiSecret: accountConfig.apiSecret,
    roomPrefix: accountConfig.roomPrefix ?? DEFAULTS.roomPrefix,
    stt: {
      provider: accountConfig.stt?.provider ?? DEFAULTS.stt.provider,
      apiKey: sttApiKey,
      deepgram: {
        model: accountConfig.stt?.deepgram?.model ?? DEFAULTS.stt.deepgram.model,
        language: accountConfig.stt?.deepgram?.language ?? DEFAULTS.stt.deepgram.language,
      },
    },
    tts: {
      provider: accountConfig.tts?.provider ?? DEFAULTS.tts.provider,
      apiKey: ttsApiKey,
      cartesia: {
        voiceId: accountConfig.tts?.cartesia?.voiceId ?? DEFAULTS.tts.cartesia.voiceId,
        model: accountConfig.tts?.cartesia?.model ?? DEFAULTS.tts.cartesia.model,
        speed: accountConfig.tts?.cartesia?.speed ?? DEFAULTS.tts.cartesia.speed,
        emotion: accountConfig.tts?.cartesia?.emotion ?? DEFAULTS.tts.cartesia.emotion,
      },
      elevenlabs: {
        voiceId: accountConfig.tts?.elevenlabs?.voiceId ?? DEFAULTS.tts.elevenlabs.voiceId,
        model: accountConfig.tts?.elevenlabs?.model ?? DEFAULTS.tts.elevenlabs.model,
        stability: accountConfig.tts?.elevenlabs?.stability ?? DEFAULTS.tts.elevenlabs.stability,
        similarityBoost:
          accountConfig.tts?.elevenlabs?.similarityBoost ?? DEFAULTS.tts.elevenlabs.similarityBoost,
        style: accountConfig.tts?.elevenlabs?.style ?? DEFAULTS.tts.elevenlabs.style,
        useSpeakerBoost:
          accountConfig.tts?.elevenlabs?.useSpeakerBoost ?? DEFAULTS.tts.elevenlabs.useSpeakerBoost,
      },
    },
    dm: {
      policy: accountConfig.dm?.policy ?? DEFAULTS.dm.policy,
      allowFrom: accountConfig.dm?.allowFrom ?? DEFAULTS.dm.allowFrom,
    },
  };
}

/**
 * Get the default account ID for the LiveKit channel.
 */
export function getDefaultLivekitAccountId(cfg: {
  channels?: { livekit?: LivekitChannelConfig };
}): string {
  const accountIds = listLivekitAccountIds(cfg);
  return accountIds[0] ?? DEFAULT_ACCOUNT_ID;
}

/**
 * Check if an account is properly configured.
 */
export function isLivekitAccountConfigured(account: ResolvedLivekitAccount): boolean {
  return Boolean(account.url && account.apiKey && account.apiSecret);
}

/**
 * Describe an account for status reporting.
 */
export function describeLivekitAccount(account: ResolvedLivekitAccount) {
  return {
    accountId: account.accountId,
    enabled: account.enabled,
    configured: isLivekitAccountConfigured(account),
    url: account.url ? new URL(account.url).host : undefined,
    sttProvider: account.stt.provider,
    ttsProvider: account.tts.provider,
  };
}
