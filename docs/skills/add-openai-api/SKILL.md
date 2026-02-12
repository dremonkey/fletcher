# /add-openai-api

Add an OpenAI-compatible HTTP API layer to Nanoclaw for voice integration with Fletcher.

## Overview

This skill adds an HTTP server to Nanoclaw that exposes a `/v1/chat/completions` endpoint compatible with the OpenAI API. This enables Fletcher (the LiveKit voice agent) to use Nanoclaw as a brain backend, just like it uses OpenClaw.

## Prerequisites

- Nanoclaw must be installed and working
- SQLite database with messages table must exist
- Bun runtime available

## Files to Create

### 1. `src/api/server.ts`

Create the HTTP server with the OpenAI-compatible endpoint:

```typescript
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { cors } from 'hono/cors';
import { loadCrossChannelHistory } from './history';
import { runConversation } from '../brain/conversation'; // Adjust path to your conversation runner

const app = new Hono();

// Enable CORS for local development
app.use('/*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json();
  const channelJid = c.req.header('X-Nanoclaw-Channel') || 'lk:unknown';

  const { messages, stream: shouldStream = true } = body;

  // Load cross-channel history for context
  const historyMessages = await loadCrossChannelHistory(100);

  // Combine history with incoming messages
  const fullContext = [...historyMessages, ...messages];

  if (!shouldStream) {
    // Non-streaming response (rarely used for voice)
    const response = await runConversationNonStreaming(fullContext, channelJid);
    return c.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'nanoclaw',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: response },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });
  }

  // Streaming SSE response
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return stream(c, async (stream) => {
    const chatId = `chatcmpl-${Date.now()}`;

    try {
      // Run conversation with streaming callback
      await runConversationStreaming(fullContext, channelJid, {
        onStatus: async (action: string, detail?: string) => {
          // Extended event: status updates for voice UX
          const event = {
            type: 'status',
            action,
            detail
          };
          await stream.write(`data: ${JSON.stringify(event)}\n\n`);
        },

        onArtifact: async (artifactType: string, data: Record<string, unknown>) => {
          // Extended event: visual artifacts (not spoken)
          const event = {
            type: 'artifact',
            artifact_type: artifactType,
            ...data
          };
          await stream.write(`data: ${JSON.stringify(event)}\n\n`);
        },

        onContent: async (delta: string) => {
          // Standard OpenAI format: content to be spoken
          const chunk = {
            id: chatId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'nanoclaw',
            choices: [{
              index: 0,
              delta: { content: delta },
              finish_reason: null
            }]
          };
          await stream.write(`data: ${JSON.stringify(chunk)}\n\n`);
        },

        onToolCall: async (name: string, args: Record<string, unknown>) => {
          // Emit status for tool calls
          const event = {
            type: 'status',
            action: name,
            detail: JSON.stringify(args)
          };
          await stream.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      });

      // Send completion marker
      await stream.write('data: [DONE]\n\n');
    } catch (error) {
      console.error('Streaming error:', error);
      const errorEvent = {
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      };
      await stream.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      await stream.write('data: [DONE]\n\n');
    }
  });
});

export function startApiServer(port: number): void {
  console.log(`Starting Nanoclaw API server on port ${port}`);
  Bun.serve({
    port,
    fetch: app.fetch
  });
  console.log(`Nanoclaw API listening at http://localhost:${port}`);
  console.log(`OpenAI-compatible endpoint: POST http://localhost:${port}/v1/chat/completions`);
}

export { app };
```

### 2. `src/api/history.ts`

Create the cross-channel history loader:

```typescript
import { getDatabase } from '../db'; // Adjust path to your database module

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  channel?: string;
  timestamp?: number;
}

/**
 * Load cross-channel message history.
 *
 * Since Nanoclaw is single-user, all messages belong to the same user.
 * We load recent messages from ALL channels to provide full context.
 *
 * @param limit - Maximum number of messages to load (default: 100)
 * @returns Array of messages formatted for Claude conversation
 */
export async function loadCrossChannelHistory(limit: number = 100): Promise<HistoryMessage[]> {
  const db = getDatabase();

  // Load all recent messages across all channels
  // Messages are stored with JID prefixes like:
  // - WhatsApp: 1234567890@s.whatsapp.net
  // - Telegram: tg:123456789
  // - LiveKit/Voice: lk:participant-id
  const rows = db.query(`
    SELECT
      jid,
      role,
      content,
      timestamp
    FROM messages
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as Array<{
    jid: string;
    role: string;
    content: string;
    timestamp: number;
  }>;

  // Reverse to get chronological order
  const messages = rows.reverse();

  return messages.map(row => ({
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content,
    channel: extractChannelFromJid(row.jid),
    timestamp: row.timestamp
  }));
}

/**
 * Store a message from the API channel.
 *
 * @param jid - The JID for this session (e.g., "lk:participant-id")
 * @param role - Message role ('user' or 'assistant')
 * @param content - Message content
 */
export async function storeApiMessage(
  jid: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const db = getDatabase();

  db.run(`
    INSERT INTO messages (jid, role, content, timestamp)
    VALUES (?, ?, ?, ?)
  `, [jid, role, content, Date.now()]);
}

/**
 * Extract channel type from JID.
 */
function extractChannelFromJid(jid: string): string {
  if (jid.includes('@s.whatsapp.net')) return 'whatsapp';
  if (jid.startsWith('tg:')) return 'telegram';
  if (jid.startsWith('lk:')) return 'livekit';
  return 'unknown';
}

/**
 * Format history messages with channel context for Claude.
 *
 * This helps Claude understand the multi-channel nature of the conversation.
 */
export function formatHistoryForClaude(messages: HistoryMessage[]): string {
  return messages.map(msg => {
    const channelTag = msg.channel ? `[${msg.channel}] ` : '';
    return `${channelTag}${msg.role}: ${msg.content}`;
  }).join('\n');
}
```

### 3. `src/api/types.ts`

Create shared types for the API:

```typescript
/**
 * Status event types for voice UX feedback.
 * These are sent during long-running operations to indicate what's happening.
 */
export interface StatusEvent {
  type: 'status';
  action: StatusAction;
  detail?: string;
  file?: string;
  query?: string;
}

export type StatusAction =
  | 'thinking'
  | 'searching_files'
  | 'reading_file'
  | 'writing_file'
  | 'web_search'
  | 'executing_command'
  | 'analyzing';

/**
 * Artifact event types for visual content (not spoken).
 * These are sent to the Flutter app via LiveKit data channel.
 */
export interface ArtifactEvent {
  type: 'artifact';
  artifact_type: ArtifactType;
  file?: string;
  path?: string;
  content?: string;
  diff?: string;
  language?: string;
  query?: string;
  results?: unknown[];
}

export type ArtifactType =
  | 'diff'
  | 'code'
  | 'file'
  | 'search_results'
  | 'image';

/**
 * Content event (standard OpenAI delta format).
 * This content is spoken via TTS.
 */
export interface ContentEvent {
  type: 'content';
  delta: string;
}

/**
 * Streaming callbacks for conversation runner.
 */
export interface StreamCallbacks {
  onStatus: (action: StatusAction, detail?: string) => Promise<void>;
  onArtifact: (artifactType: ArtifactType, data: Record<string, unknown>) => Promise<void>;
  onContent: (delta: string) => Promise<void>;
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<void>;
}

/**
 * OpenAI-compatible chat message format.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * OpenAI-compatible chat completion request.
 */
export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}
```

## Files to Modify

### 4. Modify `src/index.ts`

Add API server startup to the main entry point:

```typescript
// Add this import at the top
import { startApiServer } from './api/server';
import { config } from './config';

// Add this in your startup sequence (after database init, before/alongside other channels)
if (config.API_PORT) {
  startApiServer(config.API_PORT);
}
```

### 5. Modify `src/config.ts`

Add API configuration:

```typescript
// Add to your config interface
export interface Config {
  // ... existing config
  API_PORT: number | null;
}

// Add to config loading
export const config: Config = {
  // ... existing config
  API_PORT: process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 18789,
};
```

## Integration with Conversation Runner

The API server needs to integrate with your existing conversation runner. You'll need to modify your conversation runner to accept streaming callbacks.

### Example: Adapting an Existing Runner

If your current conversation runner looks like this:

```typescript
// Before
export async function runConversation(messages: Message[]): Promise<string> {
  const response = await claude.messages.create({...});
  return response.content[0].text;
}
```

Add a streaming version:

```typescript
// After - add streaming support
export async function runConversationStreaming(
  messages: Message[],
  channelJid: string,
  callbacks: StreamCallbacks
): Promise<void> {
  // Store incoming user message
  const userMessage = messages[messages.length - 1];
  if (userMessage.role === 'user') {
    await storeApiMessage(channelJid, 'user', userMessage.content);
  }

  let fullResponse = '';

  // Use Claude's streaming API
  const stream = await claude.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    // ... your existing config
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta') {
      const delta = event.delta;
      if (delta.type === 'text_delta') {
        fullResponse += delta.text;
        await callbacks.onContent(delta.text);
      }
    }

    // Handle tool calls if you support them
    if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
      await callbacks.onToolCall(event.content_block.name, {});
    }
  }

  // Store assistant response
  await storeApiMessage(channelJid, 'assistant', fullResponse);
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `18789` | Port for the OpenAI-compatible API server |

## Usage

### Starting the API

After applying this skill, start Nanoclaw normally. The API server will start alongside other channels:

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
  -d '{
    "model": "nanoclaw",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'

# Chat completion (streaming)
curl -X POST http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Nanoclaw-Channel: lk:test-user" \
  -d '{
    "model": "nanoclaw",
    "messages": [{"role": "user", "content": "What reminders do I have?"}],
    "stream": true
  }'
```

### Using with Fletcher

Configure Fletcher to use Nanoclaw:

```bash
export GANGLIA_TYPE=nanoclaw
export NANOCLAW_URL=http://localhost:18789
```

## Extended Event Format

### Status Events

Emitted during long-running operations to provide feedback:

```json
{"type": "status", "action": "searching_files", "detail": "src/**/*.ts"}
{"type": "status", "action": "reading_file", "file": "src/utils.ts"}
{"type": "status", "action": "web_search", "query": "typescript best practices"}
{"type": "status", "action": "thinking"}
```

Fletcher routes these to:
- Visualizer state (shows "working" indicator)
- Optional TTS ("Let me search for that...")

### Artifact Events

Emitted for visual content that shouldn't be spoken:

```json
{"type": "artifact", "artifact_type": "diff", "file": "src/utils.ts", "diff": "@@ -10,3 +10,5 @@..."}
{"type": "artifact", "artifact_type": "code", "language": "typescript", "content": "function foo() {...}"}
{"type": "artifact", "artifact_type": "file", "path": "src/utils.ts", "content": "..."}
{"type": "artifact", "artifact_type": "search_results", "query": "...", "results": [...]}
```

Fletcher routes these to:
- LiveKit data channel -> Flutter app
- Rendered as diff viewer, code blocks, etc.

### Content Events

Standard OpenAI format, spoken via TTS:

```json
{"id": "chatcmpl-xxx", "choices": [{"delta": {"content": "Hello!"}}]}
```

## Cross-Channel Context

The API automatically loads history from all channels. Example flow:

```
[WhatsApp 9:00am] User: "Remind me to call mom tomorrow at 5pm"
[WhatsApp 9:01am] Bot:  "I'll remind you to call mom tomorrow at 5pm"

[Voice 2:00pm via Fletcher]
User: "What reminders do I have?"
# API loads WhatsApp history, provides context to Claude
Bot: "You have one reminder: call mom tomorrow at 5pm"
```

## Security Notes

- The API listens on localhost by default
- No authentication (single-user system)
- For remote access, use a reverse proxy with authentication
- Do not expose directly to the internet

## Dependencies

Add to your `package.json`:

```json
{
  "dependencies": {
    "hono": "^4.0.0"
  }
}
```

Install:

```bash
bun add hono
```

## Verification Checklist

After applying this skill, verify:

- [ ] `bun run src/index.ts` starts without errors
- [ ] `curl http://localhost:18789/health` returns `{"status":"ok"}`
- [ ] Non-streaming chat completion works
- [ ] Streaming chat completion returns SSE events
- [ ] Messages are stored in SQLite with `lk:` JID prefix
- [ ] Cross-channel history loads messages from WhatsApp/Telegram
- [ ] Status events are emitted for long operations
- [ ] Artifact events are emitted for code/diffs
