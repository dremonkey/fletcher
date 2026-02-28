import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenClawClient, generateSessionId, buildSessionHeaders, buildMetadataHeaders, applySessionKey } from './client.js';
import type { LiveKitSessionInfo } from './types/index.js';
import { AuthenticationError, SessionError } from './types/index.js';
import type { SessionKey } from './session-routing.js';

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

describe('buildMetadataHeaders', () => {
  it('should build metadata headers without session ID', () => {
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_abc',
      roomName: 'my-room',
      participantIdentity: 'user-123',
      participantSid: 'PA_xyz',
    };

    const headers = buildMetadataHeaders(session);

    expect(headers['X-OpenClaw-Room-SID']).toBe('RM_abc');
    expect(headers['X-OpenClaw-Room-Name']).toBe('my-room');
    expect(headers['X-OpenClaw-Participant-Identity']).toBe('user-123');
    expect(headers['X-OpenClaw-Participant-SID']).toBe('PA_xyz');
    // Should NOT include the routing session ID header
    expect((headers as any)['X-OpenClaw-Session-Id']).toBeUndefined();
  });

  it('should omit absent fields', () => {
    const headers = buildMetadataHeaders({ roomName: 'test' });
    expect(headers['X-OpenClaw-Room-Name']).toBe('test');
    expect(headers['X-OpenClaw-Room-SID']).toBeUndefined();
    expect(headers['X-OpenClaw-Participant-Identity']).toBeUndefined();
  });
});

describe('applySessionKey', () => {
  it('owner → sets x-openclaw-session-key header', () => {
    const headers: Record<string, string> = {};
    const body: Record<string, any> = {};

    applySessionKey({ type: 'owner', key: 'main' }, headers, body);

    expect(headers['x-openclaw-session-key']).toBe('main');
    expect(body.user).toBeUndefined();
  });

  it('guest → sets body.user field', () => {
    const headers: Record<string, string> = {};
    const body: Record<string, any> = {};

    applySessionKey({ type: 'guest', key: 'guest_bob' }, headers, body);

    expect(body.user).toBe('guest_bob');
    expect(headers['x-openclaw-session-key']).toBeUndefined();
  });

  it('room → sets body.user field', () => {
    const headers: Record<string, string> = {};
    const body: Record<string, any> = {};

    applySessionKey({ type: 'room', key: 'room_standup' }, headers, body);

    expect(body.user).toBe('room_standup');
    expect(headers['x-openclaw-session-key']).toBeUndefined();
  });
});

describe('OpenClawClient sessionKey routing', () => {
  beforeEach(() => {
    global.fetch = mock();
  });

  function mockSuccessResponse() {
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
    return mockFetch;
  }

  it('owner sessionKey → sends x-openclaw-session-key header, no user in body', async () => {
    const mockFetch = mockSuccessResponse();
    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });

    const stream = client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      sessionKey: { type: 'owner', key: 'main' },
    });
    for await (const _ of stream) {}

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    const body = JSON.parse(callArgs[1].body);

    expect(headers['x-openclaw-session-key']).toBe('main');
    expect(body.user).toBeUndefined();
    // Should NOT have legacy session headers
    expect(headers['X-OpenClaw-Session-Id']).toBeUndefined();
    expect(body.session_id).toBeUndefined();
  });

  it('guest sessionKey → sends user in body, no session-key header', async () => {
    const mockFetch = mockSuccessResponse();
    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });

    const stream = client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      sessionKey: { type: 'guest', key: 'guest_bob' },
    });
    for await (const _ of stream) {}

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    const body = JSON.parse(callArgs[1].body);

    expect(body.user).toBe('guest_bob');
    expect(headers['x-openclaw-session-key']).toBeUndefined();
  });

  it('room sessionKey → sends user in body', async () => {
    const mockFetch = mockSuccessResponse();
    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });

    const stream = client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      sessionKey: { type: 'room', key: 'room_standup' },
    });
    for await (const _ of stream) {}

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);

    expect(body.user).toBe('room_standup');
  });

  it('sessionKey + session metadata → sends both routing and metadata headers', async () => {
    const mockFetch = mockSuccessResponse();
    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });

    const stream = client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      sessionKey: { type: 'owner', key: 'main' },
      session: {
        roomSid: 'RM_abc',
        roomName: 'my-room',
        participantIdentity: 'andre',
      },
    });
    for await (const _ of stream) {}

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;

    // Routing header
    expect(headers['x-openclaw-session-key']).toBe('main');
    // Metadata headers (informational)
    expect(headers['X-OpenClaw-Room-SID']).toBe('RM_abc');
    expect(headers['X-OpenClaw-Room-Name']).toBe('my-room');
    expect(headers['X-OpenClaw-Participant-Identity']).toBe('andre');
  });

  it('sessionKey takes priority over legacy session', async () => {
    const mockFetch = mockSuccessResponse();
    const client = new OpenClawClient({
      baseUrl: 'http://test',
      apiKey: 'key',
      defaultSession: { roomSid: 'RM_legacy', participantIdentity: 'old-user' },
    });

    const stream = client.chat({
      messages: [],
      sessionKey: { type: 'guest', key: 'guest_new-user' },
    });
    for await (const _ of stream) {}

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    const body = JSON.parse(callArgs[1].body);

    // New routing via body.user
    expect(body.user).toBe('guest_new-user');
    // Should NOT have legacy routing
    expect(headers['X-OpenClaw-Session-Id']).toBeUndefined();
    expect(body.session_id).toBeUndefined();
  });

  it('falls back to legacy session when no sessionKey provided', async () => {
    const mockFetch = mockSuccessResponse();
    const client = new OpenClawClient({ baseUrl: 'http://test' });

    const stream = client.chat({
      messages: [],
      session: { roomSid: 'RM_legacy', participantIdentity: 'user-1' },
    });
    for await (const _ of stream) {}

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    const body = JSON.parse(callArgs[1].body);

    // Legacy headers should still work
    expect(headers['X-OpenClaw-Session-Id']).toBe('RM_legacy:user-1');
    expect(body.session_id).toBe('RM_legacy:user-1');
  });
});

