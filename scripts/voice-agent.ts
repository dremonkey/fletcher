#!/usr/bin/env bun
/**
 * Voice agent using @livekit/agents with ganglia LLM backend.
 *
 * This script demonstrates how to:
 * 1. Use ganglia (OpenClaw/Nanoclaw) as the LLM backend
 * 2. Wire ToolInterceptor to publish status/artifact events via data channel
 * 3. Send events to Flutter app via LiveKit data channel
 *
 * Usage:
 *   GANGLIA_TYPE=openclaw bun run scripts/voice-agent.ts dev
 *   GANGLIA_TYPE=nanoclaw bun run scripts/voice-agent.ts connect --room my-room
 *
 * Environment variables:
 *   LIVEKIT_URL - LiveKit server URL
 *   LIVEKIT_API_KEY - LiveKit API key
 *   LIVEKIT_API_SECRET - LiveKit API secret
 *   GANGLIA_TYPE - Backend type: 'openclaw' or 'nanoclaw'
 *   OPENCLAW_API_KEY - OpenClaw API key (if using openclaw)
 *   DEEPGRAM_API_KEY - Deepgram API key for STT
 *   CARTESIA_API_KEY - Cartesia API key for TTS
 */

import { defineAgent, cli, ServerOptions, type JobContext } from '@livekit/agents';
import { voice, llm } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import {
  createGangliaFromEnv,
  ToolInterceptor,
  type StatusEvent,
  type ArtifactEvent,
  type GangliaLLM,
} from '@knittt/livekit-agent-ganglia';

/**
 * Creates a data channel event publisher for ganglia events.
 * Events are sent to all participants with topic 'ganglia-events'.
 */
function createEventPublisher(ctx: JobContext) {
  return (event: StatusEvent | ArtifactEvent) => {
    const data = new TextEncoder().encode(JSON.stringify(event));
    ctx.room.localParticipant?.publishData(data, {
      reliable: true,
      topic: 'ganglia-events',
    });
    console.log(`[Ganglia Event] ${event.type}:`, 'action' in event ? event.action : event.artifact_type);
  };
}

/**
 * Wraps tools with ToolInterceptor for visual feedback.
 * Status events are emitted when tools start, artifacts when they complete.
 */
function wrapToolsWithInterceptor(
  tools: llm.ToolContext,
  interceptor: ToolInterceptor,
): llm.ToolContext {
  const wrapped: llm.ToolContext = {};

  for (const [name, tool] of Object.entries(tools)) {
    const originalExecute = (tool as any).execute;
    if (typeof originalExecute !== 'function') {
      wrapped[name] = tool;
      continue;
    }

    wrapped[name] = {
      ...tool,
      execute: async (args: unknown, options: unknown) => {
        const toolCall = {
          name,
          args: args as Record<string, unknown>,
          id: (options as any)?.toolCallId,
        };

        const result = await interceptor.execute(toolCall, async () => {
          try {
            const output = await originalExecute(args, options);
            return { content: output, success: true };
          } catch (error) {
            return {
              content: '',
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        });

        if (!result.success) {
          throw new Error(result.error || 'Tool execution failed');
        }
        return result.content;
      },
    };
  }

  return wrapped;
}

/**
 * Example tools for demonstration.
 * In production, these would be real tools from your application.
 */
function createExampleTools(): llm.ToolContext {
  return {
    get_weather: llm.tool({
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
        },
        required: ['location'],
      },
      execute: async (args: { location: string }) => {
        // Simulate weather lookup
        await new Promise((r) => setTimeout(r, 500));
        return `The weather in ${args.location} is sunny, 72°F`;
      },
    }),

    search_files: llm.tool({
      name: 'search_files',
      description: 'Search for files matching a pattern',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern' },
        },
        required: ['pattern'],
      },
      execute: async (args: { pattern: string }) => {
        // Simulate file search
        await new Promise((r) => setTimeout(r, 300));
        return `src/index.ts:10:export function main()\nsrc/utils.ts:5:export function helper()`;
      },
    }),
  };
}

// Define the voice agent
export default defineAgent({
  entry: async (ctx: JobContext) => {
    // Wait for room connection and first participant
    await ctx.connect();
    console.log(`Connected to room: ${ctx.room.name}`);

    // Wait for a participant to talk to
    const participant = await ctx.waitForParticipant();
    console.log(`Participant connected: ${participant.identity}`);

    // Create ganglia LLM from environment
    let gangliaLlm: GangliaLLM;
    try {
      gangliaLlm = await createGangliaFromEnv();
      console.log(`Using ganglia backend: ${gangliaLlm.gangliaType()}`);
    } catch (error) {
      console.error('Failed to create ganglia LLM:', error);
      throw error;
    }

    // Set session info for context tracking
    gangliaLlm.setDefaultSession?.({
      roomName: ctx.room.name,
      roomSid: ctx.room.sid,
      participantIdentity: participant.identity,
    });

    // Create event publisher for data channel
    const publishEvent = createEventPublisher(ctx);

    // Create tool interceptor wired to data channel
    const interceptor = new ToolInterceptor(publishEvent);

    // Create and wrap tools with interceptor
    const tools = wrapToolsWithInterceptor(createExampleTools(), interceptor);

    // Create STT (Deepgram)
    const stt = new deepgram.STT({
      apiKey: process.env.DEEPGRAM_API_KEY,
    });

    // Create TTS (Cartesia)
    const tts = new cartesia.TTS({
      apiKey: process.env.CARTESIA_API_KEY,
    });

    // Create voice agent
    const agent = new voice.Agent({
      instructions: `You are a helpful voice assistant powered by ${gangliaLlm.gangliaType()}.
        Be concise since your responses will be spoken aloud.
        When you use tools, the user will see visual feedback in their app showing what you're doing.
        Available tools: get_weather (check weather), search_files (search codebase).`,
      llm: gangliaLlm,
      stt,
      tts,
      tools,
    });

    // Start the agent session
    const session = await agent.start(ctx.room, participant);

    console.log('Voice agent started, listening for speech...');

    // Handle shutdown
    ctx.addShutdownCallback(async () => {
      console.log('Shutting down voice agent...');
      await session.close();
    });
  },
});

// Run as CLI if this is the main module
const isMainModule = process.argv[1]?.endsWith('voice-agent.ts');
if (isMainModule) {
  cli.runApp(
    new ServerOptions({
      agent: import.meta.filename,
      initializeProcessTimeout: 60_000,
    }),
  );
}
