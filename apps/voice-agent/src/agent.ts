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
 *   FLETCHER_OWNER_IDENTITY - Participant identity of the owner (for session routing)
 *   DEEPGRAM_API_KEY - Deepgram API key for STT
 *   CARTESIA_API_KEY - Cartesia API key for TTS
 */

import { defineAgent, cli, ServerOptions, type JobContext } from '@livekit/agents';
import { voice } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import { createGangliaFromEnv, resolveSessionKeySimple } from '@knittt/livekit-agent-ganglia';

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'DEEPGRAM_API_KEY',
  'CARTESIA_API_KEY',
] as const;

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// Ganglia-specific validation
const gangliaType = process.env.GANGLIA_TYPE ?? 'openclaw';
if (gangliaType === 'openclaw' && !process.env.OPENCLAW_API_KEY) {
  console.error('GANGLIA_TYPE=openclaw requires OPENCLAW_API_KEY');
  process.exit(1);
}

console.log('Environment validated:', {
  LIVEKIT_URL: process.env.LIVEKIT_URL,
  GANGLIA_TYPE: gangliaType,
  DEEPGRAM_API_KEY: `${process.env.DEEPGRAM_API_KEY!.slice(0, 6)}...`,
  CARTESIA_API_KEY: `${process.env.CARTESIA_API_KEY!.slice(0, 6)}...`,
});

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------
export default defineAgent({
  entry: async (ctx: JobContext) => {
    const gangliaLlm = await createGangliaFromEnv();
    console.log(`Using ganglia backend: ${gangliaLlm.gangliaType()}`);

    const stt = new deepgram.STT({ apiKey: process.env.DEEPGRAM_API_KEY });
    const tts = new cartesia.TTS({ apiKey: process.env.CARTESIA_API_KEY });

    const session = new voice.AgentSession({ stt, tts, llm: gangliaLlm });
    await session.start({
      agent: new voice.Agent({ instructions: '' }),
      room: ctx.room,
    });
    await ctx.connect();
    console.log(`Connected to room: ${ctx.room.name}`);

    const participant = await ctx.waitForParticipant();
    console.log(`Participant joined: ${participant.identity}`);

    // Resolve session routing based on participant identity
    const ownerIdentity = process.env.FLETCHER_OWNER_IDENTITY;
    const sessionKey = resolveSessionKeySimple(
      participant.identity,
      ownerIdentity,
      ctx.room.name,
    );
    console.log(`Session routing: ${sessionKey.type} → ${sessionKey.key}`);

    gangliaLlm.setSessionKey?.(sessionKey);
    gangliaLlm.setDefaultSession?.({
      roomName: ctx.room.name,
      participantIdentity: participant.identity,
    });

    ctx.addShutdownCallback(async () => {
      console.log('Shutting down voice agent...');
      await session.close();
    });
  },
});

// Run as CLI if this is the main module
//
// loadFunc: Always report zero load so the LiveKit server considers this
// worker available for dispatch.  The default `defaultCpuLoad` samples
// os.cpus() inside the Docker container, but that reflects *host* CPU
// counters rather than the container's cgroup allocation.  The Go server
// uses the reported load to gate job dispatch, and the unreliable
// measurement causes intermittent "no servers available" errors even
// though the worker is idle.  Safe for self-hosted single-worker setups
// with low room counts.  For high-scale multi-worker deployments, remove
// this override and ensure accurate container CPU accounting.
cli.runApp(
  new ServerOptions({
    agent: import.meta.filename,
    initializeProcessTimeout: 60_000,
    loadFunc: async () => 0,
  }),
);
