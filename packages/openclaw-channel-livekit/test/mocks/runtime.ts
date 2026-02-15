/**
 * Mock PluginRuntime for testing.
 */
import { mock } from "bun:test";
import { EventEmitter } from "events";

export interface MockMessage {
  conversationId: string;
  text: string;
  sender?: {
    id: string;
    name?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface MockConversation {
  id: string;
  messages: MockMessage[];
  metadata?: Record<string, unknown>;
}

export interface MockRuntime {
  sendMessage: ReturnType<typeof mock>;
  getConversation: ReturnType<typeof mock>;
  createConversation: ReturnType<typeof mock>;

  config: {
    loadConfig: ReturnType<typeof mock>;
  };

  channel: {
    livekit: {
      sendAudio: ReturnType<typeof mock>;
      getRoom: ReturnType<typeof mock>;
    };
  };

  // Test helpers
  _sentMessages: MockMessage[];
  _conversations: Map<string, MockConversation>;
  _events: EventEmitter;
  _emitEvent: (event: string, payload: unknown) => void;
  _onEvent: (event: string, handler: (payload: unknown) => void) => void;
  _simulateBrainResponse: (conversationId: string, text: string) => void;
}

export function createMockRuntime(
  overrides: Partial<MockRuntime> = {}
): MockRuntime {
  const sentMessages: MockMessage[] = [];
  const conversations = new Map<string, MockConversation>();
  const events = new EventEmitter();

  const runtime: MockRuntime = {
    sendMessage: mock(async (conversationId: string, text: string, sender?: MockMessage["sender"]) => {
      const message: MockMessage = { conversationId, text, sender };
      sentMessages.push(message);

      const conversation = conversations.get(conversationId);
      if (conversation) {
        conversation.messages.push(message);
      }

      return { success: true, messageId: `msg-${Date.now()}` };
    }),

    getConversation: mock(async (id: string) => {
      return conversations.get(id) ?? { id, messages: [] };
    }),

    createConversation: mock(async (id: string, metadata?: Record<string, unknown>) => {
      const conversation: MockConversation = { id, messages: [], metadata };
      conversations.set(id, conversation);
      return conversation;
    }),

    config: {
      loadConfig: mock(() => ({})),
    },

    channel: {
      livekit: {
        sendAudio: mock(() => {}),
        getRoom: mock(() => {}),
      },
    },

    _sentMessages: sentMessages,
    _conversations: conversations,
    _events: events,

    _emitEvent: (event: string, payload: unknown) => {
      events.emit(event, payload);
    },

    _onEvent: (event: string, handler: (payload: unknown) => void) => {
      events.on(event, handler);
    },

    _simulateBrainResponse: (conversationId: string, text: string) => {
      events.emit("message:send", { conversationId, text });
    },

    ...overrides,
  };

  return runtime;
}
