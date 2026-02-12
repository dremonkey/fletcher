import { mock } from "bun:test";

// Mock the entire @livekit/agents module since llm.ts imports from there
mock.module("@livekit/agents", () => ({
  APIConnectOptions: {},
  llm: {
    LLM: class {
      constructor() {}
      label() { return ''; }
    },
    LLMStream: class {
      output = {
        put: () => {},
        close: () => {},
      };
      chatCtx: any;
      toolCtx: any;
      connOptions: any;
      constructor(llm: any, { chatCtx, toolCtx, connOptions }: any) {
        this.chatCtx = chatCtx;
        this.toolCtx = toolCtx;
        this.connOptions = connOptions;
      }
      protected async run() {}
    },
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
}));

// Also mock the subpath for backwards compatibility
mock.module("@livekit/agents/llm", () => ({
  LLM: class {
    constructor() {}
    label() { return ''; }
  },
  LLMStream: class {
    output = {
      put: () => {},
      close: () => {},
    };
    chatCtx: any;
    toolCtx: any;
    connOptions: any;
    constructor(llm: any, { chatCtx, toolCtx, connOptions }: any) {
      this.chatCtx = chatCtx;
      this.toolCtx = toolCtx;
      this.connOptions = connOptions;
    }
    protected async run() {}
  },
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
}));
