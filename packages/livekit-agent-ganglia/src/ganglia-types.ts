/**
 * Ganglia Interface Types
 *
 * Shared types for pluggable LLM backends in LiveKit voice agents.
 * Named after the distributed nerve clusters in lobsters - because
 * we're connecting multiple "brains" to a single voice interface.
 */

/**
 * Session information extracted from LiveKit for context continuity.
 * Passed to the LLM backend for session tracking.
 */
export interface GangliaSessionInfo {
  /** LiveKit room SID (unique identifier for the room instance) */
  roomSid?: string;
  /** LiveKit room name (human-readable room identifier) */
  roomName?: string;
  /** LiveKit participant identity (unique identifier for the participant) */
  participantIdentity?: string;
  /** LiveKit participant SID (unique session identifier for the participant) */
  participantSid?: string;
  /** Custom session ID to override auto-generated session mapping */
  customSessionId?: string;
}

/**
 * ACP backend configuration.
 *
 * Connects to an OpenClaw ACP agent subprocess via JSON-RPC 2.0 over stdio.
 * This is the default backend (GANGLIA_TYPE=acp).
 */
export interface AcpConfig {
  /** ACP subprocess command (e.g., "openclaw"). */
  command: string;
  /** ACP subprocess arguments (e.g., ["acp"]). */
  args?: string[];
  /** Additional environment variables for the subprocess. */
  env?: Record<string, string>;
  /** Prompt timeout in ms (default: 120000). Override via ACP_PROMPT_TIMEOUT_MS env var. */
  promptTimeoutMs?: number;
  /** Optional logger for production-level logging (defaults to silent). */
  logger?: import('./logger.js').Logger;
  /** Callback emitted while waiting for first content token. Called with null when content starts. */
  onPondering?: (phrase: string | null, streamId: string) => void;
  /** Callback emitted for each content-bearing chunk from the ACP stream. */
  onContent?: (delta: string, fullText: string, streamId: string) => void;
}

/**
 * Nanoclaw backend configuration.
 */
export interface NanoclawConfig {
  /** API endpoint URL */
  url: string;
  /** Channel prefix for JID (default: lk) */
  channelPrefix?: string;
  /** Optional logger for production-level logging (defaults to silent) */
  logger?: import('./logger.js').Logger;
  /** Controls how much conversation history to send. Default: 'full' */
  historyMode?: 'full' | 'latest';
}

/**
 * Discriminated union for backend configuration.
 * Use `type` to determine which backend to instantiate.
 */
export type GangliaConfig =
  | { type: 'acp'; acp: AcpConfig; logger?: import('./logger.js').Logger }
  | { type: 'nanoclaw'; nanoclaw: NanoclawConfig; logger?: import('./logger.js').Logger };

/**
 * Backend type identifier.
 */
export type GangliaType = GangliaConfig['type'];

/**
 * Extract config type for a specific backend.
 */
export type ConfigFor<T extends GangliaType> = Extract<GangliaConfig, { type: T }>;
