export interface OpenClawConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** Default session info to use if not provided per-request */
  defaultSession?: LiveKitSessionInfo;
  /** Optional logger for production-level logging (defaults to silent) */
  logger?: import('../logger.js').Logger;
  /**
   * Callback emitted while waiting for the first content token from the LLM.
   * Receives a fun "pondering" phrase that rotates every few seconds.
   * Called with `null` when content starts (clear the status).
   *
   * @param phrase - The pondering phrase, or `null` when content starts / stream ends
   * @param streamId - Unique identifier for the LLM stream instance
   */
  onPondering?: (phrase: string | null, streamId: string) => void;
  /**
   * Callback emitted for each content-bearing chunk from the LLM stream.
   * Bypasses the SDK's transcription pipeline — use this to forward text
   * directly to the client (e.g. via data channel).
   *
   * @param delta - The text delta from this chunk
   * @param fullText - Accumulated full text so far
   * @param streamId - Unique identifier for the LLM stream instance
   */
  onContent?: (delta: string, fullText: string, streamId: string) => void;
  /** Controls how much conversation history to send. Default: 'latest' */
  historyMode?: 'full' | 'latest';
}

/**
 * LiveKit session identifiers mapped to OpenClaw session headers.
 * Used to maintain persistent conversation state across requests.
 */
export interface LiveKitSessionInfo {
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

export interface OpenClawMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  tool_calls?: OpenClawToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenClawToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenClawChatOptions {
  messages: OpenClawMessage[];
  stream?: boolean;
  tools?: any[];
  tool_choice?: any;
  /** @deprecated Use session instead */
  sessionId?: string;
  /** LiveKit session info — used for metadata headers (Room-SID, Participant-Identity, etc.) */
  session?: LiveKitSessionInfo;
  /** Resolved session key for routing. Takes priority over session/sessionId for routing. */
  sessionKey?: import('../session-routing.js').SessionKey;
  /** External abort signal — when aborted, the in-flight fetch is cancelled immediately. */
  signal?: AbortSignal;
}

/**
 * Session headers sent to OpenClaw Gateway for session management.
 * These headers enable persistent state across voice interactions.
 */
export interface OpenClawSessionHeaders {
  'X-OpenClaw-Session-Id': string;
  'X-OpenClaw-Room-SID'?: string;
  'X-OpenClaw-Room-Name'?: string;
  'X-OpenClaw-Participant-Identity'?: string;
  'X-OpenClaw-Participant-SID'?: string;
}

export interface OpenClawChatResponse {
  id: string;
  choices: {
    delta: {
      role?: string;
      content?: string;
      tool_calls?: OpenClawToolCallDelta[];
    };
    finish_reason?: string;
  }[];
}

export interface OpenClawToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** Authentication error types */
export type AuthErrorCode = 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_TOKEN' | 'TOKEN_EXPIRED';

/**
 * Error thrown when authentication fails.
 */
export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly code: AuthErrorCode,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when session is invalid or expired.
 */
export class SessionError extends Error {
  constructor(
    message: string,
    public readonly sessionId: string,
    public readonly reason: 'expired' | 'invalid' | 'not_found',
  ) {
    super(message);
    this.name = 'SessionError';
  }
}
