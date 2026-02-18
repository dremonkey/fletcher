/**
 * Type definitions for the LiveKit channel plugin.
 */

/**
 * STT (Speech-to-Text) provider options.
 */
export type STTProvider = "deepgram";

/**
 * TTS (Text-to-Speech) provider options.
 */
export type TTSProvider = "cartesia" | "elevenlabs";

/**
 * DM policy for access control.
 */
export type DMPolicy = "open" | "allowlist" | "pairing";

/**
 * Deepgram STT configuration.
 */
export interface DeepgramConfig {
  model?: string;
  language?: string;
}

/**
 * Cartesia TTS configuration.
 */
export interface CartesiaConfig {
  voiceId: string;
  model?: string;
  speed?: number;
  emotion?: string;
}

/**
 * ElevenLabs TTS configuration.
 */
export interface ElevenLabsConfig {
  voiceId: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

/**
 * STT configuration section.
 */
export interface STTConfig {
  provider: STTProvider;
  apiKey?: string;
  deepgram?: DeepgramConfig;
}

/**
 * TTS configuration section.
 */
export interface TTSConfig {
  provider: TTSProvider;
  apiKey?: string;
  cartesia?: CartesiaConfig;
  elevenlabs?: ElevenLabsConfig;
}

/**
 * DM (Direct Message) policy configuration.
 */
export interface DMConfig {
  policy: DMPolicy;
  allowFrom?: string[];
}

/**
 * LiveKit channel account configuration (raw from config file).
 */
export interface LivekitAccountConfig {
  enabled?: boolean;
  url: string;
  apiKey: string;
  apiSecret: string;
  roomPrefix?: string;
  stt?: STTConfig;
  tts?: TTSConfig;
  dm?: DMConfig;
}

/**
 * Resolved LiveKit account with defaults applied.
 */
export interface ResolvedLivekitAccount {
  accountId: string;
  enabled: boolean;
  url: string;
  apiKey: string;
  apiSecret: string;
  roomPrefix: string;
  stt: {
    provider: STTProvider;
    apiKey?: string;
    deepgram: Required<DeepgramConfig>;
  };
  tts: {
    provider: TTSProvider;
    apiKey?: string;
    cartesia: Required<CartesiaConfig>;
    elevenlabs: Required<ElevenLabsConfig>;
  };
  dm: Required<DMConfig>;
}

/**
 * LiveKit channel configuration section.
 */
export interface LivekitChannelConfig {
  accounts?: Record<string, LivekitAccountConfig>;
  // Top-level defaults (legacy support)
  url?: string;
  apiKey?: string;
  apiSecret?: string;
  roomPrefix?: string;
  stt?: STTConfig;
  tts?: TTSConfig;
  dm?: DMConfig;
}

/**
 * Speaker information for message attribution.
 */
export interface Speaker {
  id: string;
  name?: string;
}

/**
 * Transcription result from STT.
 */
export interface TranscriptionResult {
  text: string;
  isFinal: boolean;
  speechFinal: boolean;
  speaker?: Speaker;
  confidence?: number;
}

/**
 * Active room session tracking.
 */
export interface RoomSession {
  roomId: string;
  conversationId: string;
  participants: Map<string, Speaker>;
  startedAt: Date;
}

import type { IncomingMessage, ServerResponse } from "http";

/**
 * HTTP Route definition for plugin API registration.
 */
export interface HttpRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

/**
 * OpenClaw Plugin API interface.
 */
export interface OpenClawPluginApi {
  runtime: PluginRuntime;
  logger: PluginLogger;
  registerChannel: (registration: { plugin: unknown }) => void;
  registerHttpRoute: (route: HttpRoute) => void;
}

/**
 * Plugin runtime interface (subset of what we use from OpenClaw).
 * This helps with type safety without depending on openclaw types directly.
 */
export interface PluginRuntime {
  gateway: {
    handleMessage: (message: {
      channel: string;
      conversationId: string;
      text: string;
      sender?: Speaker;
    }) => Promise<{ text?: string } | undefined>;
  };
  config: {
    loadConfig: () => Record<string, unknown>;
  };
}

/**
 * Plugin logger interface.
 */
export interface PluginLogger {
  info: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}
