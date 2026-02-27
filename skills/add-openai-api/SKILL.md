---
name: add-openai-api
description: Add an OpenAI-compatible HTTP API layer to Nanoclaw for voice integration with Fletcher.
disable-model-invocation: true
---

Add an OpenAI-compatible HTTP API to Nanoclaw so Fletcher can use it as a brain backend.

## Overview

This skill adds an HTTP server to Nanoclaw exposing a `/v1/chat/completions` endpoint compatible with the OpenAI API. This enables Fletcher (the LiveKit voice agent) to use Nanoclaw as a brain backend, just like it uses OpenClaw.

## Prerequisites

- Nanoclaw must be installed and working
- SQLite database with messages table must exist
- Bun runtime available

## Files to Create

### 1. `src/api/server.ts`

Create the HTTP server with the OpenAI-compatible endpoint. See [server-example.ts](server-example.ts) for the full implementation.

Key points:
- Uses Hono as the HTTP framework
- CORS enabled for local development
- Health check at `GET /health`
- Chat completions at `POST /v1/chat/completions`
- Supports both streaming (SSE) and non-streaming responses
- Reads `X-Nanoclaw-Channel` header for channel JID

### 2. `src/api/history.ts`

Create the cross-channel history loader. See [history-example.ts](history-example.ts) for the full implementation.

Key points:
- Loads recent messages from ALL channels (WhatsApp, Telegram, LiveKit)
- Single-user system — all messages belong to the same user
- Maps `is_from_me` (0/1) to `user`/`assistant` roles
- Stores API messages with `lk:` JID prefix

### 3. `src/api/types.ts`

Create shared types for the API. See [types-example.ts](types-example.ts) for the full implementation.

Defines: `StatusEvent`, `ArtifactEvent`, `ContentEvent`, `StreamCallbacks`, `ChatMessage`, `ChatCompletionRequest`

## Files to Modify

### 4. Modify `src/index.ts`

Add API server startup to the main entry point:

```typescript
import { startApiServer } from './api/server';
import { config } from './config';

if (config.API_PORT) {
  startApiServer(config.API_PORT);
}
```

### 5. Modify `src/config.ts`

Add API configuration:

```typescript
export interface Config {
  // ... existing config
  API_PORT: number | null;
}

export const config: Config = {
  // ... existing config
  API_PORT: process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 18789,
};
```

## Integration with Conversation Runner

Adapt your existing conversation runner to accept streaming callbacks. See [streaming-integration.md](streaming-integration.md) for a before/after example.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `18789` | Port for the OpenAI-compatible API server |

## Usage

### Starting the API

After applying this skill, start Nanoclaw normally. The API server starts alongside other channels:

```bash
bun run src/index.ts
# Output:
# Starting Nanoclaw API server on port 18789
# Nanoclaw API listening at http://localhost:18789
```

### Testing the API

```bash
# Health check
curl http://localhost:18789/health

# Chat completion (non-streaming)
curl -X POST http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Nanoclaw-Channel: lk:test-user" \
  -d '{"model": "nanoclaw", "messages": [{"role": "user", "content": "Hello!"}], "stream": false}'

# Chat completion (streaming)
curl -X POST http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Nanoclaw-Channel: lk:test-user" \
  -d '{"model": "nanoclaw", "messages": [{"role": "user", "content": "What reminders do I have?"}], "stream": true}'
```

### Using with Fletcher

```bash
export GANGLIA_TYPE=nanoclaw
export NANOCLAW_URL=http://localhost:18789
```

## Additional resources

- For server, history, and types implementation code, see [server-example.ts](server-example.ts), [history-example.ts](history-example.ts), [types-example.ts](types-example.ts)
- For streaming integration guide, see [streaming-integration.md](streaming-integration.md)
- For extended event format and cross-channel context docs, see [reference.md](reference.md)

## Dependencies

```bash
bun add hono
```

## Verification Checklist

- [ ] `bun run src/index.ts` starts without errors
- [ ] `curl http://localhost:18789/health` returns `{"status":"ok"}`
- [ ] Non-streaming chat completion works
- [ ] Streaming chat completion returns SSE events
- [ ] Messages are stored in SQLite with `lk:` JID prefix
- [ ] Cross-channel history loads messages from WhatsApp/Telegram
- [ ] Status events are emitted for long operations
- [ ] Artifact events are emitted for code/diffs
