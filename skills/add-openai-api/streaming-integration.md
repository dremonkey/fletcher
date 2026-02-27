# Streaming Integration Guide

Adapt your existing conversation runner to support streaming for the API.

## Before (non-streaming)

```typescript
export async function runConversation(messages: Message[]): Promise<string> {
  const response = await claude.messages.create({...});
  return response.content[0].text;
}
```

## After (streaming support)

```typescript
import { StreamCallbacks } from './types';
import { storeApiMessage } from './history';

export async function runConversationStreaming(
  messages: Message[],
  channelJid: string,
  callbacks: StreamCallbacks
): Promise<void> {
  // Store incoming user message
  const userMessage = messages[messages.length - 1];
  if (userMessage.role === 'user') {
    await storeApiMessage(channelJid, false, userMessage.content);
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
  await storeApiMessage(channelJid, true, fullResponse);
}
```
