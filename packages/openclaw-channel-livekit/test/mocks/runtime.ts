/**
 * Mock PluginRuntime for testing.
 *
 * The runtime provides access to OpenClaw's core messaging and state management.
 */
import { vi } from "vitest";
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

/**
 * Mock runtime with test helpers
 */
export interface MockRuntime {
  // Core messaging
  sendMessage: ReturnType<typeof vi.fn>;
  getConversation: ReturnType<typeof vi.fn>;
  createConversation: ReturnType<typeof vi.fn>;

  // Config access
  config: {
    loadConfig: ReturnType<typeof vi.fn>;
  };

  // Channel-specific runtime (e.g., channel.livekit.sendAudio)
  channel: {
    livekit: {
      sendAudio: ReturnType<typeof vi.fn>;
      getRoom: ReturnType<typeof vi.fn>;
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
    sendMessage: vi.fn(async (conversationId: string, text: string, sender?: MockMessage["sender"]) => {
      const message: MockMessage = { conversationId, text, sender };
      sentMessages.push(message);

      // Add to conversation if it exists
      const conversation = conversations.get(conversationId);
      if (conversation) {
        conversation.messages.push(message);
      }

      return { success: true, messageId: `msg-${Date.now()}` };
    }),

    getConversation: vi.fn(async (id: string) => {
      return conversations.get(id) ?? { id, messages: [] };
    }),

    createConversation: vi.fn(async (id: string, metadata?: Record<string, unknown>) => {
      const conversation: MockConversation = { id, messages: [], metadata };
      conversations.set(id, conversation);
      return conversation;
    }),

    config: {
      loadConfig: vi.fn(() => ({})),
    },

    channel: {
      livekit: {
        sendAudio: vi.fn(),
        getRoom: vi.fn(),
      },
    },

    // Test helpers
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
