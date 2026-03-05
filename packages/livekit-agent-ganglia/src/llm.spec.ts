import { describe, it, expect, mock } from 'bun:test';
import { OpenClawLLM, extractSessionFromContext } from './llm.js';
import { llm as agents } from '@livekit/agents';
import type { LiveKitSessionInfo, OpenClawChatResponse } from './types/index.js';

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

  it('should skip empty system messages to prevent LLM hang', async () => {
    async function* gen() {
      yield {
        id: 'chatcmpl-test',
        choices: [{ delta: { role: 'assistant', content: 'Hello' } }],
      };
    }

    const llm = new OpenClawLLM();
    const client = llm.getClient();

    // Capture the messages sent to the client
    let capturedMessages: any[] = [];
    (client as any).chat = (opts: any) => {
      capturedMessages = opts.messages;
      return gen();
    };

    const chatCtx = new (agents as any).ChatContext();
    // Empty system message (as created by `new voice.Agent({ instructions: '' })`)
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'system', text: '' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'Hello' }));

    const stream = llm.chat({ chatCtx });
    await (stream as any).run();

    // The empty system message should be filtered out
    expect(capturedMessages.length).toBe(1);
    expect(capturedMessages[0].role).toBe('user');
    // TASK-013: user messages are wrapped with STT skepticism metadata
    expect(capturedMessages[0].content).toContain('Hello');
    expect(capturedMessages[0].content).toContain('Speech-to-Text');
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

// ---------------------------------------------------------------------------
// OpenClawChatStream interrupt handling (BUG-019)
//
// These tests call run() directly on the stream to verify the three fixes:
// 1. Chunks go to this.queue (not this.output)
// 2. this.closed check exits the loop on abort
// 3. "Queue is closed" errors from put() are caught gracefully
// ---------------------------------------------------------------------------

/** Helper: create a mock chunk for the OpenClaw streaming response. */
function makeChunk(content: string, id = 'chatcmpl-test'): OpenClawChatResponse {
  return {
    id,
    choices: [{ delta: { role: 'assistant', content } }],
  };
}

/** Helper: create an OpenClawLLM + stream with a controlled async generator as the HTTP client. */
function createTestStream(gen: AsyncIterableIterator<OpenClawChatResponse>) {
  const llm = new OpenClawLLM();
  const client = llm.getClient();
  (client as any).chat = () => gen;
  const chatCtx = new (agents as any).ChatContext();
  chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'Hello' }));
  const stream = llm.chat({ chatCtx });
  return stream;
}

describe('OpenClawChatStream interrupt handling (BUG-019)', () => {
  it('should push chunks to this.queue, not this.output', async () => {
    async function* gen() {
      yield makeChunk('Hello');
      yield makeChunk(' world');
    }

    const stream = createTestStream(gen());
    await (stream as any).run();

    // Chunks should be in the internal queue, not the output queue
    const queueItems = (stream as any).queue.items;
    const outputItems = (stream as any).output.items;
    expect(queueItems.length).toBe(2);
    expect(queueItems[0].delta.content).toBe('Hello');
    expect(queueItems[1].delta.content).toBe(' world');
    expect(outputItems.length).toBe(0);
  });

  it('should exit cleanly when this.closed is true (user interruption)', async () => {
    let yieldCount = 0;
    async function* gen() {
      yield makeChunk('chunk-1'); yieldCount++;
      yield makeChunk('chunk-2'); yieldCount++;
      yield makeChunk('chunk-3'); yieldCount++;
    }

    const stream = createTestStream(gen());

    // Simulate abort after first chunk: the for-await will yield chunk-1,
    // then on the next iteration the closed check fires before put().
    // We need to set closed=true after the first chunk is processed.
    const origPut = (stream as any).queue.put.bind((stream as any).queue);
    let putCount = 0;
    (stream as any).queue.put = (item: any) => {
      origPut(item);
      putCount++;
      if (putCount === 1) {
        // Simulate user interruption after first chunk
        (stream as any).closed = true;
      }
    };

    await (stream as any).run();

    // Only the first chunk should have been put (closed check prevents further puts)
    expect(putCount).toBe(1);
    const queueItems = (stream as any).queue.items;
    expect(queueItems.length).toBe(1);
    expect(queueItems[0].delta.content).toBe('chunk-1');
  });

  it('should catch "Queue is closed" on put() without throwing', async () => {
    async function* gen() {
      yield makeChunk('before-close');
      yield makeChunk('after-close');
    }

    const stream = createTestStream(gen());

    // Close the queue after the first put — simulates race where queue
    // is closed by mainTask().finally() while run() is still processing
    let putCount = 0;
    const origPut = (stream as any).queue.put.bind((stream as any).queue);
    (stream as any).queue.put = (item: any) => {
      putCount++;
      if (putCount === 1) {
        origPut(item);
        (stream as any).queue.close(); // close queue after first put
      } else {
        // This should be caught by the try/catch
        (stream as any).queue.put = origPut; // restore for the throw
        origPut(item); // will throw "Queue is closed"
      }
    };

    // run() should NOT throw — it should catch the "Queue is closed" error
    await expect((stream as any).run()).resolves.toBeUndefined();
  });

  it('should propagate non-queue errors from the HTTP stream', async () => {
    async function* gen(): AsyncIterableIterator<OpenClawChatResponse> {
      yield makeChunk('partial');
      throw new Error('network timeout');
    }

    const stream = createTestStream(gen());

    // Non-queue errors should propagate (re-thrown by run())
    await expect((stream as any).run()).rejects.toThrow('network timeout');

    // The chunk before the error should still have been pushed
    const queueItems = (stream as any).queue.items;
    expect(queueItems.length).toBe(1);
    expect(queueItems[0].delta.content).toBe('partial');
  });

  it('should not close this.output in finally block', async () => {
    async function* gen() {
      yield makeChunk('done');
    }

    const stream = createTestStream(gen());
    await (stream as any).run();

    // output should NOT be closed by run() — base class monitorMetrics() handles that
    expect((stream as any).output.closed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BUG-022: Abort signal propagation — LLMStream.close() → fetch abort
// ---------------------------------------------------------------------------

describe('Abort signal propagation (BUG-022)', () => {
  it('should pass abortController.signal to client.chat()', async () => {
    let capturedSignal: AbortSignal | undefined;

    const llm = new OpenClawLLM();
    const client = llm.getClient();

    // Intercept client.chat() to capture the signal option
    async function* fakeChat(opts: any) {
      capturedSignal = opts.signal;
      yield makeChunk('hello');
    }
    (client as any).chat = fakeChat;

    const chatCtx = new (agents as any).ChatContext();
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'Test' }));
    const stream = llm.chat({ chatCtx });

    await (stream as any).run();

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    // The signal should be the stream's own abortController.signal
    expect(capturedSignal).toBe((stream as any).abortController.signal);
  });

  it('should abort the client signal when LLMStream.close() is called', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveHang: (() => void) | undefined;

    const llm = new OpenClawLLM();
    const client = llm.getClient();

    // Generator that hangs until we resolve — simulates a slow LLM response
    async function* fakeChat(opts: any) {
      capturedSignal = opts.signal;
      yield makeChunk('first');
      // Hang here until externally resolved
      await new Promise<void>((resolve) => { resolveHang = resolve; });
      yield makeChunk('should-not-reach');
    }
    (client as any).chat = fakeChat;

    const chatCtx = new (agents as any).ChatContext();
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'Test' }));
    const stream = llm.chat({ chatCtx });

    // Start run() in the background
    const runPromise = (stream as any).run();

    // Wait a tick for the generator to yield the first chunk and then hang
    await new Promise(r => setTimeout(r, 10));

    // Simulate what the SDK does on disconnect: call close()
    stream.close();

    expect(capturedSignal!.aborted).toBe(true);

    // Unblock the generator so run() can complete
    resolveHang?.();
    await runPromise;
  });
});
