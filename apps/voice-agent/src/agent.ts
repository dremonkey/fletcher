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
 *   ELEVENLABS_API_KEY - ElevenLabs API key for TTS
 *   FLETCHER_ACK_SOUND - Acknowledgment sound on EOU: path to audio file, 'builtin' (default), or 'disabled'
 */

import { defineAgent, cli, ServerOptions, type JobContext } from '@livekit/agents';
import { voice } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import { createGangliaFromEnv, resolveSessionKeySimple } from '@knittt/livekit-agent-ganglia';
import pino from 'pino';
import { TurnMetricsCollector } from './metrics';
import { initTelemetry, shutdownTelemetry } from './telemetry';
import { resolveAckSound } from './ack-sound-config';

// ---------------------------------------------------------------------------
// Logger setup — pretty-print when running locally, JSON in production
// ---------------------------------------------------------------------------
const isLocal = process.env.NODE_ENV !== 'production' && !process.env.K_SERVICE;
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(isLocal ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
});

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'DEEPGRAM_API_KEY',
  'ELEVENLABS_API_KEY',
] as const;

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  logger.fatal(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// Ganglia-specific validation
const gangliaType = process.env.GANGLIA_TYPE ?? 'openclaw';
if (gangliaType === 'openclaw' && !process.env.OPENCLAW_API_KEY) {
  logger.fatal('GANGLIA_TYPE=openclaw requires OPENCLAW_API_KEY');
  process.exit(1);
}

logger.info({
  livekitUrl: process.env.LIVEKIT_URL,
  gangliaType,
}, 'Environment validated');

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------
export default defineAgent({
  entry: async (ctx: JobContext) => {
    await initTelemetry(logger);

    // Publish a ganglia event to the data channel
    const publishEvent = (event: Record<string, unknown>) => {
      const localParticipant = ctx.room.localParticipant;
      if (!localParticipant) return;
      localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(event)),
        { topic: 'ganglia-events', reliable: true },
      );
    };

    const publishStatus = (action: string, detail?: string | null) => {
      const event = detail != null
        ? { type: 'status', action, detail, startedAt: Date.now() }
        : { type: 'status', action, startedAt: Date.now() };
      publishEvent(event);
    };

    // -----------------------------------------------------------------------
    // Acknowledgment sound — plays a looping chime while the brain is
    // processing.  Starts on EOU detection (agent enters 'thinking' state),
    // stops when the first content token arrives or on pipeline error.
    // Configure via FLETCHER_ACK_SOUND: 'builtin' (default), path, or 'disabled'.
    // -----------------------------------------------------------------------
    const ackSound = resolveAckSound(process.env.FLETCHER_ACK_SOUND, logger);
    let bgAudioPlayer: voice.BackgroundAudioPlayer | undefined;
    let ackPlayHandle: { stop(): void; done(): boolean } | undefined;

    const stopAck = () => {
      if (ackPlayHandle && !ackPlayHandle.done()) {
        ackPlayHandle.stop();
      }
      ackPlayHandle = undefined;
    };

    const gangliaLlm = await createGangliaFromEnv({
      logger,
      onPondering: (phrase) => {
        if (phrase) {
          logger.info({ phrase }, 'Pondering status published');
          publishStatus('thinking', phrase);
        } else {
          // First content token arrived — stop ack
          logger.info('Pondering cleared');
          stopAck();
        }
      },
    });
    logger.info(`Using ganglia backend: ${gangliaLlm.gangliaType()}`);

    const stt = new deepgram.STT({ apiKey: process.env.DEEPGRAM_API_KEY });
    const tts = new elevenlabs.TTS({
      apiKey: process.env.ELEVENLABS_API_KEY,
      modelId: 'eleven_turbo_v2_5',
      voiceId: process.env.ELEVENLABS_VOICE_ID,
      syncAlignment: false,
    });

    const session = new voice.AgentSession({ stt, tts, llm: gangliaLlm });
    await session.start({
      agent: new voice.Agent({ instructions: '' }),
      room: ctx.room,
      outputOptions: { syncTranscription: false },
    });
    await ctx.connect();
    logger.info(`Connected to room: ${ctx.room.name}`);

    // Initialize the background audio player without thinkingSound —
    // we control play/stop manually via the pondering lifecycle above.
    if (ackSound) {
      bgAudioPlayer = new voice.BackgroundAudioPlayer();
      await bgAudioPlayer.start({ room: ctx.room, agentSession: session });
      logger.info('Acknowledgment sound enabled (plays on EOU, stops on first token or error)');
    } else {
      logger.info('Acknowledgment sound disabled');
    }

    // -----------------------------------------------------------------------
    // Metrics & observability — listen to SDK pipeline events
    // -----------------------------------------------------------------------
    const turnCollector = new TurnMetricsCollector(logger);

    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      const m = ev.metrics;
      // Log individual component metrics at debug level
      switch (m.type) {
        case 'llm_metrics':
          logger.debug({ ttftMs: m.ttftMs, durationMs: m.durationMs, tokensPerSecond: Math.round(m.tokensPerSecond), speechId: m.speechId }, 'LLM metrics');
          break;
        case 'tts_metrics':
          logger.debug({ ttfbMs: m.ttfbMs, durationMs: m.durationMs, speechId: m.speechId }, 'TTS metrics');
          break;
        case 'eou_metrics':
          logger.debug({ endOfUtteranceDelayMs: m.endOfUtteranceDelayMs, transcriptionDelayMs: m.transcriptionDelayMs, speechId: m.speechId }, 'EOU metrics');
          break;
      }
      // Correlate into per-turn summaries
      turnCollector.collect(m);
    });

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      logger.info({ from: ev.oldState, to: ev.newState }, 'Agent state changed');
      // Start ack on EOU detection (thinking state)
      if (ev.newState === 'thinking' && bgAudioPlayer && ackSound && !ackPlayHandle) {
        ackPlayHandle = bgAudioPlayer.play({ source: ackSound, volume: 0.8 });
      }
    });

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal) {
        logger.info({ transcript: ev.transcript }, 'User input (final)');
      }
    });

    // -----------------------------------------------------------------------
    // Pipeline error reporting — forward TTS/STT/LLM errors to the client
    // -----------------------------------------------------------------------
    session.on(voice.AgentSessionEventTypes.Error, (ev) => {
      const err = ev.error as { type?: string; label?: string; error?: Error; recoverable?: boolean };
      const message = err.error?.message ?? String(err);

      // "Queue is closed" is expected during disconnect — don't forward to client
      if (message.includes('Queue is closed')) {
        logger.debug({ label: err.label }, 'Queue closed (expected during disconnect)');
        return;
      }

      // Use the SDK label (e.g. "elevenlabs.TTS", "deepgram.STT") for specificity,
      // fall back to generic category
      const source = err.label
        ?? (err.type === 'tts_error' ? 'TTS'
          : err.type === 'stt_error' ? 'STT'
          : err.type === 'llm_error' ? 'LLM'
          : 'Pipeline');
      logger.error({ source, message, recoverable: err.recoverable }, 'Pipeline error');

      publishEvent({
        type: 'artifact',
        artifact_type: 'error',
        title: `${source} Error`,
        message,
      });

      // Stop ack sound on pipeline error
      stopAck();
    });

    const participant = await ctx.waitForParticipant();
    logger.info(`Participant joined: ${participant.identity}`);

    // Resolve session routing based on participant identity and room occupancy
    const ownerIdentity = process.env.FLETCHER_OWNER_IDENTITY;
    const remoteParticipants = ctx.room.remoteParticipants?.size ?? 0;
    // Exclude the agent itself — count only human participants
    const participantCount = Math.max(1, remoteParticipants);
    const sessionKey = resolveSessionKeySimple(
      participant.identity,
      ownerIdentity,
      ctx.room.name,
      participantCount,
    );
    logger.info({ type: sessionKey.type, key: sessionKey.key }, 'Session routing resolved');

    gangliaLlm.setSessionKey?.(sessionKey);
    gangliaLlm.setDefaultSession?.({
      roomName: ctx.room.name,
      participantIdentity: participant.identity,
    });

    ctx.addShutdownCallback(async () => {
      logger.info('Shutting down voice agent...');
      await bgAudioPlayer?.close();
      await session.close();
      await shutdownTelemetry();
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
