// Example implementation for src/api/server.ts

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
