# Technical Specification: livekit-agent-ganglia

## 1. Overview

The `@knittt/livekit-agent-ganglia` package is a **LiveKit Agents LLM plugin** that wraps OpenClaw's reasoning interface (the "Brain") for use in any LiveKit Agent project. This is **Level 3** of the Fletcher modular architecture.

Unlike the channel plugin (Level 1), this package has no dependency on OpenClaw's channel infrastructure. It provides a standard LLM interface that the `@livekit/agents` framework can use for voice agent orchestration.

**Key Value:** Any developer building a LiveKit voice agent can use OpenClaw as their reasoning engine without adopting the full Fletcher/OpenClaw stack.

See [Channel Plugin Spec](../02-livekit-agent/spec.md) for the Level 1 specification.

---

## 2. Package Identity

```
Package: @knittt/livekit-agent-ganglia
Location: packages/livekit-agent-ganglia
Runtime: Bun (TypeScript)
Dependencies:
  - @livekit/agents (peer)
  - openclaw-sdk (for Brain API)
```

---

## 3. LiveKit Agents LLM Interface

The `@livekit/agents` framework defines a standard `LLM` interface for language model plugins. This plugin implements that interface to route requests through OpenClaw.

### Interface Implementation

```typescript
// src/index.ts
import { LLM, type LLMOptions, type ChatContext, type ChatChunk } from "@livekit/agents";

export interface OpenClawLLMOptions extends LLMOptions {
  /** OpenClaw API endpoint */
  apiUrl: string;
  /** OpenClaw API key */
  apiKey: string;
  /** Optional agent/brain ID to use */
  agentId?: string;
  /** Optional conversation ID for context continuity */
  conversationId?: string;
}

export class OpenClawLLM extends LLM {
  private apiUrl: string;
  private apiKey: string;
  private agentId?: string;
  private conversationId?: string;

  constructor(options: OpenClawLLMOptions) {
    super();
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
    this.agentId = options.agentId;
    this.conversationId = options.conversationId;
  }

  async *chat(ctx: ChatContext): AsyncGenerator<ChatChunk> {
    // Implementation: Stream responses from OpenClaw Brain API
  }
}
```

### Chat Context Handling

The `ChatContext` from LiveKit Agents maps to OpenClaw's conversation model:

```typescript
interface ChatContext {
  messages: ChatMessage[];  // Conversation history
  tools?: Tool[];           // Available function calls
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
```

**Mapping to OpenClaw:**
- `messages` → OpenClaw conversation thread
- `tools` → OpenClaw skills/tools available to the agent
- Speaker identity (from STT metadata) → OpenClaw message attribution

---

## 4. OpenClaw Brain Integration

### Brain API Client

The plugin communicates with OpenClaw's Brain API (the reasoning layer):

```typescript
// src/brain-client.ts
export interface BrainRequest {
  conversationId?: string;
  agentId?: string;
  message: {
    role: "user";
    content: string;
    metadata?: {
      speakerId?: string;
      channel?: string;
    };
  };
  tools?: ToolDefinition[];
  stream: true;
}

export interface BrainStreamChunk {
  type: "text" | "tool_call" | "tool_result" | "done";
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
}

export class BrainClient {
  constructor(
    private apiUrl: string,
    private apiKey: string
  ) {}

  async *streamChat(request: BrainRequest): AsyncGenerator<BrainStreamChunk> {
    const response = await fetch(`${this.apiUrl}/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    // Parse SSE stream and yield chunks
    for await (const chunk of this.parseSSE(response.body)) {
      yield chunk;
    }
  }

  private async *parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<BrainStreamChunk> {
    // SSE parsing implementation
  }
}
```

### Streaming Response Flow

```
User Speech (STT)
       ↓
LiveKit Agent Framework
       ↓
OpenClawLLM.chat(ctx)
       ↓
BrainClient.streamChat()
       ↓ (SSE stream)
OpenClaw Brain API
       ↓ (streaming response)
Yield ChatChunks
       ↓
LiveKit Agent Framework
       ↓
TTS Plugin → Audio Output
```

---

## 5. Tool Calling Support

OpenClaw agents can invoke tools during conversations. The plugin translates between LiveKit's tool interface and OpenClaw's tool-calling format.

### Tool Definition Mapping

```typescript
// LiveKit tool format
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

// OpenClaw tool format (compatible)
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

function mapTools(livekitTools: Tool[]): ToolDefinition[] {
  // Direct mapping - formats are compatible
  return livekitTools;
}
```

### Tool Execution Flow

```typescript
async *chat(ctx: ChatContext): AsyncGenerator<ChatChunk> {
  const brainRequest: BrainRequest = {
    conversationId: this.conversationId,
    agentId: this.agentId,
    message: {
      role: "user",
      content: ctx.messages.at(-1)?.content ?? "",
    },
    tools: ctx.tools ? mapTools(ctx.tools) : undefined,
    stream: true,
  };

  for await (const chunk of this.brainClient.streamChat(brainRequest)) {
    switch (chunk.type) {
      case "text":
        yield { type: "text", content: chunk.content };
        break;
      case "tool_call":
        yield {
          type: "tool_call",
          toolCall: {
            id: chunk.toolCall!.id,
            name: chunk.toolCall!.name,
            arguments: chunk.toolCall!.arguments,
          },
        };
        break;
      case "done":
        return;
    }
  }
}
```

---

## 6. Configuration

### Environment Variables

```bash
# Required
OPENCLAW_API_URL=https://api.openclaw.example/v1
OPENCLAW_API_KEY=sk-...

# Optional
OPENCLAW_AGENT_ID=agent_abc123
OPENCLAW_DEFAULT_CONVERSATION_ID=conv_xyz789
```

### Programmatic Configuration

```typescript
import { OpenClawLLM } from "@knittt/livekit-agent-ganglia";

const llm = new OpenClawLLM({
  apiUrl: process.env.OPENCLAW_API_URL!,
  apiKey: process.env.OPENCLAW_API_KEY!,
  agentId: "agent_abc123",
});
```

### Usage with LiveKit Agents

```typescript
import { VoicePipelineAgent } from "@livekit/agents";
import { OpenClawLLM } from "@knittt/livekit-agent-ganglia";
import { DeepgramSTT } from "@livekit/agents-plugin-deepgram";
import { CartesiaTTS } from "@livekit/agents-plugin-cartesia";

const agent = new VoicePipelineAgent({
  stt: new DeepgramSTT(),
  llm: new OpenClawLLM({
    apiUrl: process.env.OPENCLAW_API_URL!,
    apiKey: process.env.OPENCLAW_API_KEY!,
  }),
  tts: new CartesiaTTS(),
});
```

---

## 7. Conversation Context Management

### Per-Room Conversations

When used with the Fletcher channel plugin, each LiveKit room maps to an OpenClaw conversation:

```typescript
// The channel plugin sets conversationId based on roomId
const llm = new OpenClawLLM({
  apiUrl: config.apiUrl,
  apiKey: config.apiKey,
  conversationId: `room_${roomId}`,  // Set by channel plugin
});
```

### Standalone Usage

When used independently (without Fletcher channel), the caller manages conversation IDs:

```typescript
// Developer manages conversation continuity
const llm = new OpenClawLLM({
  apiUrl: config.apiUrl,
  apiKey: config.apiKey,
  conversationId: myConversationId,  // Developer-provided
});
```

---

## 8. Error Handling

### Retry Strategy

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 100,  // ms
  maxDelay: 2000,  // ms
};

async *chat(ctx: ChatContext): AsyncGenerator<ChatChunk> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      yield* this.attemptChat(ctx);
      return;
    } catch (error) {
      lastError = error as Error;
      if (!isRetryable(error)) throw error;

      const delay = Math.min(
        RETRY_CONFIG.baseDelay * 2 ** attempt,
        RETRY_CONFIG.maxDelay
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
```

### Error Types

| Error | Retryable | Handling |
|-------|-----------|----------|
| Network timeout | Yes | Exponential backoff |
| 429 Rate limit | Yes | Respect Retry-After header |
| 500 Server error | Yes | Exponential backoff |
| 401 Unauthorized | No | Throw immediately |
| 400 Bad request | No | Throw immediately |

---

## 9. Implementation Status

For current implementation progress and task tracking, see:
**[`tasks/04-livekit-agent-plugin/001-standalone-brain-plugin.md`](../../tasks/04-livekit-agent-plugin/001-standalone-brain-plugin.md)**
