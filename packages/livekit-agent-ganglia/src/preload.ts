import { mock } from "bun:test";

/** Minimal mock of AsyncIterableQueue matching the @livekit/agents interface. */
class MockQueue<T> {
  private _closed = false;
  private _items: T[] = [];
  put(item: T) {
    if (this._closed) throw new Error('Queue is closed');
    this._items.push(item);
  }
  close() { this._closed = true; }
  get closed() { return this._closed; }
  /** Test helper: return items pushed so far. */
  get items() { return this._items; }
}

/** Make MockQueue accessible to tests for inspection. */
(globalThis as any).__MockQueue = MockQueue;

function createLLMStreamMock() {
  return class {
    output: MockQueue<any>;
    queue: MockQueue<any>;
    closed = false;
    logger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    chatCtx: any;
    toolCtx: any;
    connOptions: any;
    constructor(llm: any, { chatCtx, toolCtx, connOptions }: any) {
      this.chatCtx = chatCtx;
      this.toolCtx = toolCtx;
      this.connOptions = connOptions;
      this.output = new MockQueue();
      this.queue = new MockQueue();
    }
    protected async run() {}
  };
}

function createAgentsMock() {
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
      },
      ChatMessage: class {
        role: any;
        textContent: string;
        constructor({ role, text, content }: { role: any, text?: string, content?: string }) {
          this.role = role;
          this.textContent = text || content || '';
        }
      },
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
