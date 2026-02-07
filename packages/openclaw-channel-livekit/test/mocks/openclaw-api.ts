/**
 * Mock OpenClawPluginApi for testing without a running OpenClaw instance.
 *
 * Based on OpenClaw's plugin API interface from src/plugins/types.ts
 */
import { vi } from "vitest";
import { createMockRuntime, type MockRuntime } from "./runtime.js";
import { createMockLogger, type MockLogger } from "./logger.js";

/**
 * Registered channel plugin shape (simplified for testing)
 */
export interface MockChannelPlugin {
  id: string;
  meta?: {
    label?: string;
    docsPath?: string;
    icon?: string;
  };
  capabilities?: Record<string, unknown>;
  config?: Record<string, unknown>;
  security?: Record<string, unknown>;
  gateway?: {
    start?: (params: unknown) => Promise<void>;
    stop?: (params: unknown) => Promise<void>;
  };
  outbound?: {
    send?: (params: unknown) => Promise<void>;
  };
  messaging?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Mock plugin configuration
 */
export interface MockPluginConfig {
  channels?: {
    livekit?: {
      url?: string;
      apiKey?: string;
      apiSecret?: string;
      roomName?: string;
      stt?: {
        provider?: "deepgram" | "groq";
        apiKey?: string;
      };
      tts?: {
        provider?: "cartesia" | "elevenlabs";
        apiKey?: string;
        voiceId?: string;
      };
    };
  };
}

/**
 * Extended mock API with test helpers
 */
export interface MockPluginApi {
  // Standard API fields
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: MockPluginConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: MockRuntime;
  logger: MockLogger;

  // Registration methods (mocked)
  registerChannel: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
  registerHook: ReturnType<typeof vi.fn>;
  registerHttpHandler: ReturnType<typeof vi.fn>;
  registerHttpRoute: ReturnType<typeof vi.fn>;
  registerGatewayMethod: ReturnType<typeof vi.fn>;
  registerCli: ReturnType<typeof vi.fn>;
  registerService: ReturnType<typeof vi.fn>;
  registerProvider: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;

  // Utilities
  resolvePath: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;

  // Test helpers (not part of real API)
  _registeredChannels: Map<string, MockChannelPlugin>;
  _registeredHooks: Map<string, Array<(...args: unknown[]) => unknown>>;
  _getChannel: (id: string) => MockChannelPlugin | undefined;
  _triggerHook: (event: string, ...args: unknown[]) => Promise<void>;
}

export interface CreateMockPluginApiOptions {
  config?: MockPluginConfig;
  runtime?: Partial<MockRuntime>;
}

/**
 * Create a mock OpenClawPluginApi for testing.
 *
 * Usage:
 * ```typescript
 * const mockApi = createMockPluginApi();
 * plugin.register(mockApi);
 *
 * // Verify channel was registered
 * expect(mockApi.registerChannel).toHaveBeenCalled();
 * const channel = mockApi._getChannel("livekit");
 * expect(channel).toBeDefined();
 * ```
 */
export function createMockPluginApi(
  options: CreateMockPluginApiOptions = {}
): MockPluginApi {
  const registeredChannels = new Map<string, MockChannelPlugin>();
  const registeredHooks = new Map<string, Array<(...args: unknown[]) => unknown>>();

  const mockRuntime = createMockRuntime(options.runtime);
  const mockLogger = createMockLogger();

  const api: MockPluginApi = {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    description: "Test plugin for unit tests",
    source: "test",
    config: options.config ?? {},
    pluginConfig: {},
    runtime: mockRuntime,
    logger: mockLogger,

    registerChannel: vi.fn((registration: { plugin: MockChannelPlugin } | MockChannelPlugin) => {
      const plugin = "plugin" in registration ? registration.plugin : registration;
      registeredChannels.set(plugin.id, plugin);
    }),

    registerHook: vi.fn((events: string | string[], handler: (...args: unknown[]) => unknown) => {
      const eventList = Array.isArray(events) ? events : [events];
      for (const event of eventList) {
        const handlers = registeredHooks.get(event) ?? [];
        handlers.push(handler);
        registeredHooks.set(event, handlers);
      }
    }),

    registerTool: vi.fn(),
    registerHttpHandler: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerCli: vi.fn(),
    registerService: vi.fn(),
    registerProvider: vi.fn(),
    registerCommand: vi.fn(),
    resolvePath: vi.fn((input: string) => input),
    on: vi.fn(),

    // Test helpers
    _registeredChannels: registeredChannels,
    _registeredHooks: registeredHooks,

    _getChannel: (id: string) => registeredChannels.get(id),

    _triggerHook: async (event: string, ...args: unknown[]) => {
      const handlers = registeredHooks.get(event) ?? [];
      for (const handler of handlers) {
        await handler(...args);
      }
    },
  };

  return api;
}
