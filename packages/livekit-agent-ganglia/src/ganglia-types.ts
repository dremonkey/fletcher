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
 * Minimal interface for a LiveKit Room as needed by RelayLLM.
 *
 * Using a structural interface rather than importing @livekit/rtc-node directly
 * keeps this package's dependency tree clean. Any object satisfying this
 * interface (including test mocks) will work.
 */
export interface RelayRoom {
  /** Local participant — used to publish data channel messages. */
  localParticipant: {
    publishData(data: Uint8Array, opts?: { topic?: string; reliable?: boolean }): Promise<void>;
  };
  /** Remote participants — used to locate the relay-* agent. */
  remoteParticipants: Map<string, { identity: string }>;
  /** Room event emitter — used to subscribe to DataReceived events. */
  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
}

/**
 * Relay backend configuration.
 *
 * Routes LLM requests through the LiveKit data channel to a relay participant.
 * This is the voice-agent-side half of the relay-mediated LLM backend.
 * Use GANGLIA_TYPE=relay to activate this backend.
 */
export interface RelayConfig {
  /** LiveKit Room reference for data channel communication. */
  room: RelayRoom;
  /** Prompt timeout in ms (default: 120000). */
  promptTimeoutMs?: number;
  /** Optional logger for production-level logging (defaults to silent). */
  logger?: import('./logger.js').Logger;
  /** Callback emitted while waiting for first content token. Called with null when content starts. */
  onPondering?: (phrase: string | null, streamId: string) => void;
  /** Callback emitted for each content-bearing chunk from the relay stream. */
  onContent?: (delta: string, fullText: string, streamId: string) => void;
}

/**
 * Discriminated union for backend configuration.
 * Use `type` to determine which backend to instantiate.
 */
export type GangliaConfig =
  | { type: 'relay'; relay: RelayConfig; logger?: import('./logger.js').Logger };

/**
 * Backend type identifier.
 */
export type GangliaType = GangliaConfig['type'];

/**
 * Extract config type for a specific backend.
 */
export type ConfigFor<T extends GangliaType> = Extract<GangliaConfig, { type: T }>;
