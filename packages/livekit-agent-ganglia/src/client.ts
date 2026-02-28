import {
  OpenClawChatOptions,
  OpenClawChatResponse,
  OpenClawConfig,
  LiveKitSessionInfo,
  OpenClawSessionHeaders,
  AuthenticationError,
  SessionError,
} from './types/index.js';
import type { SessionKey } from './session-routing.js';
import { type Logger, noopLogger, dbg } from './logger.js';

/**
 * @deprecated Use resolveSessionKey() + SessionKey routing instead.
 * Generates a deterministic session ID from LiveKit session info.
 * Combines room SID and participant identity for unique session tracking.
 */
export function generateSessionId(session: LiveKitSessionInfo): string {
  // Priority: customSessionId > roomSid+participantIdentity > roomName+participantIdentity > roomName > roomSid
  if (session.customSessionId) {
    return session.customSessionId;
  }

  const parts: string[] = [];

  // Prefer SID over name for uniqueness (SIDs are unique per instance)
  if (session.roomSid) {
    parts.push(session.roomSid);
  } else if (session.roomName) {
    parts.push(session.roomName);
  }

  if (session.participantIdentity) {
    parts.push(session.participantIdentity);
  } else if (session.participantSid) {
    parts.push(session.participantSid);
  }

  if (parts.length === 0) {
    // Fallback to a random session if no identifiers provided
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  return parts.join(':');
}

/**
 * @deprecated Use buildMetadataHeaders() + SessionKey routing instead.
 * Builds OpenClaw session headers from LiveKit session info.
 */
export function buildSessionHeaders(session: LiveKitSessionInfo): Partial<OpenClawSessionHeaders> {
  const headers: Partial<OpenClawSessionHeaders> = {
    'X-OpenClaw-Session-Id': generateSessionId(session),
  };

  if (session.roomSid) {
    headers['X-OpenClaw-Room-SID'] = session.roomSid;
  }
  if (session.roomName) {
    headers['X-OpenClaw-Room-Name'] = session.roomName;
  }
  if (session.participantIdentity) {
    headers['X-OpenClaw-Participant-Identity'] = session.participantIdentity;
  }
  if (session.participantSid) {
    headers['X-OpenClaw-Participant-SID'] = session.participantSid;
  }

  return headers;
}

/**
 * Builds supplementary metadata headers from LiveKit session info.
 * These are informational only — they do NOT affect routing.
 * Routing is determined by SessionKey (header or body.user).
 */
export function buildMetadataHeaders(session: LiveKitSessionInfo): Record<string, string> {
  const headers: Record<string, string> = {};

  if (session.roomSid) {
    headers['X-OpenClaw-Room-SID'] = session.roomSid;
  }
  if (session.roomName) {
    headers['X-OpenClaw-Room-Name'] = session.roomName;
  }
  if (session.participantIdentity) {
    headers['X-OpenClaw-Participant-Identity'] = session.participantIdentity;
  }
  if (session.participantSid) {
    headers['X-OpenClaw-Participant-SID'] = session.participantSid;
  }

  return headers;
}

/**
 * Applies a SessionKey to the request headers and body.
 *
 * Routing rules per spec 08:
 * - owner  → header: x-openclaw-session-key: "main"
 * - guest  → body.user: "guest_{identity}"
 * - room   → body.user: "room_{room_name}"
 */
export function applySessionKey(
  sessionKey: SessionKey,
  headers: Record<string, string>,
  body: Record<string, any>,
): void {
  if (sessionKey.type === 'owner') {
    headers['x-openclaw-session-key'] = sessionKey.key;
  } else {
    // guest or room — use body.user
    body.user = sessionKey.key;
  }
}

export class OpenClawClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private defaultSession?: LiveKitSessionInfo;
  private logger: Logger;

  constructor(config: OpenClawConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:8080';
    this.apiKey = config.apiKey || process.env.OPENCLAW_API_KEY || '';
    this.model = config.model || 'openclaw-gateway';
    this.defaultSession = config.defaultSession;
    this.logger = config.logger || noopLogger;
  }

  /**
   * Returns the base URL for the OpenClaw Gateway.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Returns whether the client is configured with an API key.
   */
  isAuthenticated(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Returns the current session info (default or from last request).
   */
  getDefaultSession(): LiveKitSessionInfo | undefined {
    return this.defaultSession;
  }

  /**
   * Updates the default session info for subsequent requests.
   */
  setDefaultSession(session: LiveKitSessionInfo): void {
    this.defaultSession = session;
  }

  async *chat(options: OpenClawChatOptions): AsyncIterableIterator<OpenClawChatResponse> {
    const controller = new AbortController();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add authentication header
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body: Record<string, any> = {
      model: this.model,
      messages: options.messages,
      stream: true,
    };

    if (options.tools) {
      body.tools = options.tools;
    }
    if (options.tool_choice) {
      body.tool_choice = options.tool_choice;
    }

    // Session routing: SessionKey takes priority, then legacy fallback
    const session = options.session || this.defaultSession;

    if (options.sessionKey) {
      // New routing: apply session key to headers/body per spec 08
      applySessionKey(options.sessionKey, headers, body);

      // Add supplementary metadata headers (informational, not routing)
      if (session) {
        Object.assign(headers, buildMetadataHeaders(session));
      }
    } else if (session) {
      // Legacy fallback: use old session headers
      const sessionHeaders = buildSessionHeaders(session);
      Object.assign(headers, sessionHeaders);
      const sessionId = generateSessionId(session);
      body.session_id = sessionId;
    } else if (options.sessionId) {
      // Legacy support: use sessionId directly as the session header
      headers['X-OpenClaw-Session-Id'] = options.sessionId;
      body.session_id = options.sessionId;
    }

    const url = `${this.baseUrl}/v1/chat/completions`;
    dbg.openclawClient('POST %s msgCount=%d hasTools=%s sessionKey=%s',
      url, options.messages.length,
      !!(options.tools && options.tools.length > 0),
      options.sessionKey?.type ?? 'none',
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (fetchError) {
      this.logger.error(`OpenClawClient fetch failed for ${url}: ${fetchError}`);
      throw fetchError;
    }

    dbg.openclawClient('response %d %s', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');

      // Handle authentication errors specifically
      if (response.status === 401) {
        throw new AuthenticationError(
          `Authentication failed: ${errorText}`,
          'UNAUTHORIZED',
          401,
        );
      }

      if (response.status === 403) {
        throw new AuthenticationError(
          `Access forbidden: ${errorText}`,
          'FORBIDDEN',
          403,
        );
      }

      // Handle session-related errors
      if (response.status === 440 || errorText.toLowerCase().includes('session expired')) {
        // Use the routing key if available, otherwise fall back to legacy session ID
        const sid = options.sessionKey?.key
          || (session ? generateSessionId(session) : options.sessionId || 'unknown');
        throw new SessionError(
          `Session expired: ${errorText}`,
          sid,
          'expired',
        );
      }

      throw new Error(`OpenClaw API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;
          if (trimmedLine.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmedLine.slice(6));
              yield data as OpenClawChatResponse;
            } catch (e) {
              this.logger.warn(`Error parsing JSON chunk: ${trimmedLine}`);
            }
          }
        }
      }
    } catch (err) {
      controller.abort();
      throw err;
    } finally {
      reader.releaseLock();
    }
  }
}
