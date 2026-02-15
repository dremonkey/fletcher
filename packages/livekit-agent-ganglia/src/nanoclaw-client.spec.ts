import { describe, it, expect } from 'bun:test';
import { NanoclawClient, generateChannelJid } from './nanoclaw-client.js';
import type { GangliaSessionInfo } from './ganglia-types.js';

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
