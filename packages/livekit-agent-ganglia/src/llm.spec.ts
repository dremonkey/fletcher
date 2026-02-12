import { describe, it, expect } from 'bun:test';
import { OpenClawLLM, extractSessionFromContext } from './llm.js';
import { llm as agents } from '@livekit/agents';
import type { LiveKitSessionInfo } from './types/index.js';

describe('OpenClawLLM', () => {
  it('should have the correct label and model', () => {
    const llm = new OpenClawLLM({ model: 'test-model' });
    expect(llm.label()).toBe('openclaw');
    expect(llm.model).toBe('test-model');
  });

  it('should default model if not provided', () => {
    const llm = new OpenClawLLM();
    expect(llm.model).toBe('openclaw-gateway');
  });

  it('should expose the underlying client', () => {
    const llm = new OpenClawLLM();
    const client = llm.getClient();
    expect(client).toBeDefined();
  });

  it('should allow setting default session', () => {
    const llm = new OpenClawLLM();
    const session: LiveKitSessionInfo = {
      roomSid: 'RM_test',
      participantIdentity: 'user-test',
    };

    llm.setDefaultSession(session);

    const client = llm.getClient();
    expect(client.getDefaultSession()).toEqual(session);
  });
});

describe('Message Mapping', () => {
  it('should correctly map LiveKit ChatMessage to OpenClawMessage', async () => {
    const llm = new OpenClawLLM();
    const chatCtx = new (agents as any).ChatContext();
    const msg = new (agents as any).ChatMessage({
      role: 'user' as any,
      text: 'Hello World',
    });
    chatCtx.items.push(msg);

    const stream = llm.chat({ chatCtx: chatCtx as any });
    expect(stream).toBeDefined();
  });
});

describe('extractSessionFromContext', () => {
  it('should extract room info from ChatContext', () => {
    const chatCtx = {
      room: {
        name: 'test-room',
        sid: 'RM_abc123',
      },
      items: [],
    };

    const session = extractSessionFromContext(chatCtx as any);

    expect(session.roomName).toBe('test-room');
    expect(session.roomSid).toBe('RM_abc123');
  });

  it('should extract participant info from ChatContext', () => {
    const chatCtx = {
      participant: {
        identity: 'user@example.com',
        sid: 'PA_xyz789',
      },
      items: [],
    };

    const session = extractSessionFromContext(chatCtx as any);

    expect(session.participantIdentity).toBe('user@example.com');
    expect(session.participantSid).toBe('PA_xyz789');
  });

  it('should extract customSessionId from metadata', () => {
    const chatCtx = {
      metadata: {
        sessionId: 'custom-session-123',
      },
      items: [],
    };

    const session = extractSessionFromContext(chatCtx as any);

    expect(session.customSessionId).toBe('custom-session-123');
  });

  it('should extract sessionId from connection options', () => {
    const chatCtx = { items: [] };
    const connOptions = { sessionId: 'conn-session-456' };

    const session = extractSessionFromContext(chatCtx as any, connOptions);

    expect(session.customSessionId).toBe('conn-session-456');
  });

  it('should extract room/participant from connection options', () => {
    const chatCtx = { items: [] };
    const connOptions = {
      roomSid: 'RM_conn',
      roomName: 'conn-room',
      participantIdentity: 'conn-user',
      participantSid: 'PA_conn',
    };

    const session = extractSessionFromContext(chatCtx as any, connOptions);

    expect(session.roomSid).toBe('RM_conn');
    expect(session.roomName).toBe('conn-room');
    expect(session.participantIdentity).toBe('conn-user');
    expect(session.participantSid).toBe('PA_conn');
  });

  it('should prefer ChatContext values over connection options', () => {
    const chatCtx = {
      room: {
        name: 'ctx-room',
        sid: 'RM_ctx',
      },
      participant: {
        identity: 'ctx-user',
        sid: 'PA_ctx',
      },
      items: [],
    };
    const connOptions = {
      roomSid: 'RM_conn',
      roomName: 'conn-room',
      participantIdentity: 'conn-user',
      participantSid: 'PA_conn',
    };

    const session = extractSessionFromContext(chatCtx as any, connOptions);

    expect(session.roomSid).toBe('RM_ctx');
    expect(session.roomName).toBe('ctx-room');
    expect(session.participantIdentity).toBe('ctx-user');
    expect(session.participantSid).toBe('PA_ctx');
  });

  it('should return empty session when no info available', () => {
    const chatCtx = { items: [] };

    const session = extractSessionFromContext(chatCtx as any);

    expect(session.roomSid).toBeUndefined();
    expect(session.roomName).toBeUndefined();
    expect(session.participantIdentity).toBeUndefined();
    expect(session.participantSid).toBeUndefined();
    expect(session.customSessionId).toBeUndefined();
  });

  it('should combine room and participant info', () => {
    const chatCtx = {
      room: {
        name: 'voice-room',
        sid: 'RM_voice123',
      },
      participant: {
        identity: 'alice',
        sid: 'PA_alice456',
      },
      items: [],
    };

    const session = extractSessionFromContext(chatCtx as any);

    expect(session.roomSid).toBe('RM_voice123');
    expect(session.roomName).toBe('voice-room');
    expect(session.participantIdentity).toBe('alice');
    expect(session.participantSid).toBe('PA_alice456');
  });
});
