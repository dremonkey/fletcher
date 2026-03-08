import { describe, it, expect, mock, beforeAll } from 'bun:test';
import { OpenClawLLM, extractSessionFromContext } from './llm.js';
import { llm as agents } from '@livekit/agents';
import type { LiveKitSessionInfo, OpenClawChatResponse } from './types/index.js';

// LLMStream constructor requires the @livekit/agents logger to be initialized.
// In production this happens via cli.runApp(); in tests we must do it manually.
// initializeLogger is @internal (excluded from .d.ts) but re-exported at runtime.
import * as agentsPkg from '@livekit/agents';
beforeAll(() => {
  (agentsPkg as any).initializeLogger({ pretty: false, level: 'silent' });
});

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
    // TASK-013: STT metadata is now sent once as a bootstrap message at session
    // start (see bootstrap.ts), no longer wrapped per-message.
    // Content is passed through as-is (no STT wrapper prepended).
    expect(capturedMessages[0].content ?? '').not.toInclude('Speech-to-Text');
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
// historyMode filtering
// ---------------------------------------------------------------------------

describe('historyMode', () => {
  /** Helper: create an LLM + stream with a mock client that captures sent messages. */
  function createCaptureStream(historyMode?: 'full' | 'latest') {
    const llm = new OpenClawLLM({ historyMode });
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

  it('historyMode: "full" sends all messages', async () => {
    const { llm, getCaptured } = createCaptureStream('full');
    const chatCtx = new (agents as any).ChatContext();
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'system', text: 'You are helpful' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'Hello' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'assistant', text: 'Hi there' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'How are you?' }));

    const stream = llm.chat({ chatCtx });
    await (stream as any).run();

    expect(getCaptured().length).toBe(4);
    expect(getCaptured()[0].role).toBe('system');
    expect(getCaptured()[3].role).toBe('user');
  });

  it('historyMode: "latest" sends only from last user message', async () => {
    const { llm, getCaptured } = createCaptureStream('latest');
    const chatCtx = new (agents as any).ChatContext();
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'system', text: 'You are helpful' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'Hello' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'assistant', text: 'Hi there' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'How are you?' }));

    const stream = llm.chat({ chatCtx });
    await (stream as any).run();

    expect(getCaptured().length).toBe(1);
    expect(getCaptured()[0].role).toBe('user');
    expect(getCaptured()[0].content).toContain('How are you?');
  });

  it('historyMode: "latest" with tool calls sends user + tool_call + tool_result', async () => {
    const { llm, getCaptured } = createCaptureStream('latest');
    const chatCtx = new (agents as any).ChatContext();
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'system', text: 'System prompt' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'Old question' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'assistant', text: 'Old answer' }));
    // Latest turn: user asks something that triggers a tool call
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'What time is it?' }));
    // Assistant responds with a tool call
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'assistant', text: '' }));
    chatCtx.items.push(new (agents as any).FunctionCall({
      callId: 'call_123',
      name: 'get_time',
      args: '{}',
    }));
    // Tool result
    chatCtx.items.push({
      type: 'function_call_output',
      callId: 'call_123',
      name: 'get_time',
      output: '3:00 PM',
    });

    const stream = llm.chat({ chatCtx });
    await (stream as any).run();

    // Should have: user message, assistant (with tool_calls), tool result = 3 messages
    const msgs = getCaptured();
    expect(msgs.length).toBe(3);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toContain('What time is it?');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].tool_calls).toBeDefined();
    expect(msgs[1].tool_calls[0].function.name).toBe('get_time');
    expect(msgs[2].role).toBe('tool');
    expect(msgs[2].content).toBe('3:00 PM');
  });

  it('default historyMode for OpenClaw is "latest"', async () => {
    const { llm, getCaptured } = createCaptureStream(); // no explicit historyMode
    const chatCtx = new (agents as any).ChatContext();
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'First' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'assistant', text: 'Reply' }));
    chatCtx.items.push(new (agents as any).ChatMessage({ role: 'user', text: 'Second' }));

    const stream = llm.chat({ chatCtx });
    await (stream as any).run();

    // Default is 'latest', so only the last user message should be sent
    expect(getCaptured().length).toBe(1);
    expect(getCaptured()[0].content).toContain('Second');
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
