/**
 * Mock OpenClawPluginApi for testing without a running OpenClaw instance.
 */
import { mock } from "bun:test";
import { createMockRuntime, type MockRuntime } from "./runtime.js";
import { createMockLogger, type MockLogger } from "./logger.js";

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

export interface MockPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: MockPluginConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: MockRuntime;
  logger: MockLogger;

  registerChannel: ReturnType<typeof mock>;
  registerTool: ReturnType<typeof mock>;
  registerHook: ReturnType<typeof mock>;
  registerHttpHandler: ReturnType<typeof mock>;
  registerHttpRoute: ReturnType<typeof mock>;
  registerGatewayMethod: ReturnType<typeof mock>;
  registerCli: ReturnType<typeof mock>;
  registerService: ReturnType<typeof mock>;
  registerProvider: ReturnType<typeof mock>;
  registerCommand: ReturnType<typeof mock>;

  resolvePath: ReturnType<typeof mock>;
  on: ReturnType<typeof mock>;

  _registeredChannels: Map<string, MockChannelPlugin>;
  _registeredHooks: Map<string, Array<(...args: unknown[]) => unknown>>;
  _getChannel: (id: string) => MockChannelPlugin | undefined;
  _triggerHook: (event: string, ...args: unknown[]) => Promise<void>;
}

export interface CreateMockPluginApiOptions {
  config?: MockPluginConfig;
  runtime?: Partial<MockRuntime>;
}

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

    registerChannel: mock((registration: { plugin: MockChannelPlugin } | MockChannelPlugin) => {
      const plugin = "plugin" in registration ? registration.plugin : registration;
      registeredChannels.set(plugin.id, plugin);
    }),

    registerHook: mock((events: string | string[], handler: (...args: unknown[]) => unknown) => {
      const eventList = Array.isArray(events) ? events : [events];
      for (const event of eventList) {
        const handlers = registeredHooks.get(event) ?? [];
        handlers.push(handler);
        registeredHooks.set(event, handlers);
      }
    }),

    registerTool: mock(() => {}),
    registerHttpHandler: mock(() => {}),
    registerHttpRoute: mock(() => {}),
    registerGatewayMethod: mock(() => {}),
    registerCli: mock(() => {}),
    registerService: mock(() => {}),
    registerProvider: mock(() => {}),
    registerCommand: mock(() => {}),
    resolvePath: mock((input: string) => input),
    on: mock(() => {}),

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
