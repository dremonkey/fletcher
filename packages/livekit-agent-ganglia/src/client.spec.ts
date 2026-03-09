import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenClawClient, generateSessionId, buildSessionHeaders, buildMetadataHeaders, applySessionKey } from './client.js';
import type { LiveKitSessionInfo } from './types/index.js';
import { AuthenticationError, SessionError, OpenResponsesError, RateLimitError } from './types/index.js';
import type { SessionKey } from './session-routing.js';
import type { OpenResponsesEvent } from './types/openresponses.js';

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

// ---------------------------------------------------------------------------
// OpenResponses API: respond()
// ---------------------------------------------------------------------------

/**
 * Helper: build a mock SSE response from an array of {event, data} pairs.
 * Encodes them as proper SSE format: "event: ...\ndata: {...}\n\n"
 */
function buildSseChunks(events: Array<{ event: string; data: any }>, includeDone = true): Uint8Array {
  const lines: string[] = [];
  for (const ev of events) {
    lines.push(`event: ${ev.event}`);
    lines.push(`data: ${JSON.stringify(ev.data)}`);
    lines.push('');
  }
  if (includeDone) {
    lines.push('data: [DONE]');
    lines.push('');
  }
  return new TextEncoder().encode(lines.join('\n'));
}

function mockOpenResponsesStream(events: Array<{ event: string; data: any }>) {
  const mockFetch = global.fetch as any;
  const chunk = buildSseChunks(events);
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map(),
    body: {
      getReader: () => ({
        read: mock()
          .mockResolvedValueOnce({ done: false, value: chunk })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: mock(),
      }),
    },
  } as any);
  return mockFetch;
}

describe('OpenClawClient.respond()', () => {
  beforeEach(() => {
    global.fetch = mock();
  });

  it('should send correct request to /v1/responses', async () => {
    const mockFetch = mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
      { event: 'response.completed', data: { id: 'resp_1', status: 'completed' } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test-api', apiKey: 'test-key' });
    const events: OpenResponsesEvent[] = [];
    for await (const ev of client.respond({ input: 'hello' })) {
      events.push(ev);
    }

    expect(mockFetch).toHaveBeenCalledWith('http://test-api/v1/responses', expect.objectContaining({
      method: 'POST',
    }));

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    const body = JSON.parse(callArgs[1].body);

    expect(headers['Authorization']).toBe('Bearer test-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(body.model).toBe('openclaw-gateway');
    expect(body.input).toBe('hello');
    expect(body.stream).toBe(true);
  });

  it('should parse all SSE event types', async () => {
    const sseEvents = [
      { event: 'response.created', data: { id: 'resp_1', model: 'test' } },
      { event: 'response.in_progress', data: {} },
      { event: 'response.output_item.added', data: { item: { id: 'item_1', type: 'message' } } },
      { event: 'response.content_part.added', data: { part: { type: 'text' } } },
      { event: 'response.output_text.delta', data: { delta: 'Hi', text: 'Hi' } },
      { event: 'response.output_text.delta', data: { delta: ' there', text: 'Hi there' } },
      { event: 'response.output_text.done', data: { text: 'Hi there' } },
      { event: 'response.content_part.done', data: { part: { type: 'text', text: 'Hi there' } } },
      { event: 'response.output_item.done', data: { item: { id: 'item_1', type: 'message' } } },
      { event: 'response.completed', data: { id: 'resp_1', usage: { input_tokens: 5, output_tokens: 3 } } },
    ];
    mockOpenResponsesStream(sseEvents);

    const client = new OpenClawClient({ baseUrl: 'http://test-api' });
    const events: OpenResponsesEvent[] = [];
    for await (const ev of client.respond({ input: 'hello' })) {
      events.push(ev);
    }

    expect(events).toHaveLength(10);
    expect(events[0].event).toBe('response.created');
    expect(events[0].data.id).toBe('resp_1');
    expect(events[4].event).toBe('response.output_text.delta');
    expect(events[4].data.delta).toBe('Hi');
    expect(events[5].data.delta).toBe(' there');
    expect(events[6].event).toBe('response.output_text.done');
    expect(events[6].data.text).toBe('Hi there');
    expect(events[9].event).toBe('response.completed');
  });

  it('should stop on [DONE] sentinel', async () => {
    // The helper already appends [DONE] by default
    mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test-api' });
    const events: OpenResponsesEvent[] = [];
    for await (const ev of client.respond({ input: 'hello' })) {
      events.push(ev);
    }

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('response.created');
  });

  it('should handle malformed JSON gracefully', async () => {
    const mockFetch = global.fetch as any;
    // Include a malformed JSON line in the SSE stream
    const rawSse = 'event: response.created\ndata: {"id": "resp_1"}\n\nevent: response.output_text.delta\ndata: {INVALID_JSON}\n\nevent: response.completed\ndata: {"status": "done"}\n\ndata: [DONE]\n';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map(),
      body: {
        getReader: () => ({
          read: mock()
            .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(rawSse) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: mock(),
        }),
      },
    } as any);

    const client = new OpenClawClient({ baseUrl: 'http://test-api' });
    const events: OpenResponsesEvent[] = [];
    for await (const ev of client.respond({ input: 'test' })) {
      events.push(ev);
    }

    // The malformed event should be skipped, the valid ones should work
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('response.created');
    expect(events[1].event).toBe('response.completed');
  });

  it('should apply sessionKey routing (owner -> header)', async () => {
    const mockFetch = mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });
    for await (const _ of client.respond({
      input: 'hello',
      sessionKey: { type: 'owner', key: 'main' },
    })) {}

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    const body = JSON.parse(callArgs[1].body);

    expect(headers['x-openclaw-session-key']).toBe('main');
    expect(body.user).toBeUndefined();
  });

  it('should apply sessionKey routing (guest -> body.user)', async () => {
    const mockFetch = mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });
    for await (const _ of client.respond({
      input: 'hello',
      sessionKey: { type: 'guest', key: 'guest_bob' },
    })) {}

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);

    expect(body.user).toBe('guest_bob');
  });

  it('should derive user from session when no explicit user/sessionKey', async () => {
    const mockFetch = mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });
    for await (const _ of client.respond({
      input: 'hello',
      session: { participantIdentity: 'alice', roomName: 'test-room' },
    })) {}

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    const headers = callArgs[1].headers;

    expect(body.user).toBe('fletcher_alice');
    expect(headers['X-OpenClaw-Participant-Identity']).toBe('alice');
    expect(headers['X-OpenClaw-Room-Name']).toBe('test-room');
  });

  it('should use explicit user field when provided', async () => {
    const mockFetch = mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });
    for await (const _ of client.respond({
      input: 'hello',
      user: 'custom_user_123',
    })) {}

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);

    expect(body.user).toBe('custom_user_123');
  });

  it('should include instructions and tools in request body', async () => {
    const mockFetch = mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
    ]);

    const tools = [{ type: 'function', function: { name: 'get_time', parameters: {} } }];

    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });
    for await (const _ of client.respond({
      input: 'hello',
      instructions: 'You are a helpful assistant.',
      tools,
      tool_choice: 'auto',
    })) {}

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);

    expect(body.instructions).toBe('You are a helpful assistant.');
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe('auto');
  });

  it('should support array input (multi-turn)', async () => {
    const mockFetch = mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
    ]);

    const input = [
      { type: 'message' as const, role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
      { type: 'message' as const, role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Hi!' }] },
      { type: 'message' as const, role: 'user' as const, content: [{ type: 'text' as const, text: 'How are you?' }] },
    ];

    const client = new OpenClawClient({ baseUrl: 'http://test' });
    for await (const _ of client.respond({ input })) {}

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);

    expect(body.input).toEqual(input);
    expect(body.input).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// OpenResponses API: respond() error handling
// ---------------------------------------------------------------------------

describe('OpenClawClient.respond() error handling', () => {
  beforeEach(() => {
    global.fetch = mock();
  });

  it('should throw AuthenticationError on 401', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('Invalid API key'),
    } as any);

    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'bad-key' });

    let error: any;
    try {
      for await (const _ of client.respond({ input: 'test' })) {}
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.statusCode).toBe(401);
  });

  it('should throw RateLimitError on 429 with Retry-After', async () => {
    const mockFetch = global.fetch as any;
    const headersMap = new Map([['Retry-After', '30']]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: (key: string) => headersMap.get(key) || null },
      text: () => Promise.resolve('Rate limit exceeded'),
    } as any);

    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });

    let error: any;
    try {
      for await (const _ of client.respond({ input: 'test' })) {}
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.type).toBe('rate_limit_error');
    expect(error.retryAfter).toBe(30);
    expect(error.message).toContain('Rate limit exceeded');
  });

  it('should throw RateLimitError on 429 without Retry-After', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: () => null },
      text: () => Promise.resolve('Rate limit exceeded'),
    } as any);

    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });

    let error: any;
    try {
      for await (const _ of client.respond({ input: 'test' })) {}
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfter).toBeUndefined();
  });

  it('should throw OpenResponsesError on 500', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('Server error'),
    } as any);

    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });

    let error: any;
    try {
      for await (const _ of client.respond({ input: 'test' })) {}
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(OpenResponsesError);
    expect(error.type).toBe('http_error');
    expect(error.code).toBe('500');
    expect(error.message).toContain('HTTP 500');
  });

  it('should throw OpenResponsesError on response.failed SSE event', async () => {
    // The response.failed event comes inside the SSE stream
    mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
      { event: 'response.in_progress', data: {} },
      { event: 'response.failed', data: { error: { type: 'server_error', message: 'Backend unavailable', code: 'backend_down' } } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test', apiKey: 'key' });

    // respond() itself yields the failed event — it's respondAsChat() that throws
    const events: OpenResponsesEvent[] = [];
    for await (const ev of client.respond({ input: 'test' })) {
      events.push(ev);
    }

    // respond() yields ALL events including response.failed
    expect(events.some(e => e.event === 'response.failed')).toBe(true);
    const failedEvent = events.find(e => e.event === 'response.failed');
    expect(failedEvent!.data.error.message).toBe('Backend unavailable');
  });

  it('should throw SessionError on 440', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 440,
      statusText: 'Session Expired',
      text: () => Promise.resolve('Session has expired'),
    } as any);

    const client = new OpenClawClient({ baseUrl: 'http://test' });

    let error: any;
    try {
      for await (const _ of client.respond({ input: 'test', user: 'fletcher_alice' })) {}
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(SessionError);
    expect(error.sessionId).toBe('fletcher_alice');
    expect(error.reason).toBe('expired');
  });

  it('should handle graceful abort via external signal', async () => {
    const abortController = new AbortController();

    const mockFetch = global.fetch as any;
    mockFetch.mockImplementation(async () => {
      // Simulate abort during fetch
      abortController.abort();
      throw new DOMException('Aborted', 'AbortError');
    });

    const client = new OpenClawClient({ baseUrl: 'http://test' });

    // Should NOT throw — graceful cancellation returns cleanly
    const events: OpenResponsesEvent[] = [];
    for await (const ev of client.respond({ input: 'test', signal: abortController.signal })) {
      events.push(ev);
    }

    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// OpenResponses API: respondAsChat()
// ---------------------------------------------------------------------------

describe('OpenClawClient.respondAsChat()', () => {
  beforeEach(() => {
    global.fetch = mock();
  });

  it('should map text deltas to ChatResponse format', async () => {
    mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
      { event: 'response.output_item.added', data: { item: { id: 'item_1', type: 'message' } } },
      { event: 'response.content_part.added', data: { part: { type: 'text' } } },
      { event: 'response.output_text.delta', data: { delta: 'Hi', text: 'Hi' } },
      { event: 'response.output_text.delta', data: { delta: ' there', text: 'Hi there' } },
      { event: 'response.output_text.done', data: { text: 'Hi there' } },
      { event: 'response.completed', data: { id: 'resp_1' } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test' });
    const chunks = [];
    for await (const chunk of client.respondAsChat({ input: 'hello' })) {
      chunks.push(chunk);
    }

    // Should produce: 2 delta chunks + 1 stop chunk = 3
    expect(chunks).toHaveLength(3);

    // First delta
    expect(chunks[0].id).toBe('resp_1');
    expect(chunks[0].choices[0].delta.content).toBe('Hi');
    expect(chunks[0].choices[0].finish_reason).toBeUndefined();

    // Second delta
    expect(chunks[1].choices[0].delta.content).toBe(' there');

    // Stop signal
    expect(chunks[2].choices[0].finish_reason).toBe('stop');
  });

  it('should skip lifecycle events', async () => {
    mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
      { event: 'response.in_progress', data: {} },
      { event: 'response.output_text.delta', data: { delta: 'Hello', text: 'Hello' } },
      { event: 'response.output_text.done', data: { text: 'Hello' } },
      { event: 'response.completed', data: { status: 'completed' } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test' });
    const chunks = [];
    for await (const chunk of client.respondAsChat({ input: 'hi' })) {
      chunks.push(chunk);
    }

    // Only delta + stop, lifecycle events should be skipped
    expect(chunks).toHaveLength(2);
    expect(chunks[0].choices[0].delta.content).toBe('Hello');
    expect(chunks[1].choices[0].finish_reason).toBe('stop');
  });

  it('should map function_call items to tool_calls delta', async () => {
    mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
      { event: 'response.output_item.added', data: { item: { id: 'item_1', type: 'function_call' } } },
      {
        event: 'response.output_item.done',
        data: {
          item: {
            id: 'item_1',
            type: 'function_call',
            name: 'get_weather',
            call_id: 'call_abc123',
            arguments: '{"city":"SF"}',
          },
        },
      },
      { event: 'response.completed', data: { id: 'resp_1' } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test' });
    const chunks = [];
    for await (const chunk of client.respondAsChat({ input: 'weather in SF' })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    const toolCallChunk = chunks[0];
    expect(toolCallChunk.choices[0].delta.tool_calls).toBeDefined();
    expect(toolCallChunk.choices[0].delta.tool_calls![0].function!.name).toBe('get_weather');
    expect(toolCallChunk.choices[0].delta.tool_calls![0].id).toBe('call_abc123');
    expect(toolCallChunk.choices[0].delta.tool_calls![0].function!.arguments).toBe('{"city":"SF"}');
  });

  it('should throw OpenResponsesError on response.failed event', async () => {
    mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_1' } },
      { event: 'response.failed', data: { error: { type: 'rate_limit_error', message: 'Too many requests', code: 'rate_limit_exceeded' } } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test' });

    let error: any;
    try {
      for await (const _ of client.respondAsChat({ input: 'test' })) {}
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(OpenResponsesError);
    expect(error.type).toBe('rate_limit_error');
    expect(error.code).toBe('rate_limit_exceeded');
    expect(error.message).toBe('Too many requests');
  });

  it('should set response ID from response.created event', async () => {
    mockOpenResponsesStream([
      { event: 'response.created', data: { id: 'resp_unique_42' } },
      { event: 'response.output_text.delta', data: { delta: 'ok', text: 'ok' } },
      { event: 'response.output_text.done', data: { text: 'ok' } },
      { event: 'response.completed', data: { id: 'resp_unique_42' } },
    ]);

    const client = new OpenClawClient({ baseUrl: 'http://test' });
    const chunks = [];
    for await (const chunk of client.respondAsChat({ input: 'test' })) {
      chunks.push(chunk);
    }

    // All chunks should carry the response ID
    for (const chunk of chunks) {
      expect(chunk.id).toBe('resp_unique_42');
    }
  });
});

