#!/usr/bin/env bun
/**
 * Voice agent using @livekit/agents with ganglia LLM backend.
 *
 * A pure STT/TTS + Ganglia bridge — the LLM backend (OpenClaw/Nanoclaw)
 * handles all conversation logic, tools, and prompting.
 *
 * Usage:
 *   bun run apps/voice-agent/src/agent.ts dev          # register as worker, accept dispatches
 *   bun run apps/voice-agent/src/agent.ts connect --room my-room  # join a specific room directly
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
import { voice } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import { createGangliaFromEnv, type GangliaLLM } from '@knittt/livekit-agent-ganglia';

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    console.log(`Connected to room: ${ctx.room.name}`);

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

    gangliaLlm.setDefaultSession?.({
      roomName: ctx.room.name,
      participantIdentity: participant.identity,
    });

    const stt = new deepgram.STT({
      apiKey: process.env.DEEPGRAM_API_KEY,
    });

    const tts = new cartesia.TTS({
      apiKey: process.env.CARTESIA_API_KEY,
    });

    const agent = new voice.Agent({
      instructions: '',
      llm: gangliaLlm,
      stt,
      tts,
    });

    const session = new voice.AgentSession({ stt, tts, llm: gangliaLlm });
    await session.start({ agent, room: ctx.room });

    console.log('Voice agent started, listening for speech...');

    ctx.addShutdownCallback(async () => {
      console.log('Shutting down voice agent...');
      await session.close();
    });
  },
});

// Run as CLI if this is the main module
cli.runApp(
  new ServerOptions({
    agent: import.meta.filename,
    agentName: 'livekit-ganglia-agent',
    initializeProcessTimeout: 60_000,
  }),
);
