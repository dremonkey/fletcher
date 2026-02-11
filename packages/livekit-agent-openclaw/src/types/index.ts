export interface OpenClawConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** Default session info to use if not provided per-request */
  defaultSession?: LiveKitSessionInfo;
  /** Enable automatic session state tracking */
  trackSessionState?: boolean;
}

/** Session lifecycle state */
export type SessionState = 'active' | 'expired' | 'reconnecting' | 'disconnected';

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

/**
 * Extended session info with state tracking metadata.
 * Used internally for session lifecycle management.
 */
export interface ManagedSession extends LiveKitSessionInfo {
  /** Current session state */
  state: SessionState;
  /** Session creation timestamp (ms since epoch) */
  createdAt: number;
  /** Last activity timestamp (ms since epoch) */
  lastActivityAt: number;
  /** Number of requests made in this session */
  requestCount: number;
  /** Computed session ID */
  sessionId: string;
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
  /** LiveKit session info for OpenClaw session mapping */
  session?: LiveKitSessionInfo;
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
