import { describe, it, expect } from 'bun:test';
import { NanoclawLLM, extractNanoclawSession } from './nanoclaw.js';
import { llm as agents } from '@livekit/agents';
import type { GangliaSessionInfo } from './ganglia-types.js';

describe('NanoclawLLM', () => {
  it('should have the correct label', () => {
    const llm = new NanoclawLLM({ url: 'http://localhost:18789' });
    expect(llm.label()).toBe('nanoclaw');
  });

  it('should have the correct gangliaType', () => {
    const llm = new NanoclawLLM({ url: 'http://localhost:18789' });
    expect(llm.gangliaType()).toBe('nanoclaw');
  });

  it('should have the correct model', () => {
    const llm = new NanoclawLLM({ url: 'http://localhost:18789' });
    expect(llm.model).toBe('nanoclaw');
  });

  it('should expose the underlying client', () => {
    const llm = new NanoclawLLM({ url: 'http://localhost:18789' });
    const client = llm.getClient();
    expect(client).toBeDefined();
    expect(client.getBaseUrl()).toBe('http://localhost:18789');
  });

  it('should allow setting default session', () => {
    const llm = new NanoclawLLM({ url: 'http://localhost:18789' });
    const session: GangliaSessionInfo = {
      roomSid: 'RM_test',
      participantIdentity: 'user-test',
    };

    llm.setDefaultSession(session);

    const client = llm.getClient();
    expect(client.getDefaultSession()).toEqual(session);
  });

  it('should pass channel prefix to client', () => {
    const llm = new NanoclawLLM({
      url: 'http://localhost:18789',
      channelPrefix: 'voice',
    });
    const client = llm.getClient();
    expect(client.getChannelPrefix()).toBe('voice');
  });
});

describe('extractNanoclawSession', () => {
  it('should extract room info from ChatContext', () => {
    const chatCtx = {
      room: {
        name: 'test-room',
        sid: 'RM_abc123',
      },
      items: [],
    };

    const session = extractNanoclawSession(chatCtx as any);

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

    const session = extractNanoclawSession(chatCtx as any);

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

    const session = extractNanoclawSession(chatCtx as any);

    expect(session.customSessionId).toBe('custom-session-123');
  });

  it('should extract sessionId from connection options', () => {
    const chatCtx = { items: [] };
    const connOptions = { sessionId: 'conn-session-456' };

    const session = extractNanoclawSession(chatCtx as any, connOptions);

    expect(session.customSessionId).toBe('conn-session-456');
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

    const session = extractNanoclawSession(chatCtx as any, connOptions);

    expect(session.roomSid).toBe('RM_ctx');
    expect(session.roomName).toBe('ctx-room');
    expect(session.participantIdentity).toBe('ctx-user');
    expect(session.participantSid).toBe('PA_ctx');
  });

  it('should return empty session when no info available', () => {
    const chatCtx = { items: [] };

    const session = extractNanoclawSession(chatCtx as any);

    expect(session.roomSid).toBeUndefined();
    expect(session.roomName).toBeUndefined();
    expect(session.participantIdentity).toBeUndefined();
    expect(session.participantSid).toBeUndefined();
    expect(session.customSessionId).toBeUndefined();
  });
});

describe('historyMode', () => {
  function createCaptureStream(historyMode?: 'full' | 'latest') {
    const llm = new NanoclawLLM({ url: 'http://localhost:18789', historyMode });
    const client = llm.getClient();
    let capturedMessages: any[] = [];

    async function* gen() {
      yield {
        id: 'chatcmpl-test',
        choices: [{ delta: { role: 'assistant', content: 'ok' } }],
      };
    }

    (client as any).chat = (opts: any) => {
      capturedMessages = opts.messages;
      return gen();
    };

    return { llm, getCaptured: () => capturedMessages };
  }

  it('default historyMode for Nanoclaw is "full"', async () => {
    const { llm, getCaptured } = createCaptureStream(); // no explicit historyMode
    const chatCtx = new (agents as any).ChatContext();
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'First' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'assistant', text: 'Reply' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'Second' }));

    const stream = llm.chat({ chatCtx });
    await (stream as any).run();

    // Default is 'full' for nanoclaw, so all messages should be sent
    expect(getCaptured().length).toBe(3);
  });

  it('historyMode: "latest" sends only from last user message', async () => {
    const { llm, getCaptured } = createCaptureStream('latest');
    const chatCtx = new (agents as any).ChatContext();
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'First' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'assistant', text: 'Reply' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'Second' }));

    const stream = llm.chat({ chatCtx });
    await (stream as any).run();

    expect(getCaptured().length).toBe(1);
    expect(getCaptured()[0].role).toBe('user');
    expect(getCaptured()[0].content).toBe('Second');
  });
});

describe('Message Mapping', () => {
  it('should create a chat stream from ChatContext', () => {
    const llm = new NanoclawLLM({ url: 'http://localhost:18789' });
    const chatCtx = new (agents as any).ChatContext();
    const msg = new (agents as any).ChatMessage({
      role: 'user' as any,
      text: 'Hello from voice',
    });
    chatCtx.items.push(msg);

    const stream = llm.chat({ chatCtx: chatCtx as any });

    expect(stream).toBeDefined();
  });
});
