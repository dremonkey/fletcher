import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { NanoclawClient, generateChannelJid, sessionKeyToChannel } from './nanoclaw-client.js';
import type { GangliaSessionInfo } from './ganglia-types.js';
import type { SessionKey } from './session-routing.js';

describe('generateChannelJid', () => {
  it('should use participantIdentity as primary identifier', () => {
    const session: GangliaSessionInfo = {
      participantIdentity: 'alice',
      roomName: 'test-room',
    };

    const jid = generateChannelJid(session);

    expect(jid).toBe('lk:alice');
  });

  it('should use customSessionId if no participantIdentity', () => {
    const session: GangliaSessionInfo = {
      customSessionId: 'custom-123',
      roomName: 'test-room',
    };

    const jid = generateChannelJid(session);

    expect(jid).toBe('lk:custom-123');
  });

  it('should combine roomName and participantSid if needed', () => {
    const session: GangliaSessionInfo = {
      roomName: 'voice-room',
      participantSid: 'PA_xyz789',
    };

    const jid = generateChannelJid(session);

    expect(jid).toBe('lk:voice-room:PA_xyz789');
  });

  it('should combine roomSid and participantSid as fallback', () => {
    const session: GangliaSessionInfo = {
      roomSid: 'RM_abc123',
      participantSid: 'PA_xyz789',
    };

    const jid = generateChannelJid(session);

    expect(jid).toBe('lk:RM_abc123:PA_xyz789');
  });

  it('should generate random jid when no identifiers available', () => {
    const session: GangliaSessionInfo = {};

    const jid = generateChannelJid(session);

    expect(jid).toMatch(/^lk:session-\d+-[a-z0-9]+$/);
  });

  it('should respect custom prefix', () => {
    const session: GangliaSessionInfo = {
      participantIdentity: 'bob',
    };

    const jid = generateChannelJid(session, 'voice');

    expect(jid).toBe('voice:bob');
  });
});

describe('NanoclawClient', () => {
  it('should use default URL from config', () => {
    const client = new NanoclawClient({
      url: 'http://localhost:9999',
    });

    expect(client.getBaseUrl()).toBe('http://localhost:9999');
  });

  it('should use default URL when not specified', () => {
    const client = new NanoclawClient({
      url: '',
    });

    // Falls back to env var or default
    expect(client.getBaseUrl()).toBeTruthy();
  });

  it('should use custom channel prefix', () => {
    const client = new NanoclawClient({
      url: 'http://localhost:18789',
      channelPrefix: 'fletcher',
    });

    expect(client.getChannelPrefix()).toBe('fletcher');
  });

  it('should default channel prefix to lk', () => {
    const client = new NanoclawClient({
      url: 'http://localhost:18789',
    });

    expect(client.getChannelPrefix()).toBe('lk');
  });

  it('should store and retrieve default session', () => {
    const client = new NanoclawClient({
      url: 'http://localhost:18789',
    });

    const session: GangliaSessionInfo = {
      participantIdentity: 'test-user',
      roomName: 'test-room',
    };

    client.setDefaultSession(session);

    expect(client.getDefaultSession()).toEqual(session);
  });

  it('should return undefined for default session when not set', () => {
    const client = new NanoclawClient({
      url: 'http://localhost:18789',
    });

    expect(client.getDefaultSession()).toBeUndefined();
  });
});

describe('sessionKeyToChannel', () => {
  it('owner → "main"', () => {
    expect(sessionKeyToChannel({ type: 'owner', key: 'main' })).toBe('main');
  });

  it('guest → "guest:{identity}"', () => {
    expect(sessionKeyToChannel({ type: 'guest', key: 'guest_bob' })).toBe('guest:bob');
  });

  it('room → "room:{room_name}"', () => {
    expect(sessionKeyToChannel({ type: 'room', key: 'room_standup' })).toBe('room:standup');
  });

  it('handles identity with underscores — splits on first only', () => {
    expect(sessionKeyToChannel({ type: 'guest', key: 'guest_user_name' })).toBe('guest:user_name');
  });

  it('handles room name with underscores', () => {
    expect(sessionKeyToChannel({ type: 'room', key: 'room_my_project_room' })).toBe('room:my_project_room');
  });
});

describe('NanoclawClient sessionKey routing', () => {
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

  it('owner sessionKey → X-Nanoclaw-Channel: main', async () => {
    const mockFetch = mockSuccessResponse();
    const client = new NanoclawClient({ url: 'http://test' });

    const stream = client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      sessionKey: { type: 'owner', key: 'main' },
    });
    for await (const _ of stream) {}

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;

    expect(headers['X-Nanoclaw-Channel']).toBe('main');
  });

  it('guest sessionKey → X-Nanoclaw-Channel: guest:{identity}', async () => {
    const mockFetch = mockSuccessResponse();
    const client = new NanoclawClient({ url: 'http://test' });

    const stream = client.chat({
      messages: [],
      sessionKey: { type: 'guest', key: 'guest_bob' },
    });
    for await (const _ of stream) {}

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;

    expect(headers['X-Nanoclaw-Channel']).toBe('guest:bob');
  });

  it('room sessionKey → X-Nanoclaw-Channel: room:{name}', async () => {
    const mockFetch = mockSuccessResponse();
    const client = new NanoclawClient({ url: 'http://test' });

    const stream = client.chat({
      messages: [],
      sessionKey: { type: 'room', key: 'room_standup' },
    });
    for await (const _ of stream) {}

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;

    expect(headers['X-Nanoclaw-Channel']).toBe('room:standup');
  });

  it('sessionKey takes priority over legacy session', async () => {
    const mockFetch = mockSuccessResponse();
    const client = new NanoclawClient({ url: 'http://test' });
    client.setDefaultSession({ participantIdentity: 'old-user' });

    const stream = client.chat({
      messages: [],
      sessionKey: { type: 'owner', key: 'main' },
    });
    for await (const _ of stream) {}

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;

    // Should use sessionKey, not legacy JID
    expect(headers['X-Nanoclaw-Channel']).toBe('main');
  });

  it('falls back to legacy JID when no sessionKey', async () => {
    const mockFetch = mockSuccessResponse();
    const client = new NanoclawClient({ url: 'http://test', channelPrefix: 'lk' });
    client.setDefaultSession({ participantIdentity: 'alice' });

    const stream = client.chat({ messages: [] });
    for await (const _ of stream) {}

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;

    expect(headers['X-Nanoclaw-Channel']).toBe('lk:alice');
  });
});
