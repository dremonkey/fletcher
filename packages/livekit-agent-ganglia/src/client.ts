import {
  OpenClawChatOptions,
  OpenClawChatResponse,
  OpenClawConfig,
  LiveKitSessionInfo,
  OpenClawSessionHeaders,
  ManagedSession,
  SessionState,
  AuthenticationError,
  SessionError,
} from './types/index.js';

/**
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

export class OpenClawClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private defaultSession?: LiveKitSessionInfo;
  private trackSessionState: boolean;
  private managedSessions: Map<string, ManagedSession> = new Map();

  constructor(config: OpenClawConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:8080';
    this.apiKey = config.apiKey || process.env.OPENCLAW_API_KEY || '';
    this.model = config.model || 'openclaw-gateway';
    this.defaultSession = config.defaultSession;
    this.trackSessionState = config.trackSessionState ?? false;
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

  /**
   * Creates or updates a managed session with state tracking.
   * Returns the managed session with computed session ID.
   */
  createManagedSession(session: LiveKitSessionInfo): ManagedSession {
    const sessionId = generateSessionId(session);
    const existing = this.managedSessions.get(sessionId);

    if (existing) {
      // Update existing session
      existing.lastActivityAt = Date.now();
      return existing;
    }

    const managed: ManagedSession = {
      ...session,
      state: 'active',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      requestCount: 0,
      sessionId,
    };

    if (this.trackSessionState) {
      this.managedSessions.set(sessionId, managed);
    }

    return managed;
  }

  /**
   * Gets a managed session by ID.
   */
  getManagedSession(sessionId: string): ManagedSession | undefined {
    return this.managedSessions.get(sessionId);
  }

  /**
   * Gets all managed sessions.
   */
  getAllManagedSessions(): ManagedSession[] {
    return Array.from(this.managedSessions.values());
  }

  /**
   * Updates the state of a managed session.
   */
  updateSessionState(sessionId: string, state: SessionState): void {
    const session = this.managedSessions.get(sessionId);
    if (session) {
      session.state = state;
      session.lastActivityAt = Date.now();
    }
  }

  /**
   * Marks a session as expired and removes it from tracking.
   */
  expireSession(sessionId: string): void {
    const session = this.managedSessions.get(sessionId);
    if (session) {
      session.state = 'expired';
    }
  }

  /**
   * Removes a session from tracking.
   */
  removeSession(sessionId: string): boolean {
    return this.managedSessions.delete(sessionId);
  }

  /**
   * Clears all managed sessions.
   */
  clearSessions(): void {
    this.managedSessions.clear();
  }

  /**
   * Validates if a session is in an active state.
   */
  isSessionActive(sessionId: string): boolean {
    const session = this.managedSessions.get(sessionId);
    return session?.state === 'active';
  }

  /**
   * Creates session info from LiveKit room and participant data.
   * This is a convenience method for extracting session identifiers.
   */
  static createSessionFromLiveKit(opts: {
    roomSid?: string;
    roomName?: string;
    participantIdentity?: string;
    participantSid?: string;
  }): LiveKitSessionInfo {
    return {
      roomSid: opts.roomSid,
      roomName: opts.roomName,
      participantIdentity: opts.participantIdentity,
      participantSid: opts.participantSid,
    };
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

    // Resolve session info: prefer request session, fall back to default, then legacy sessionId
    const session = options.session || this.defaultSession;
    if (session) {
      const sessionHeaders = buildSessionHeaders(session);
      Object.assign(headers, sessionHeaders);
    } else if (options.sessionId) {
      // Legacy support: use sessionId directly as the session header
      headers['X-OpenClaw-Session-Id'] = options.sessionId;
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

    // Also include session_id in body for APIs that expect it there
    const sessionId = session ? generateSessionId(session) : options.sessionId;
    if (sessionId) {
      body.session_id = sessionId;
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

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
        const sid = session ? generateSessionId(session) : options.sessionId || 'unknown';
        if (this.trackSessionState && session) {
          this.expireSession(generateSessionId(session));
        }
        throw new SessionError(
          `Session expired: ${errorText}`,
          sid,
          'expired',
        );
      }

      throw new Error(`OpenClaw API error (${response.status}): ${errorText}`);
    }

    // Update managed session state on successful response
    if (this.trackSessionState && session) {
      const managed = this.managedSessions.get(generateSessionId(session));
      if (managed) {
        managed.requestCount++;
        managed.lastActivityAt = Date.now();
        managed.state = 'active';
      }
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
              console.error('Error parsing JSON chunk:', trimmedLine);
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
