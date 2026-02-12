# @knittt/livekit-agent-ganglia

A unified LiveKit Agents LLM plugin that supports multiple "brain" backends (OpenClaw and Nanoclaw).

## Purpose

This package provides a `livekit-agents` LLM implementation that delegates reasoning to either:
- **OpenClaw**: Multi-user gateway with tool-calling, memory, and orchestration
- **Nanoclaw**: Single-user personal assistant with cross-channel history

Both backends expose an OpenAI-compatible `/v1/chat/completions` endpoint, allowing seamless switching via configuration.

## Architecture

The plugin implements the `llm.LLM` interface from the LiveKit Agents SDK with a pluggable backend system.

### Key Components

- **GangliaLLM**: Interface extending `llm.LLM` with session management
- **OpenClawLLM**: OpenClaw backend implementation (registered as `'openclaw'`)
- **ToolInterceptor**: Intercepts tool calls for visual feedback via data channel
- **Event Types**: StatusEvent, ArtifactEvent, ContentEvent for voice UX

## Usage

```typescript
import { createGangliaFromEnv, OpenClawLLM } from '@knittt/livekit-agent-ganglia';

// From environment variables (GANGLIA_TYPE selects backend)
const llm = await createGangliaFromEnv();
```

Or with explicit configuration:

```typescript
import { createGanglia } from '@knittt/livekit-agent-ganglia';

// OpenClaw
const openclawLLM = await createGanglia({
  type: 'openclaw',
  openclaw: {
    endpoint: 'http://localhost:8080',
    token: process.env.OPENCLAW_API_KEY!,
  },
});

// Nanoclaw
const nanoclawLLM = await createGanglia({
  type: 'nanoclaw',
  nanoclaw: {
    url: 'http://localhost:18789',
    channelPrefix: 'lk',
  },
});
```

Or directly:

```typescript
import { OpenClawLLM } from '@knittt/livekit-agent-ganglia';

const llm = new OpenClawLLM({
  baseUrl: 'http://localhost:8080',
  apiKey: process.env.OPENCLAW_API_KEY,
});
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GANGLIA_TYPE` | `openclaw` | Backend type (`openclaw` or `nanoclaw`) |
| `OPENCLAW_GATEWAY_URL` | `http://localhost:8080` | OpenClaw endpoint |
| `OPENCLAW_API_KEY` | - | OpenClaw authentication token |
| `NANOCLAW_URL` | `http://localhost:18789` | Nanoclaw endpoint |
| `NANOCLAW_CHANNEL_PREFIX` | `lk` | JID prefix for Nanoclaw messages |

## Backend Differences

| Feature | OpenClaw | Nanoclaw |
|---------|----------|----------|
| Multi-user | Yes | No (single-user) |
| Cross-channel history | No | Yes |
| Session headers | `X-OpenClaw-*` | `X-Nanoclaw-Channel` |
| Extended events | No | Status, Artifact events |

## Tool Interception for Visual Feedback

Use the `ToolInterceptor` to emit status and artifact events for the Flutter app:

```typescript
import { ToolInterceptor } from '@knittt/livekit-agent-ganglia';

const interceptor = new ToolInterceptor((event) => {
  room.localParticipant.publishData(JSON.stringify(event), { reliable: true });
});

// Wrap your tool executor
const result = await interceptor.execute(toolCall, myToolExecutor);
```
