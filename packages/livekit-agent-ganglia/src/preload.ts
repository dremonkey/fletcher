import { mock } from "bun:test";

/** Minimal mock of AsyncIterableQueue matching the @livekit/agents interface. */
class MockQueue<T> {
  private _closed = false;
  private _items: T[] = [];
  private _waiters: Array<(item: { value: T; done: false } | { value: undefined; done: true }) => void> = [];

  put(item: T) {
    if (this._closed) throw new Error('Queue is closed');
    const waiter = this._waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this._items.push(item);
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    // Resolve all waiters with done:true
    for (const waiter of this._waiters) {
      waiter({ value: undefined, done: true });
    }
    this._waiters = [];
  }

  get closed() { return this._closed; }

  /** Test helper: return items pushed so far. */
  get items() { return this._items; }

  next(): Promise<{ value: T; done: false } | { value: undefined; done: true }> {
    // Return buffered item if available
    if (this._items.length > 0) {
      return Promise.resolve({ value: this._items.shift()!, done: false });
    }
    // Queue is closed — signal end of iteration
    if (this._closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    // Wait for next item or close
    return new Promise<{ value: T; done: false } | { value: undefined; done: true }>((resolve) => {
      // Re-check in case of race
      if (this._items.length > 0) {
        resolve({ value: this._items.shift()!, done: false });
      } else if (this._closed) {
        resolve({ value: undefined, done: true });
      } else {
        this._waiters.push(resolve);
      }
    });
  }

  [Symbol.asyncIterator](): this {
    return this;
  }
}

/** Make MockQueue accessible to tests for inspection. */
(globalThis as any).__MockQueue = MockQueue;

function createLLMStreamMock() {
  return class MockLLMStream {
    output: MockQueue<any>;
    queue: MockQueue<any>;
    closed = false;
    abortController = new AbortController();
    logger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    chatCtx: any;
    toolCtx: any;
    connOptions: any;
    private _runPromise: Promise<void>;
    private _runError: any = undefined;

    constructor(llm: any, { chatCtx, toolCtx, connOptions }: any) {
      this.chatCtx = chatCtx;
      this.toolCtx = toolCtx;
      this.connOptions = connOptions;
      this.output = new MockQueue();
      this.queue = new MockQueue();

      // Start run() asynchronously, close queue when done (mirrors real behavior).
      this._runPromise = Promise.resolve().then(async () => {
        try {
          await (this as any).run();
        } catch (e) {
          this._runError = e;
          throw e;
        } finally {
          // Close the queue to signal end of iteration
          try { this.queue.close(); } catch {}
        }
      });
      // Suppress unhandled rejection — errors are retrieved via next()
      this._runPromise.catch(() => {});
    }

    protected async run(): Promise<void> {}

    close(): void {
      this.abortController.abort();
      this.closed = true;
      try { this.queue.close(); } catch {}
      try { this.output.close(); } catch {}
    }

    async next(): Promise<IteratorResult<any>> {
      const result = await this.queue.next();

      if (result.done) {
        // Run completed — check if it errored
        if (this._runError !== undefined) {
          throw this._runError;
        }
        return { value: undefined, done: true };
      }

      return result;
    }

    [Symbol.asyncIterator](): this {
      return this;
    }
  };
}

function createChatMessageClass() {
  return class ChatMessage {
    role: any;
    textContent: string;
    constructor({ role, text, content }: { role: any, text?: string, content?: string }) {
      this.role = role;
      this.textContent = text || content || '';
    }
  };
}

function createAgentsMock() {
  const ChatMessage = createChatMessageClass();

  return {
    APIConnectOptions: {},
    llm: {
      LLM: class {
        constructor() {}
        label() { return ''; }
      },
      LLMStream: createLLMStreamMock(),
      ChatContext: class {
        items: any[] = [];
        addMessage({ role, content }: { role: any; content: string }) {
          const msg = new ChatMessage({ role, content });
          this.items.push(msg);
          return msg;
        }
      },
      ChatMessage,
      FunctionCall: class {
        callId: string;
        name: string;
        args: string;
        constructor({ callId, name, args }: { callId: string, name: string, args: string }) {
          this.callId = callId;
          this.name = name;
          this.args = args;
        }
      },
      ChatRole: {
        SYSTEM: 'system',
        USER: 'user',
        ASSISTANT: 'assistant',
        TOOL: 'tool',
      }
    }
  };
}

// Mock the entire @livekit/agents module since llm.ts imports from there
mock.module("@livekit/agents", () => createAgentsMock());

// Also mock the subpath for backwards compatibility
mock.module("@livekit/agents/llm", () => createAgentsMock().llm);
