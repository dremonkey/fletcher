import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenClawClient, generateSessionId, buildSessionHeaders } from './client.js';
import type { LiveKitSessionInfo, ManagedSession } from './types/index.js';
import { AuthenticationError, SessionError } from './types/index.js';

describe('OpenClawClient', () => {
  beforeEach(() => {
    global.fetch = mock();
  });

  it('should format requests correctly', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: mock()
            .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"id": "1", "choices": [{"delta": {"content": "Hello"}}]}\n') })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: mock(),
        }),
      },
    } as any);

    const client = new OpenClawClient({ baseUrl: 'http://test-api', apiKey: 'test-key' });
    const stream = client.chat({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(mockFetch).toHaveBeenCalledWith('http://test-api/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-key',
      },
    }));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta.content).toBe('Hello');
  });

  it('should handle errors correctly', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as any);

    const client = new OpenClawClient();
    const stream = client.chat({ messages: [] });

    await expect((async () => {
      for await (const _ of stream) {}
    })()).rejects.toThrow('OpenClaw API error (500): Internal Server Error');
  });

  describe('session management', () => {
    it('should include session headers when session is provided', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: mock().mockResolvedValueOnce({ done: true }),
            releaseLock: mock(),
          }),
        },
      } as any);

      const client = new OpenClawClient({ baseUrl: 'http://test-api', apiKey: 'test-key' });
      const session: LiveKitSessionInfo = {
        roomSid: 'RM_abc123',
        roomName: 'test-room',
        participantIdentity: 'user-456',
        participantSid: 'PA_xyz789',
      };

      const stream = client.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        session,
      });

      for await (const _ of stream) {}

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;

      expect(headers['X-OpenClaw-Session-Id']).toBe('RM_abc123:user-456');
      expect(headers['X-OpenClaw-Room-SID']).toBe('RM_abc123');
      expect(headers['X-OpenClaw-Room-Name']).toBe('test-room');
      expect(headers['X-OpenClaw-Participant-Identity']).toBe('user-456');
      expect(headers['X-OpenClaw-Participant-SID']).toBe('PA_xyz789');
    });

    it('should use default session when no request session provided', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: mock().mockResolvedValueOnce({ done: true }),
            releaseLock: mock(),
          }),
        },
      } as any);

      const defaultSession: LiveKitSessionInfo = {
        roomSid: 'RM_default',
        participantIdentity: 'default-user',
      };

      const client = new OpenClawClient({
        baseUrl: 'http://test-api',
        defaultSession,
      });

      const stream = client.chat({ messages: [] });
      for await (const _ of stream) {}

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;

      expect(headers['X-OpenClaw-Session-Id']).toBe('RM_default:default-user');
    });

    it('should prefer request session over default session', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: mock().mockResolvedValueOnce({ done: true }),
            releaseLock: mock(),
          }),
        },
      } as any);

      const client = new OpenClawClient({
        baseUrl: 'http://test-api',
        defaultSession: { roomSid: 'RM_default' },
      });

      const stream = client.chat({
        messages: [],
        session: { roomSid: 'RM_request' },
      });
      for await (const _ of stream) {}

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;

      expect(headers['X-OpenClaw-Session-Id']).toBe('RM_request');
    });

    it('should support legacy sessionId parameter', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: mock().mockResolvedValueOnce({ done: true }),
            releaseLock: mock(),
          }),
        },
      } as any);

      const client = new OpenClawClient({ baseUrl: 'http://test-api' });
      const stream = client.chat({
        messages: [],
        sessionId: 'legacy-session-123',
      });
      for await (const _ of stream) {}

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;

      expect(headers['X-OpenClaw-Session-Id']).toBe('legacy-session-123');
    });

    it('should include session_id in request body', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: mock().mockResolvedValueOnce({ done: true }),
            releaseLock: mock(),
          }),
        },
      } as any);

      const client = new OpenClawClient({ baseUrl: 'http://test-api' });
      const stream = client.chat({
        messages: [],
        session: { roomSid: 'RM_test' },
      });
      for await (const _ of stream) {}

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.session_id).toBe('RM_test');
    });

    it('should allow updating default session', () => {
      const client = new OpenClawClient();

      expect(client.getDefaultSession()).toBeUndefined();

      const session: LiveKitSessionInfo = {
        roomSid: 'RM_new',
        participantIdentity: 'user-new',
      };
      client.setDefaultSession(session);

      expect(client.getDefaultSession()).toEqual(session);
    });
  });

  describe('createSessionFromLiveKit', () => {
    it('should create session info from LiveKit data', () => {
      const session = OpenClawClient.createSessionFromLiveKit({
        roomSid: 'RM_abc',
        roomName: 'my-room',
        participantIdentity: 'user@example.com',
        participantSid: 'PA_xyz',
      });

      expect(session.roomSid).toBe('RM_abc');
      expect(session.roomName).toBe('my-room');
      expect(session.participantIdentity).toBe('user@example.com');
      expect(session.participantSid).toBe('PA_xyz');
    });
  });
});

describe('generateSessionId', () => {
  it('should prioritize customSessionId', () => {
    const session: LiveKitSessionInfo = {
      customSessionId: 'my-custom-id',
      roomSid: 'RM_abc',
      participantIdentity: 'user-123',
    };
    expect(generateSessionId(session)).toBe('my-custom-id');
  });

  it('should combine roomSid and participantIdentity', () => {
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_abc',
      participantIdentity: 'user-123',
    };
    expect(generateSessionId(session)).toBe('RM_abc:user-123');
  });

  it('should prefer roomSid over roomName', () => {
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_abc',
      roomName: 'my-room',
      participantIdentity: 'user-123',
    };
    expect(generateSessionId(session)).toBe('RM_abc:user-123');
  });

  it('should use roomName when roomSid not available', () => {
    const session: LiveKitSessionInfo = {
      roomName: 'my-room',
      participantIdentity: 'user-123',
    };
    expect(generateSessionId(session)).toBe('my-room:user-123');
  });

  it('should prefer participantIdentity over participantSid', () => {
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_abc',
      participantIdentity: 'user-123',
      participantSid: 'PA_xyz',
    };
    expect(generateSessionId(session)).toBe('RM_abc:user-123');
  });

  it('should use participantSid when identity not available', () => {
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_abc',
      participantSid: 'PA_xyz',
    };
    expect(generateSessionId(session)).toBe('RM_abc:PA_xyz');
  });

  it('should use only room identifier if no participant info', () => {
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_abc',
    };
    expect(generateSessionId(session)).toBe('RM_abc');
  });

  it('should generate fallback session for empty info', () => {
    const session: LiveKitSessionInfo = {};
    const id = generateSessionId(session);
    expect(id).toMatch(/^session-\d+-[a-z0-9]+$/);
  });
});

describe('buildSessionHeaders', () => {
  it('should build all available headers', () => {
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_abc',
      roomName: 'my-room',
      participantIdentity: 'user-123',
      participantSid: 'PA_xyz',
    };

    const headers = buildSessionHeaders(session);

    expect(headers['X-OpenClaw-Session-Id']).toBe('RM_abc:user-123');
    expect(headers['X-OpenClaw-Room-SID']).toBe('RM_abc');
    expect(headers['X-OpenClaw-Room-Name']).toBe('my-room');
    expect(headers['X-OpenClaw-Participant-Identity']).toBe('user-123');
    expect(headers['X-OpenClaw-Participant-SID']).toBe('PA_xyz');
  });

  it('should only include available headers', () => {
    const session: LiveKitSessionInfo = {
      roomName: 'my-room',
    };

    const headers = buildSessionHeaders(session);

    expect(headers['X-OpenClaw-Session-Id']).toBe('my-room');
    expect(headers['X-OpenClaw-Room-Name']).toBe('my-room');
    expect(headers['X-OpenClaw-Room-SID']).toBeUndefined();
    expect(headers['X-OpenClaw-Participant-Identity']).toBeUndefined();
    expect(headers['X-OpenClaw-Participant-SID']).toBeUndefined();
  });
});

describe('authentication', () => {
  beforeEach(() => {
    global.fetch = mock();
  });

  it('should report authentication status correctly', () => {
    const clientWithKey = new OpenClawClient({ apiKey: 'test-key' });
    const clientWithoutKey = new OpenClawClient({});

    expect(clientWithKey.isAuthenticated()).toBe(true);
    expect(clientWithoutKey.isAuthenticated()).toBe(false);
  });

  it('should expose base URL', () => {
    const client = new OpenClawClient({ baseUrl: 'http://custom-gateway:9000' });
    expect(client.getBaseUrl()).toBe('http://custom-gateway:9000');
  });

  it('should throw AuthenticationError on 401 response', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Invalid API key'),
    } as any);

    const client = new OpenClawClient({ apiKey: 'bad-key' });
    const stream = client.chat({ messages: [] });

    let error: any;
    try {
      for await (const _ of stream) {}
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.statusCode).toBe(401);
    expect(error.message).toContain('Authentication failed');
  });

  it('should throw AuthenticationError on 403 response', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Access denied for this resource'),
    } as any);

    const client = new OpenClawClient({ apiKey: 'limited-key' });
    const stream = client.chat({ messages: [] });

    let error: any;
    try {
      for await (const _ of stream) {}
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('Access forbidden');
  });

  it('should throw SessionError on session expired response', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 440,
      text: () => Promise.resolve('Session has expired'),
    } as any);

    const client = new OpenClawClient();
    const stream = client.chat({
      messages: [],
      session: { roomSid: 'RM_expired' },
    });

    let error: any;
    try {
      for await (const _ of stream) {}
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(SessionError);
    expect(error.reason).toBe('expired');
    expect(error.sessionId).toBe('RM_expired');
  });
});

describe('managed sessions', () => {
  it('should create managed session with initial state', () => {
    const client = new OpenClawClient({ trackSessionState: true });
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_test',
      participantIdentity: 'user-1',
    };

    const managed = client.createManagedSession(session);

    expect(managed.state).toBe('active');
    expect(managed.sessionId).toBe('RM_test:user-1');
    expect(managed.requestCount).toBe(0);
    expect(managed.createdAt).toBeLessThanOrEqual(Date.now());
    expect(managed.lastActivityAt).toBeLessThanOrEqual(Date.now());
  });

  it('should track managed sessions when enabled', () => {
    const client = new OpenClawClient({ trackSessionState: true });
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_tracked',
      participantIdentity: 'user-tracked',
    };

    client.createManagedSession(session);
    const retrieved = client.getManagedSession('RM_tracked:user-tracked');

    expect(retrieved).toBeDefined();
    expect(retrieved?.roomSid).toBe('RM_tracked');
  });

  it('should not track sessions when disabled', () => {
    const client = new OpenClawClient({ trackSessionState: false });
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_untracked',
    };

    client.createManagedSession(session);
    const retrieved = client.getManagedSession('RM_untracked');

    expect(retrieved).toBeUndefined();
  });

  it('should return existing managed session on duplicate creation', () => {
    const client = new OpenClawClient({ trackSessionState: true });
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_dup',
      participantIdentity: 'user-dup',
    };

    const first = client.createManagedSession(session);
    const firstCreatedAt = first.createdAt;

    // Simulate some time passing
    const second = client.createManagedSession(session);

    expect(second.createdAt).toBe(firstCreatedAt);
    expect(second.lastActivityAt).toBeGreaterThanOrEqual(first.lastActivityAt);
  });

  it('should update session state', () => {
    const client = new OpenClawClient({ trackSessionState: true });
    const session: LiveKitSessionInfo = { roomSid: 'RM_state' };

    client.createManagedSession(session);
    expect(client.isSessionActive('RM_state')).toBe(true);

    client.updateSessionState('RM_state', 'reconnecting');
    expect(client.isSessionActive('RM_state')).toBe(false);

    const managed = client.getManagedSession('RM_state');
    expect(managed?.state).toBe('reconnecting');
  });

  it('should expire session', () => {
    const client = new OpenClawClient({ trackSessionState: true });
    const session: LiveKitSessionInfo = { roomSid: 'RM_expire' };

    client.createManagedSession(session);
    client.expireSession('RM_expire');

    const managed = client.getManagedSession('RM_expire');
    expect(managed?.state).toBe('expired');
  });

  it('should remove session', () => {
    const client = new OpenClawClient({ trackSessionState: true });
    const session: LiveKitSessionInfo = { roomSid: 'RM_remove' };

    client.createManagedSession(session);
    expect(client.getManagedSession('RM_remove')).toBeDefined();

    const removed = client.removeSession('RM_remove');
    expect(removed).toBe(true);
    expect(client.getManagedSession('RM_remove')).toBeUndefined();
  });

  it('should get all managed sessions', () => {
    const client = new OpenClawClient({ trackSessionState: true });

    client.createManagedSession({ roomSid: 'RM_1' });
    client.createManagedSession({ roomSid: 'RM_2' });
    client.createManagedSession({ roomSid: 'RM_3' });

    const all = client.getAllManagedSessions();
    expect(all).toHaveLength(3);
    expect(all.map(s => s.sessionId)).toContain('RM_1');
    expect(all.map(s => s.sessionId)).toContain('RM_2');
    expect(all.map(s => s.sessionId)).toContain('RM_3');
  });

  it('should clear all sessions', () => {
    const client = new OpenClawClient({ trackSessionState: true });

    client.createManagedSession({ roomSid: 'RM_clear1' });
    client.createManagedSession({ roomSid: 'RM_clear2' });

    client.clearSessions();

    expect(client.getAllManagedSessions()).toHaveLength(0);
  });
});

describe('session state tracking during requests', () => {
  beforeEach(() => {
    global.fetch = mock();
  });

  it('should increment request count on successful request', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: mock().mockResolvedValueOnce({ done: true }),
          releaseLock: mock(),
        }),
      },
    } as any);

    const client = new OpenClawClient({ trackSessionState: true });
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_count',
      participantIdentity: 'user-count',
    };

    // Pre-create the managed session
    client.createManagedSession(session);

    const stream = client.chat({ messages: [], session });
    for await (const _ of stream) {}

    const managed = client.getManagedSession('RM_count:user-count');
    expect(managed?.requestCount).toBe(1);
  });

  it('should mark session as expired on session error', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 440,
      text: () => Promise.resolve('Session expired'),
    } as any);

    const client = new OpenClawClient({ trackSessionState: true });
    const session: LiveKitSessionInfo = { roomSid: 'RM_expire_on_error' };

    client.createManagedSession(session);

    const stream = client.chat({ messages: [], session });
    try {
      for await (const _ of stream) {}
    } catch (e) {
      // Expected to throw SessionError
    }

    const managed = client.getManagedSession('RM_expire_on_error');
    expect(managed?.state).toBe('expired');
  });
});
