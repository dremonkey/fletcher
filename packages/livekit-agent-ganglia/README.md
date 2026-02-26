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

## OpenClaw Gateway Setup

The OpenClaw Gateway exposes an OpenAI-compatible `/v1/chat/completions` endpoint that ganglia uses as its LLM backend. There are a few things to configure on the Gateway side before it will work.

### Enable the Chat Completions Endpoint

The HTTP chat completions endpoint is **disabled by default**. Enable it in your `openclaw.json5`:

```json5
{
  gateway: {
    http: {
      endpoints: {
        chatCompletions: { enabled: true },
      },
    },
  },
}
```

### Authentication

Generate a gateway token and set it as `OPENCLAW_API_KEY`:

```bash
openclaw doctor --generate-gateway-token
```

Ganglia sends this as `Authorization: Bearer <token>` on every request. See the [Gateway security docs](https://docs.openclaw.ai/gateway/security) for details.

### Agent Targeting (model field)

The `model` field in the request body controls which OpenClaw agent handles the completion. By default, ganglia sends `model: 'openclaw-gateway'` which uses the Gateway's default agent.

To target a specific agent, use the format `openclaw:<agent-id>` (e.g. `openclaw:main`) or set the `x-openclaw-agent-id` header on the request.

> **Note:** The `model` field is currently configurable on `OpenClawLLM` but not yet forwarded to the HTTP client. For now, agent targeting requires setting the header on the Gateway side or using the default agent.

### Session Management

Ganglia tracks conversation context using `X-OpenClaw-*` headers derived from LiveKit room and participant info:

- `X-OpenClaw-Session-Id` — deterministic ID from room SID + participant identity
- `X-OpenClaw-Room-SID` — LiveKit room SID
- `X-OpenClaw-Room-Name` — LiveKit room name
- `X-OpenClaw-Participant-Identity` — participant identity

These headers allow the Gateway to maintain conversation state across multiple requests from the same voice session. For stateless usage, you can alternatively pass a `user` string in the request body and the Gateway will derive a stable session key from it.

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
