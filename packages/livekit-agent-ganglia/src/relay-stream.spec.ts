/**
 * RelayChatStream unit tests.
 *
 * Tests stream orchestration using a mock StreamTransport. The mock transport
 * allows tests to inject messages and verify what was sent by the stream.
 *
 * Tests: T9, T10, T11, T12, T13, T14
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { llm } from '@livekit/agents';
import { RelayChatStream } from './relay-stream.js';
import type { StreamTransport } from './relay-transport.js';

// ---------------------------------------------------------------------------
// Mock transport
// ---------------------------------------------------------------------------

type MessageHandler = (msg: unknown) => void;

interface MockTransportControl {
  sentRequests: object[];
  sentCancels: string[];
  deliver(msg: object): void;
}

function makeMockTransport(): StreamTransport & MockTransportControl {
  const sentRequests: object[] = [];
  const sentCancels: string[] = [];
  let handler: MessageHandler | null = null;

  const transport: StreamTransport & MockTransportControl = {
    sentRequests,
    sentCancels,

    sendRequest(request: object) {
      sentRequests.push(request);
    },

    onMessage(h: MessageHandler) {
      handler = h;
      return () => {
        handler = null;
      };
    },

    sendCancel(requestId: string) {
      sentCancels.push(requestId);
    },

    deliver(msg: object) {
      handler?.(msg);
    },
  };

  return transport;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChatCtx(text: string): llm.ChatContext {
  const ctx = new llm.ChatContext();
  (ctx as any).addMessage({ role: 'user', content: text });
  return ctx;
}

/** Minimal LLM instance to pass to RelayChatStream. */
class StubLLM extends llm.LLM {
  label() { return 'stub'; }
  chat(): any { return null; }

  // In the mock environment, llm.LLM may not be EventEmitter.
  // Provide a fallback once() that collects errors for testing.
  _errorListeners: Array<(event: any) => void> = [];
  once(event: string, listener: (event: any) => void): this {
    if (event === 'error') {
      this._errorListeners.push(listener);
      // Try calling the parent if it exists
      try {
        (llm.LLM.prototype as any).once?.call(this, event, listener);
      } catch {}
    }
    return this;
  }
  emit(event: string, ...args: any[]): boolean {
    if (event === 'error') {
      for (const listener of this._errorListeners) {
        listener(args[0]);
      }
      this._errorListeners = [];
      return true;
    }
    try {
      return (llm.LLM.prototype as any).emit?.call(this, event, ...args) ?? false;
    } catch {
      return false;
    }
  }
}

async function collectChunks(stream: llm.LLMStream): Promise<llm.ChatChunk[]> {
  const chunks: llm.ChatChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

const DEFAULT_CONN_OPTIONS = { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 };

// ---------------------------------------------------------------------------
// T9: Happy path
// ---------------------------------------------------------------------------

describe('T9: happy path — request → chunks → result', () => {
  test('emits ChatChunks from session/update notifications and completes on result', async () => {
    const transport = makeMockTransport();
    const stubLlm = new StubLLM();
    const requestId = 'req-t9';

    const stream = new RelayChatStream(stubLlm, transport, {
      chatCtx: makeChatCtx('Hello relay'),
      connOptions: DEFAULT_CONN_OPTIONS,
      streamId: 'stream-t9',
      requestId,
      promptTimeoutMs: 10_000,
    });

    // Wait a tick so startSoon() fires and run() subscribes via transport
    await new Promise((r) => setTimeout(r, 0));

    // Verify the request was published
    expect(transport.sentRequests.length).toBe(1);
    const sentReq = transport.sentRequests[0] as any;
    expect(sentReq.jsonrpc).toBe('2.0');
    expect(sentReq.method).toBe('session/prompt');
    expect(sentReq.id).toBe(requestId);
    expect(sentReq.params.prompt[0].text).toBe('Hello relay');

    // Deliver two chunk notifications
    transport.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'relay-session-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } },
      },
    });
    transport.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'relay-session-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'World' } },
      },
    });

    // Deliver the result to complete the stream
    transport.deliver({ jsonrpc: '2.0', id: requestId, result: { stopReason: 'stop' } });

    const chunks = await collectChunks(stream);
    const contentChunks = chunks.filter((c) => c.delta?.content);

    expect(contentChunks.length).toBe(2);
    expect(contentChunks[0].delta?.content).toBe('Hello ');
    expect(contentChunks[1].delta?.content).toBe('World');
    expect(contentChunks[0].delta?.role).toBe('assistant');
  });
});

// ---------------------------------------------------------------------------
// T10: Pondering timer
// ---------------------------------------------------------------------------

describe('T10: pondering timer', () => {
  test('fires initial phrase on run(), clears on first content chunk', async () => {
    const transport = makeMockTransport();
    const stubLlm = new StubLLM();
    const requestId = 'req-t10';

    const ponderingEvents: Array<{ phrase: string | null; streamId: string }> = [];

    const stream = new RelayChatStream(stubLlm, transport, {
      chatCtx: makeChatCtx('Ponder'),
      connOptions: DEFAULT_CONN_OPTIONS,
      streamId: 'stream-t10',
      requestId,
      promptTimeoutMs: 10_000,
      onPondering: (phrase, streamId) => ponderingEvents.push({ phrase, streamId }),
    });

    await new Promise((r) => setTimeout(r, 10));

    // First event: initial pondering phrase (non-null)
    expect(ponderingEvents.length).toBeGreaterThanOrEqual(1);
    expect(ponderingEvents[0].phrase).not.toBeNull();
    expect(typeof ponderingEvents[0].phrase).toBe('string');
    expect(ponderingEvents[0].streamId).toBe('stream-t10');

    const countBeforeContent = ponderingEvents.length;

    // Deliver first content chunk — should clear pondering (null event)
    transport.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' } },
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    // A null event should have been fired after the first content
    const nullEvents = ponderingEvents.filter((e) => e.phrase === null);
    expect(nullEvents.length).toBeGreaterThanOrEqual(1);

    // Complete the stream
    transport.deliver({ jsonrpc: '2.0', id: requestId, result: { stopReason: 'stop' } });
    await collectChunks(stream);

    // After stream completes, no new non-null pondering events should fire
    const phraseEventsAfterContent = ponderingEvents
      .slice(countBeforeContent)
      .filter((e) => e.phrase !== null);
    expect(phraseEventsAfterContent.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T11: onContent accumulation
// ---------------------------------------------------------------------------

describe('T11: onContent callback accumulation', () => {
  test('called with delta and accumulated text for each chunk', async () => {
    const transport = makeMockTransport();
    const stubLlm = new StubLLM();
    const requestId = 'req-t11';

    const contentEvents: Array<{ delta: string; fullText: string; streamId: string }> = [];

    const stream = new RelayChatStream(stubLlm, transport, {
      chatCtx: makeChatCtx('Accumulate'),
      connOptions: DEFAULT_CONN_OPTIONS,
      streamId: 'stream-t11',
      requestId,
      promptTimeoutMs: 10_000,
      onContent: (delta, fullText, streamId) =>
        contentEvents.push({ delta, fullText, streamId }),
    });

    await new Promise((r) => setTimeout(r, 0));

    transport.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Foo' } } },
    });
    transport.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Bar' } } },
    });
    transport.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Baz' } } },
    });

    transport.deliver({ jsonrpc: '2.0', id: requestId, result: { stopReason: 'stop' } });
    await collectChunks(stream);

    expect(contentEvents.length).toBe(3);
    expect(contentEvents[0]).toEqual({ delta: 'Foo', fullText: 'Foo', streamId: 'stream-t11' });
    expect(contentEvents[1]).toEqual({ delta: 'Bar', fullText: 'FooBar', streamId: 'stream-t11' });
    expect(contentEvents[2]).toEqual({ delta: 'Baz', fullText: 'FooBarBaz', streamId: 'stream-t11' });
  });
});

// ---------------------------------------------------------------------------
// T12: close() sends cancel
// ---------------------------------------------------------------------------

describe('T12: close() sends cancel on voice-acp', () => {
  test('close() calls sendCancel on the transport', async () => {
    const transport = makeMockTransport();
    const stubLlm = new StubLLM();
    const requestId = 'req-t12';

    const stream = new RelayChatStream(stubLlm, transport, {
      chatCtx: makeChatCtx('Cancel me'),
      connOptions: DEFAULT_CONN_OPTIONS,
      streamId: 'stream-t12',
      requestId,
      promptTimeoutMs: 10_000,
    });

    await new Promise((r) => setTimeout(r, 0));

    stream.close();

    // sendCancel should have been called
    expect(transport.sentCancels.length).toBe(1);
    expect(transport.sentCancels[0]).toBe(requestId);
  });
});

// ---------------------------------------------------------------------------
// T13: Timeout
// ---------------------------------------------------------------------------

describe('T13: no response within timeout', () => {
  test('throws timeout error when relay does not respond', async () => {
    const transport = makeMockTransport();
    const stubLlm = new StubLLM();

    const stream = new RelayChatStream(stubLlm, transport, {
      chatCtx: makeChatCtx('Timeout test'),
      connOptions: DEFAULT_CONN_OPTIONS,
      streamId: 'stream-t13',
      requestId: 'req-t13',
      promptTimeoutMs: 100, // Very short timeout
    });

    // In the mock environment, the error is re-thrown from the async iterator.
    // In production (real LLMStream), the error is emitted on the LLM instance.
    // Test both paths.
    let caughtError: Error | null = null;
    let emittedError: Error | null = null;

    // Try to capture via the event emitter if available
    try {
      stubLlm.once('error', (event: any) => {
        emittedError = event?.error ?? event;
      });
    } catch {}

    try {
      await collectChunks(stream);
    } catch (e) {
      caughtError = e as Error;
    }

    // Wait for async error propagation (timer fires after 100ms)
    await new Promise((r) => setTimeout(r, 200));

    const error = caughtError ?? emittedError;
    expect(error).not.toBeNull();
    expect((error as Error).message).toContain('timed out after 100ms');
  });
});

// ---------------------------------------------------------------------------
// T14: JSON-RPC error response
// ---------------------------------------------------------------------------

describe('T14: JSON-RPC error response from relay', () => {
  test('throws with error message from relay error response', async () => {
    const transport = makeMockTransport();
    const stubLlm = new StubLLM();

    const stream = new RelayChatStream(stubLlm, transport, {
      chatCtx: makeChatCtx('Error test'),
      connOptions: DEFAULT_CONN_OPTIONS,
      streamId: 'stream-t14',
      requestId: 'req-t14',
      promptTimeoutMs: 10_000,
    });

    await new Promise((r) => setTimeout(r, 0));

    // Deliver a JSON-RPC error response
    transport.deliver({
      jsonrpc: '2.0',
      id: 'req-t14',
      error: { code: -32000, message: 'ACP subprocess died' },
    });

    // In the mock, error is re-thrown from the async iterator.
    // In production (real LLMStream), the error is emitted on the LLM instance.
    let caughtError: Error | null = null;
    let emittedError: Error | null = null;

    try {
      stubLlm.once('error', (event: any) => {
        emittedError = event?.error ?? event;
      });
    } catch {}

    try {
      await collectChunks(stream);
    } catch (e) {
      caughtError = e as Error;
    }

    const error = caughtError ?? emittedError;
    expect(error).not.toBeNull();
    expect((error as Error).message).toContain('JSON-RPC error from relay');
    expect((error as Error).message).toContain('ACP subprocess died');
  });
});

// ---------------------------------------------------------------------------
// Edge case: non-text update types are ignored
// ---------------------------------------------------------------------------

describe('non-text update kinds', () => {
  test('available_commands_update does not emit ChatChunks', async () => {
    const transport = makeMockTransport();
    const stubLlm = new StubLLM();
    const requestId = 'req-nontext';

    const stream = new RelayChatStream(stubLlm, transport, {
      chatCtx: makeChatCtx('Test'),
      connOptions: DEFAULT_CONN_OPTIONS,
      streamId: 'stream-nontext',
      requestId,
      promptTimeoutMs: 10_000,
    });

    await new Promise((r) => setTimeout(r, 0));

    // Non-text update — should be silently ignored
    transport.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's',
        update: { sessionUpdate: 'available_commands_update', availableCommands: [] },
      },
    });

    // Text update — should produce a ChatChunk
    transport.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Only this' } },
      },
    });

    transport.deliver({ jsonrpc: '2.0', id: requestId, result: { stopReason: 'stop' } });
    const chunks = await collectChunks(stream);
    const contentChunks = chunks.filter((c) => c.delta?.content);
    expect(contentChunks.length).toBe(1);
    expect(contentChunks[0].delta?.content).toBe('Only this');
  });
});
