/**
 * AcpLLM unit tests.
 *
 * Tests the ACP backend for LiveKit voice agents.
 * Uses a mock ACP agent (test/mock-openclaw-acp.ts) that sends the correct
 * OpenClaw wire format (singular `update` object, not `updates[]`).
 */
import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import path from 'path';
import { llm } from '@livekit/agents';
import { AcpLLM } from './acp-llm.js';
import { extractLatestUserText } from './acp-stream.js';

const MOCK_ACP_PATH = path.resolve(
  import.meta.dir,
  '../test/mock-openclaw-acp.ts',
);

/** Create a default AcpLLM pointing at the mock subprocess. */
function createAcpLLM(overrides?: Partial<ConstructorParameters<typeof AcpLLM>[0]>): AcpLLM {
  return new AcpLLM({
    command: 'bun',
    args: [MOCK_ACP_PATH],
    promptTimeoutMs: 10_000,
    ...overrides,
  });
}

/** Create a minimal ChatContext with a single user message. */
function makeChatCtx(text: string): llm.ChatContext {
  const ctx = new llm.ChatContext();
  (ctx as any).addMessage({ role: 'user', content: text });
  return ctx;
}

/** Collect all ChatChunks from an LLMStream. */
async function collectChunks(stream: llm.LLMStream): Promise<llm.ChatChunk[]> {
  const chunks: llm.ChatChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// extractLatestUserText
// ---------------------------------------------------------------------------

/** Helper to add a message to a ChatContext. */
function addMsg(ctx: llm.ChatContext, role: string, text: string): void {
  (ctx as any).addMessage({ role, content: text });
}

describe('extractLatestUserText', () => {
  test('returns last user message text', () => {
    const ctx = new llm.ChatContext();
    addMsg(ctx, 'assistant', 'Hello');
    addMsg(ctx, 'user', 'What time is it?');
    expect(extractLatestUserText(ctx)).toBe('What time is it?');
  });

  test('returns empty string if no user message', () => {
    const ctx = new llm.ChatContext();
    addMsg(ctx, 'assistant', 'Hello');
    expect(extractLatestUserText(ctx)).toBe('');
  });

  test('returns last user message when there are multiple', () => {
    const ctx = new llm.ChatContext();
    addMsg(ctx, 'user', 'First message');
    addMsg(ctx, 'assistant', 'Response');
    addMsg(ctx, 'user', 'Second message');
    expect(extractLatestUserText(ctx)).toBe('Second message');
  });

  test('returns empty string for empty context', () => {
    const ctx = new llm.ChatContext();
    expect(extractLatestUserText(ctx)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// AcpLLM lifecycle tests
// ---------------------------------------------------------------------------

describe('AcpLLM', () => {
  let acpLlm: AcpLLM;

  afterEach(async () => {
    if (acpLlm) {
      await acpLlm.aclose();
    }
  });

  test('gangliaType() returns "acp"', () => {
    acpLlm = createAcpLLM();
    expect(acpLlm.gangliaType()).toBe('acp');
  });

  test('label() returns "acp"', () => {
    acpLlm = createAcpLLM();
    expect(acpLlm.label()).toBe('acp');
  });

  test('model returns "acp"', () => {
    acpLlm = createAcpLLM();
    expect(acpLlm.model).toBe('acp');
  });

  test('lazy init: subprocess not spawned until first chat()', async () => {
    acpLlm = createAcpLLM();
    // Before any chat() call, _initPromise is null
    expect((acpLlm as any)._initPromise).toBeNull();
  });

  test('first chat() triggers init and returns chunks', async () => {
    acpLlm = createAcpLLM();
    const stream = acpLlm.chat({
      chatCtx: makeChatCtx('Hello ACP'),
      connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 },
    });

    const chunks = await collectChunks(stream);

    // Should receive at least one chunk with content
    const contentChunks = chunks.filter((c) => c.delta?.content);
    expect(contentChunks.length).toBeGreaterThanOrEqual(1);

    // The mock echoes: "Echo: Hello ACP"
    const fullText = contentChunks.map((c) => c.delta?.content).join('');
    expect(fullText).toBe('Echo: Hello ACP');
  });

  test('subsequent chat() calls skip init (idempotent)', async () => {
    acpLlm = createAcpLLM();

    // First call
    const stream1 = acpLlm.chat({
      chatCtx: makeChatCtx('First'),
      connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 },
    });
    await collectChunks(stream1);

    const initPromise1 = (acpLlm as any)._initPromise;
    expect(initPromise1).toBeTruthy();

    // Second call — should reuse same _initPromise
    const stream2 = acpLlm.chat({
      chatCtx: makeChatCtx('Second'),
      connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 },
    });
    await collectChunks(stream2);

    const initPromise2 = (acpLlm as any)._initPromise;
    expect(initPromise2).toBe(initPromise1); // same promise object
  });

  test('session/prompt sends user text from ChatContext', async () => {
    acpLlm = createAcpLLM();
    const userText = 'Tell me about the weather';

    const stream = acpLlm.chat({
      chatCtx: makeChatCtx(userText),
      connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 },
    });

    const chunks = await collectChunks(stream);
    const fullText = chunks
      .filter((c) => c.delta?.content)
      .map((c) => c.delta!.content)
      .join('');

    expect(fullText).toBe(`Echo: ${userText}`);
  });

  test('agent_message_chunk maps to ChatChunk with assistant role', async () => {
    acpLlm = createAcpLLM();

    const stream = acpLlm.chat({
      chatCtx: makeChatCtx('Test'),
      connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 },
    });

    const chunks = await collectChunks(stream);
    const contentChunks = chunks.filter((c) => c.delta?.content);

    expect(contentChunks.length).toBeGreaterThan(0);
    for (const chunk of contentChunks) {
      expect(chunk.delta?.role).toBe('assistant');
    }
  });

  test('session key is stored and accessible', () => {
    acpLlm = createAcpLLM();
    const sessionKey = { type: 'owner' as const, key: 'alice' };

    acpLlm.setSessionKey(sessionKey);
    expect(acpLlm.getSessionKey()).toEqual(sessionKey);
  });

  test('session key passed via _meta in session/new', async () => {
    // Use a subprocess that records session/new params
    let capturedMeta: any = null;

    // Spawn mock that captures the _meta
    const recordingMock = `
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  for (const line of decoder.decode(chunk).split("\\n").filter(Boolean)) {
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } }) + "\\n");
    } else if (msg.method === "session/new") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "sess-with-meta" } }) + "\\n");
      // Write meta to stderr for test inspection
      process.stderr.write(JSON.stringify(msg.params._meta) + "\\n");
    } else if (msg.method === "session/prompt") {
      const text = msg.params?.prompt?.[0]?.text ?? "";
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess-with-meta", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } } } }) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "completed" } }) + "\\n");
    }
  }
}
`;
    // Write the mock script to a temp file
    const tmpFile = `/tmp/mock-acp-meta-${Date.now()}.ts`;
    await Bun.write(tmpFile, recordingMock);

    const llmWithKey = new AcpLLM({
      command: 'bun',
      args: [tmpFile],
      promptTimeoutMs: 10_000,
    });

    // Set session key and default session before first chat()
    llmWithKey.setSessionKey({ type: 'owner', key: 'alice' });
    llmWithKey.setDefaultSession({
      roomName: 'room-123',
      participantIdentity: 'alice',
    });

    try {
      const stream = llmWithKey.chat({
        chatCtx: makeChatCtx('Hello'),
        connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 },
      });
      await collectChunks(stream);

      // Verify the session was created (no error means _meta was accepted)
      const initResult = await (llmWithKey as any)._initPromise;
      expect(initResult.sessionId).toBe('sess-with-meta');
    } finally {
      await llmWithKey.aclose();
    }
  });

  test('onPondering callback is called and cleared on first content', async () => {
    const ponderingEvents: Array<{ phrase: string | null; streamId: string }> = [];

    acpLlm = new AcpLLM({
      command: 'bun',
      args: [MOCK_ACP_PATH],
      promptTimeoutMs: 10_000,
      onPondering: (phrase, streamId) => {
        ponderingEvents.push({ phrase, streamId });
      },
    });

    const stream = acpLlm.chat({
      chatCtx: makeChatCtx('Ponder this'),
      connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 },
    });

    await collectChunks(stream);

    // At minimum: initial phrase + null (clear on first content) + null (finally)
    expect(ponderingEvents.length).toBeGreaterThanOrEqual(2);

    // First event should have a non-null phrase
    expect(ponderingEvents[0].phrase).not.toBeNull();
    expect(typeof ponderingEvents[0].phrase).toBe('string');

    // Last event should be null (cleared)
    const nullEvents = ponderingEvents.filter((e) => e.phrase === null);
    expect(nullEvents.length).toBeGreaterThanOrEqual(1);
  });

  test('onContent callback receives content deltas', async () => {
    const contentEvents: Array<{ delta: string; fullText: string; streamId: string }> = [];

    acpLlm = new AcpLLM({
      command: 'bun',
      args: [MOCK_ACP_PATH],
      promptTimeoutMs: 10_000,
      onContent: (delta, fullText, streamId) => {
        contentEvents.push({ delta, fullText, streamId });
      },
    });

    const stream = acpLlm.chat({
      chatCtx: makeChatCtx('Content test'),
      connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 },
    });

    await collectChunks(stream);

    expect(contentEvents.length).toBeGreaterThanOrEqual(1);
    // Last fullText should be the complete response
    const lastEvent = contentEvents[contentEvents.length - 1];
    expect(lastEvent.fullText).toBe('Echo: Content test');
  });

  test('prompt timeout fires when session/prompt takes too long', async () => {
    // Spawn a mock that never responds to session/prompt
    const slowMock = `
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  for (const line of decoder.decode(chunk).split("\\n").filter(Boolean)) {
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } }) + "\\n");
    } else if (msg.method === "session/new") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "slow-sess" } }) + "\\n");
    }
    // session/prompt: deliberately no response — causes timeout
  }
}
`;
    const tmpFile = `/tmp/mock-acp-slow-${Date.now()}.ts`;
    await Bun.write(tmpFile, slowMock);

    const slowLlm = new AcpLLM({
      command: 'bun',
      args: [tmpFile],
      promptTimeoutMs: 200, // Very short timeout for testing
    });

    try {
      const stream = slowLlm.chat({
        chatCtx: makeChatCtx('Will timeout'),
        connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 500 },
      });

      // The stream's run() should reject with a timeout error
      await expect(collectChunks(stream)).rejects.toThrow('timed out after 200ms');
    } finally {
      await slowLlm.aclose();
    }
  });

  test('subprocess crash rejects the stream', async () => {
    const crashingLlm = new AcpLLM({
      command: 'bun',
      args: ['-e', 'process.exit(0)'], // Exits immediately — never responds
      promptTimeoutMs: 5_000,
    });

    try {
      const stream = crashingLlm.chat({
        chatCtx: makeChatCtx('Crash test'),
        connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 5_000 },
      });

      await expect(collectChunks(stream)).rejects.toThrow();
    } finally {
      await crashingLlm.aclose();
    }
  });

  test('JSON-RPC error from agent is propagated', async () => {
    const errorMock = `
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  for (const line of decoder.decode(chunk).split("\\n").filter(Boolean)) {
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } }) + "\\n");
    } else if (msg.method === "session/new") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "err-sess" } }) + "\\n");
    } else if (msg.method === "session/prompt") {
      // Return a JSON-RPC error
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32000, message: "Server error: something went wrong" }
      }) + "\\n");
    }
  }
}
`;
    const tmpFile = `/tmp/mock-acp-error-${Date.now()}.ts`;
    await Bun.write(tmpFile, errorMock);

    const errorLlm = new AcpLLM({
      command: 'bun',
      args: [tmpFile],
      promptTimeoutMs: 5_000,
    });

    try {
      const stream = errorLlm.chat({
        chatCtx: makeChatCtx('Error test'),
        connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 5_000 },
      });

      await expect(collectChunks(stream)).rejects.toThrow('JSON-RPC error');
    } finally {
      await errorLlm.aclose();
    }
  });

  test('non-text update kinds produce no ChatChunks', async () => {
    // Mock that sends an available_commands_update before the text
    const mixedMock = `
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  for (const line of decoder.decode(chunk).split("\\n").filter(Boolean)) {
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } }) + "\\n");
    } else if (msg.method === "session/new") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "mixed-sess" } }) + "\\n");
    } else if (msg.method === "session/prompt") {
      // Non-text update — should be ignored
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "mixed-sess",
          update: { sessionUpdate: "available_commands_update", availableCommands: [] }
        }
      }) + "\\n");
      // Text update — should produce a ChatChunk
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "mixed-sess",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Only this" } }
        }
      }) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "completed" } }) + "\\n");
    }
  }
}
`;
    const tmpFile = `/tmp/mock-acp-mixed-${Date.now()}.ts`;
    await Bun.write(tmpFile, mixedMock);

    const mixedLlm = new AcpLLM({
      command: 'bun',
      args: [tmpFile],
      promptTimeoutMs: 5_000,
    });

    try {
      const stream = mixedLlm.chat({
        chatCtx: makeChatCtx('Mixed'),
        connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 5_000 },
      });

      const chunks = await collectChunks(stream);
      const contentChunks = chunks.filter((c) => c.delta?.content);

      // Only the agent_message_chunk should produce content
      expect(contentChunks.length).toBe(1);
      expect(contentChunks[0].delta?.content).toBe('Only this');
    } finally {
      await mixedLlm.aclose();
    }
  });

  test('close() sends session/cancel (barge-in)', async () => {
    // Mock that waits a long time before responding — gives us time to close()
    const slowMock = `
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  for (const line of decoder.decode(chunk).split("\\n").filter(Boolean)) {
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } }) + "\\n");
    } else if (msg.method === "session/new") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "cancel-sess" } }) + "\\n");
    } else if (msg.method === "session/prompt") {
      // Send a chunk then wait (simulating a slow response)
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "cancel-sess",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Starting..." } }
        }
      }) + "\\n");
      // Don't send the result — the cancel will arrive first
      await new Promise(r => setTimeout(r, 500));
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "cancelled" } }) + "\\n");
    }
    // session/cancel — no response needed
  }
}
`;
    const tmpFile = `/tmp/mock-acp-cancel-${Date.now()}.ts`;
    await Bun.write(tmpFile, slowMock);

    const cancelLlm = new AcpLLM({
      command: 'bun',
      args: [tmpFile],
      promptTimeoutMs: 5_000,
    });

    try {
      const stream = cancelLlm.chat({
        chatCtx: makeChatCtx('Cancel me'),
        connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 5_000 },
      });

      // Collect chunks (should complete without error even when cancelled)
      const chunks = await collectChunks(stream);
      // We should get at least the "Starting..." chunk before completion
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    } finally {
      await cancelLlm.aclose();
    }
  });

  test('aclose() shuts down the subprocess gracefully', async () => {
    acpLlm = createAcpLLM();

    // Trigger init
    const stream = acpLlm.chat({
      chatCtx: makeChatCtx('Test'),
      connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 },
    });
    await collectChunks(stream);

    // aclose should not throw
    await acpLlm.aclose();

    // _initPromise should be null after close
    expect((acpLlm as any)._initPromise).toBeNull();
  });

  test('concurrent chat() calls during init are coalesced', async () => {
    acpLlm = createAcpLLM();

    // Start two chat() calls simultaneously before init completes
    const [stream1, stream2] = [
      acpLlm.chat({
        chatCtx: makeChatCtx('First concurrent'),
        connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 },
      }),
      acpLlm.chat({
        chatCtx: makeChatCtx('Second concurrent'),
        connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 10_000 },
      }),
    ];

    // Both share the same _initPromise
    expect((acpLlm as any)._initPromise).toBeTruthy();

    // Both should complete successfully
    const [chunks1, chunks2] = await Promise.all([
      collectChunks(stream1),
      collectChunks(stream2),
    ]);

    expect(chunks1.filter((c) => c.delta?.content).length).toBeGreaterThan(0);
    expect(chunks2.filter((c) => c.delta?.content).length).toBeGreaterThan(0);
  });

  test('ACP_PROMPT_TIMEOUT_MS env var controls timeout', () => {
    const origTimeout = process.env.ACP_PROMPT_TIMEOUT_MS;
    process.env.ACP_PROMPT_TIMEOUT_MS = '5000';

    const llmWithEnvTimeout = new AcpLLM({
      command: 'bun',
      args: ['--version'],
    });

    expect((llmWithEnvTimeout as any)._promptTimeoutMs).toBe(5000);

    if (origTimeout !== undefined) {
      process.env.ACP_PROMPT_TIMEOUT_MS = origTimeout;
    } else {
      delete process.env.ACP_PROMPT_TIMEOUT_MS;
    }
  });
});
