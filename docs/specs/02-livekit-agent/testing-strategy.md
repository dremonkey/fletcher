# Technical Specification: Plugin Testing Strategy

## Overview

This document outlines how to write integration-like tests for the `openclaw-channel-livekit` plugin **without requiring a running OpenClaw instance**. The approach is based on patterns observed in the official OpenClaw repository.

---

## 1. Key Interfaces to Mock

### OpenClawPluginApi

The core API passed to plugins during registration. From OpenClaw's `src/plugins/types.ts`:

```typescript
export type OpenClawPluginApi = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;

  // Core registration methods
  registerTool: (tool, opts?) => void;
  registerHook: (events, handler, opts?) => void;
  registerHttpHandler: (handler) => void;
  registerHttpRoute: (params) => void;
  registerChannel: (registration) => void;  // <-- Key for channel plugins
  registerGatewayMethod: (method, handler) => void;
  registerCli: (registrar, opts?) => void;
  registerService: (service) => void;
  registerProvider: (provider) => void;
  registerCommand: (command) => void;

  // Utilities
  resolvePath: (input: string) => string;
  on: (hookName, handler, opts?) => void;
};
```

### PluginRuntime

The runtime object provides access to OpenClaw's core functionality:

```typescript
// Stored via setSlackRuntime(api.runtime) pattern
// Used for sending messages, accessing conversations, etc.
```

### ChannelPlugin

What our LiveKit channel must implement:

```typescript
export type ChannelPlugin = {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: ChannelConfigAdapter;
  configSchema?: ChannelConfigSchema;
  setup?: ChannelSetupAdapter;
  pairing?: ChannelPairingAdapter;
  security?: ChannelSecurityAdapter;
  groups?: ChannelGroupAdapter;
  outbound?: ChannelOutboundAdapter;      // Sending messages out
  gateway?: ChannelGatewayAdapter;         // Lifecycle (start/stop)
  messaging?: ChannelMessagingAdapter;     // Receiving messages
  // ... more adapters
};
```

---

## 2. Testing Layers

| Layer | LiveKit | STT/TTS | OpenClaw | Use Case |
|-------|---------|---------|----------|----------|
| **Unit** | Mock | Mock | Mock | Fast, isolated component tests |
| **Integration** | Real (docker) | Mock | Mock | Test LiveKit audio flow |
| **E2E** | Real | Real | Mock | Full pipeline (run sparingly) |

---

## 3. Test Infrastructure

### Directory Structure

```
packages/openclaw-channel-livekit/
├── src/
│   └── ...
└── test/
    ├── setup.ts              # Global test setup
    ├── mocks/
    │   ├── openclaw-api.ts   # Mock OpenClawPluginApi
    │   ├── runtime.ts        # Mock PluginRuntime
    │   ├── registry.ts       # Mock PluginRegistry
    │   ├── stt.ts            # Mock STT providers
    │   └── tts.ts            # Mock TTS providers
    ├── fixtures/
    │   └── audio/            # Test audio files
    ├── unit/
    │   ├── pipeline/
    │   │   ├── stt.test.ts
    │   │   ├── tts.test.ts
    │   │   └── buffer.test.ts
    │   └── livekit/
    │       ├── connection.test.ts
    │       └── participant.test.ts
    └── integration/
        ├── channel.test.ts
        └── audio-pipeline.test.ts
```

### Test Setup File

```typescript
// test/setup.ts
import { afterEach, beforeEach, vi } from "vitest";
import { createMockPluginApi } from "./mocks/openclaw-api";
import { createTestRegistry } from "./mocks/registry";

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// Global test helpers
export { createMockPluginApi, createTestRegistry };
```

### Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30000,  // 30s for integration tests
    pool: "forks",       // Process isolation
  },
});
```

---

## 4. Mock Implementations

### Mock OpenClawPluginApi

```typescript
// test/mocks/openclaw-api.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { vi } from "vitest";
import { createMockRuntime } from "./runtime";
import { createMockLogger } from "./logger";

export interface MockPluginApi extends OpenClawPluginApi {
  // Test helpers
  _registeredChannels: Map<string, any>;
  _registeredHooks: Map<string, Function[]>;
  _getChannel: (id: string) => any;
}

export function createMockPluginApi(
  overrides: Partial<OpenClawPluginApi> = {}
): MockPluginApi {
  const registeredChannels = new Map();
  const registeredHooks = new Map<string, Function[]>();

  return {
    id: "test-plugin",
    name: "Test Plugin",
    source: "test",
    config: createMockConfig(),
    pluginConfig: {},
    runtime: createMockRuntime(),
    logger: createMockLogger(),

    registerChannel: vi.fn((registration) => {
      const plugin = "plugin" in registration ? registration.plugin : registration;
      registeredChannels.set(plugin.id, plugin);
    }),

    registerHook: vi.fn((events, handler) => {
      const eventList = Array.isArray(events) ? events : [events];
      for (const event of eventList) {
        const handlers = registeredHooks.get(event) || [];
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
    resolvePath: vi.fn((input) => input),
    on: vi.fn(),

    // Test helpers
    _registeredChannels: registeredChannels,
    _registeredHooks: registeredHooks,
    _getChannel: (id) => registeredChannels.get(id),

    ...overrides,
  };
}
```

### Mock PluginRuntime

```typescript
// test/mocks/runtime.ts
import { vi } from "vitest";

export interface MockRuntime {
  // Captured calls for assertions
  _sentMessages: Array<{ conversationId: string; text: string }>;
  _emitEvent: (event: string, payload: any) => void;
}

export function createMockRuntime(): MockRuntime {
  const sentMessages: Array<{ conversationId: string; text: string }> = [];
  const eventHandlers = new Map<string, Function[]>();

  return {
    sendMessage: vi.fn(async (conversationId: string, text: string) => {
      sentMessages.push({ conversationId, text });
    }),

    getConversation: vi.fn(async (id: string) => ({
      id,
      messages: [],
    })),

    // Test helpers
    _sentMessages: sentMessages,
    _emitEvent: (event, payload) => {
      const handlers = eventHandlers.get(event) || [];
      handlers.forEach((h) => h(payload));
    },
  };
}
```

### Mock Test Registry

```typescript
// test/mocks/registry.ts
import type { PluginRegistry } from "openclaw/plugin-sdk";

export function createTestRegistry(
  overrides: Partial<PluginRegistry> = {}
): PluginRegistry {
  return {
    plugins: [],
    tools: [],
    hooks: [],
    typedHooks: [],
    channels: [],
    providers: [],
    gatewayHandlers: {},
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    commands: [],
    diagnostics: [],
    ...overrides,
  };
}
```

### Mock STT Provider

```typescript
// test/mocks/stt.ts
import { vi } from "vitest";

export interface MockSTTProvider {
  transcribe: (audioStream: AsyncIterable<Buffer>) => AsyncGenerator<TranscriptEvent>;
  _simulateTranscription: (text: string, isFinal: boolean, speechFinal: boolean) => void;
  _calls: Buffer[][];
}

export function createMockSTT(): MockSTTProvider {
  const calls: Buffer[][] = [];
  let pendingTranscriptions: Array<{ text: string; isFinal: boolean; speechFinal: boolean }> = [];

  return {
    transcribe: async function* (audioStream) {
      const chunks: Buffer[] = [];
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
      calls.push(chunks);

      // Yield any pending simulated transcriptions
      for (const t of pendingTranscriptions) {
        yield {
          text: t.text,
          is_final: t.isFinal,
          speech_final: t.speechFinal,
        };
      }
      pendingTranscriptions = [];
    },

    _simulateTranscription: (text, isFinal, speechFinal) => {
      pendingTranscriptions.push({ text, isFinal, speechFinal });
    },

    _calls: calls,
  };
}
```

### Mock TTS Provider

```typescript
// test/mocks/tts.ts
import { vi } from "vitest";

export interface MockTTSProvider {
  synthesize: (text: string) => AsyncGenerator<Buffer>;
  _calls: string[];
}

export function createMockTTS(): MockTTSProvider {
  const calls: string[] = [];

  return {
    synthesize: async function* (text) {
      calls.push(text);
      // Yield fake audio chunks
      yield Buffer.alloc(1024);
      yield Buffer.alloc(1024);
    },

    _calls: calls,
  };
}
```

---

## 5. Test Examples

### Unit Test: Plugin Registration

```typescript
// test/unit/channel.test.ts
import { describe, expect, it } from "vitest";
import plugin from "../../src/index";
import { createMockPluginApi } from "../mocks/openclaw-api";

describe("LiveKit Plugin", () => {
  it("registers channel with correct id", () => {
    const mockApi = createMockPluginApi();

    plugin.register(mockApi);

    expect(mockApi.registerChannel).toHaveBeenCalledTimes(1);
    const channel = mockApi._getChannel("livekit");
    expect(channel).toBeDefined();
    expect(channel.id).toBe("livekit");
  });

  it("has required capabilities", () => {
    const mockApi = createMockPluginApi();
    plugin.register(mockApi);

    const channel = mockApi._getChannel("livekit");
    expect(channel.capabilities.audio).toBe(true);
    expect(channel.capabilities.realtime).toBe(true);
  });
});
```

### Unit Test: STT Pipeline

```typescript
// test/unit/pipeline/stt.test.ts
import { describe, expect, it, vi } from "vitest";
import { STTPipeline } from "../../../src/pipeline/stt";
import { createMockSTT } from "../../mocks/stt";

describe("STTPipeline", () => {
  it("emits transcription when speech_final is true", async () => {
    const mockSTT = createMockSTT();
    const pipeline = new STTPipeline(mockSTT);
    const onTranscription = vi.fn();

    pipeline.on("transcription", onTranscription);
    mockSTT._simulateTranscription("Hello world", true, true);

    await pipeline.processAudio(createTestAudioStream());

    expect(onTranscription).toHaveBeenCalledWith({
      text: "Hello world",
      isFinal: true,
    });
  });

  it("buffers partial transcriptions", async () => {
    const mockSTT = createMockSTT();
    const pipeline = new STTPipeline(mockSTT);
    const onTranscription = vi.fn();

    pipeline.on("transcription", onTranscription);
    mockSTT._simulateTranscription("Hello", true, false); // Not speech_final

    await pipeline.processAudio(createTestAudioStream());

    expect(onTranscription).not.toHaveBeenCalled();
  });
});
```

### Integration Test: Full Audio Pipeline

```typescript
// test/integration/audio-pipeline.test.ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import plugin from "../../src/index";
import { createMockPluginApi } from "../mocks/openclaw-api";
import { createMockSTT } from "../mocks/stt";
import { createMockTTS } from "../mocks/tts";

describe("Audio Pipeline Integration", () => {
  let mockApi: ReturnType<typeof createMockPluginApi>;
  let mockSTT: ReturnType<typeof createMockSTT>;
  let mockTTS: ReturnType<typeof createMockTTS>;

  beforeAll(async () => {
    mockApi = createMockPluginApi({
      config: {
        channels: {
          livekit: {
            url: "ws://localhost:7880",
            apiKey: "devkey",
            apiSecret: "secret",
          },
        },
      },
    });

    mockSTT = createMockSTT();
    mockTTS = createMockTTS();

    // Inject mocks (implementation would use DI)
    plugin.register(mockApi);
  });

  it("routes transcription through OpenClaw and back to TTS", async () => {
    const channel = mockApi._getChannel("livekit");

    // Simulate user speech being transcribed
    await channel.messaging?.onMessage({
      conversationId: "room-123",
      text: "What's the weather?",
      sender: { id: "user-1", name: "Alice" },
    });

    // Verify message was sent to runtime
    expect(mockApi.runtime._sentMessages).toContainEqual({
      conversationId: "room-123",
      text: "What's the weather?",
    });

    // Simulate brain response
    mockApi.runtime._emitEvent("message:send", {
      conversationId: "room-123",
      text: "It's sunny today!",
    });

    // Verify TTS was triggered
    expect(mockTTS._calls).toContain("It's sunny today!");
  });
});
```

### Integration Test with Real LiveKit

```typescript
// test/integration/livekit-connection.test.ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Room } from "livekit-server-sdk";

describe("LiveKit Connection (requires docker)", () => {
  // Skip if LiveKit not running
  const LIVEKIT_URL = process.env.LIVEKIT_URL || "ws://localhost:7880";

  beforeAll(async () => {
    // Check if LiveKit is available
    try {
      // ping check
    } catch {
      console.warn("LiveKit not running, skipping integration tests");
      return;
    }
  });

  it("connects to room as bot participant", async () => {
    // Test real LiveKit connection
  });

  it("receives audio tracks from participants", async () => {
    // Test real audio track subscription
  });
});
```

---

## 6. Running Tests

### Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run test/unit/",
    "test:integration": "vitest run test/integration/",
    "test:coverage": "vitest run --coverage"
  }
}
```

### CI/CD Considerations

```yaml
# .github/workflows/test.yml
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - run: bun test:unit

  integration-tests:
    runs-on: ubuntu-latest
    services:
      livekit:
        image: livekit/livekit-server
        ports:
          - 7880:7880
    steps:
      - run: bun test:integration
```

---

## 7. Key Patterns from OpenClaw

1. **vi.mock() for external deps**: Mock `livekit-server-sdk`, `@deepgram/sdk`, etc.
2. **Test registries**: Create minimal registries with only what's needed
3. **Stub plugins**: Create minimal plugin implementations for testing
4. **Process isolation**: Use `pool: "forks"` for test isolation
5. **Lifecycle cleanup**: Reset state in `beforeEach`/`afterEach`

---

## 8. Implementation Checklist

- [ ] Set up vitest configuration
- [ ] Create test/setup.ts with global utilities
- [ ] Implement mock OpenClawPluginApi
- [ ] Implement mock PluginRuntime
- [ ] Implement mock STT provider
- [ ] Implement mock TTS provider
- [ ] Write unit tests for pipeline components
- [ ] Write integration tests for channel registration
- [ ] Add CI workflow for automated testing
- [ ] Document how to run tests locally

---

## References

- OpenClaw test setup: `/home/ahanyu/code/openclaw-reference/test/setup.ts`
- Channel plugin utils: `/home/ahanyu/code/openclaw-reference/src/test-utils/channel-plugins.ts`
- Twitch plugin tests: `/home/ahanyu/code/openclaw-reference/extensions/twitch/src/twitch-client.test.ts`
- Plugin types: `/home/ahanyu/code/openclaw-reference/src/plugins/types.ts`
