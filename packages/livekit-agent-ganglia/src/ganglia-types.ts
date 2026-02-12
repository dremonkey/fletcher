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
 * OpenClaw backend configuration.
 */
export interface OpenClawConfig {
  /** Gateway endpoint URL (default: http://localhost:8080) */
  endpoint: string;
  /** API key for authentication */
  token: string;
}

/**
 * Nanoclaw backend configuration.
 */
export interface NanoclawConfig {
  /** API endpoint URL */
  url: string;
  /** Channel prefix for JID (default: lk) */
  channelPrefix?: string;
}

/**
 * Discriminated union for backend configuration.
 * Use `type` to determine which backend to instantiate.
 */
export type GangliaConfig =
  | { type: 'openclaw'; openclaw: OpenClawConfig }
  | { type: 'nanoclaw'; nanoclaw: NanoclawConfig };

/**
 * Backend type identifier.
 */
export type GangliaType = GangliaConfig['type'];

/**
 * Extract config type for a specific backend.
 */
export type ConfigFor<T extends GangliaType> = Extract<GangliaConfig, { type: T }>;
