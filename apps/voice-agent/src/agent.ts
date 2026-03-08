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
 *   TTS_PROVIDER - TTS backend: 'elevenlabs' | 'google' | 'piper' (default)
 *   ELEVENLABS_API_KEY - ElevenLabs API key for TTS (when TTS_PROVIDER=elevenlabs)
 *   GOOGLE_API_KEY - Google AI Studio API key (when TTS_PROVIDER=google)
 *   GOOGLE_TTS_VOICE - Gemini voice name (default: 'Kore')
 *   FLETCHER_ACK_SOUND - Acknowledgment sound on EOU: path to audio file, 'builtin' (default), or 'disabled'
 *   PIPER_URL - Piper TTS sidecar URL for local fallback (e.g. 'http://localhost:5000')
 *   PIPER_VOICE - Piper voice name (default: sidecar default)
 */

import { defineAgent, cli, ServerOptions, type JobContext } from '@livekit/agents';
import { voice } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as silero from '@livekit/agents-plugin-silero';
import * as livekit from '@livekit/agents-plugin-livekit';
import { RoomEvent } from '@livekit/rtc-node';
import { createGangliaFromEnv, resolveSessionKeySimple } from '@knittt/livekit-agent-ganglia';
import pino from 'pino';
import { TurnMetricsCollector } from './metrics';
import { initTelemetry, shutdownTelemetry } from './telemetry';
import { resolveAckSound } from './ack-sound-config';
import { createTTS, type TTSProvider } from './tts-provider';
import { TranscriptManager } from './transcript-manager';
import { initHeapDiagnostics } from './heap-snapshot';
import { buildBootstrapMessage } from './bootstrap';

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
] as const;

const ttsProvider = (process.env.TTS_PROVIDER ?? 'piper') as TTSProvider;

// Skip env validation for download-files (runs during Docker build without env)
if (!process.argv.includes('download-files')) {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);

  // TTS-provider-specific requirements
  if (ttsProvider === 'elevenlabs' && !process.env.ELEVENLABS_API_KEY) {
    missing.push('ELEVENLABS_API_KEY');
  }
  if (ttsProvider === 'google' && !process.env.GOOGLE_API_KEY) {
    missing.push('GOOGLE_API_KEY');
  }
  if (ttsProvider === 'piper' && !process.env.PIPER_URL) {
    missing.push('PIPER_URL');
  }

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
    ttsProvider,
  }, 'Environment validated');
}

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------
export default defineAgent({
  entry: async (ctx: JobContext) => {
    await initTelemetry(logger);
    initHeapDiagnostics(logger);

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

    // -----------------------------------------------------------------------
    // Agent transcript — bypass SDK transcription pipeline.
    //
    // The SDK's performTextForwarding task is created AFTER speech handle
    // scheduling/authorization.  When the user speaks during the agent's
    // thinking phase, the speech handle is interrupted and text forwarding
    // is never created — even though the LLM produces a full response.
    //
    // We work around this by forwarding LLM content directly via the data
    // channel using the onContent callback.  The Flutter app handles
    // 'agent_transcript' events alongside existing status/artifact events.
    //
    // IMPORTANT: Transcript state is scoped per-stream to avoid a race
    // condition where concurrent OpenClawChatStream instances (old streams
    // whose HTTP connections haven't closed yet) mutate shared state and
    // corrupt newer streams' transcript events.  See BUG-010.
    // -----------------------------------------------------------------------
    const transcriptMgr = new TranscriptManager({ publishEvent, publishStatus, stopAck, logger });

    const gangliaLlm = await createGangliaFromEnv({
      logger,
      onPondering: (phrase, streamId) => transcriptMgr.onPondering(phrase, streamId),
      onContent: (delta, fullText, streamId) => transcriptMgr.onContent(delta, fullText, streamId),
    });
    logger.info(`Using ganglia backend: ${gangliaLlm.gangliaType()}`);

    // -----------------------------------------------------------------------
    // VAD & turn detection — Silero VAD for robust speech/silence detection,
    // LiveKit turn detector for context-aware end-of-turn prediction.
    // This replaces the SDK's default VAD-only endpointing which caused
    // premature EOU during natural pauses (BUG-014).
    // -----------------------------------------------------------------------
    const vad = await silero.VAD.load({
      // Slightly higher than default (0.5) to reduce false triggers from
      // background noise — TV, other speakers, wind, etc.
      activationThreshold: 0.6,
    });
    const turnDetection = new livekit.turnDetector.EnglishModel();

    const stt = new deepgram.STT({ apiKey: process.env.DEEPGRAM_API_KEY });
    const tts = createTTS(ttsProvider, logger);

    const session = new voice.AgentSession({
      vad,
      turnDetection,
      stt,
      tts,
      llm: gangliaLlm,
      voiceOptions: {
        // Give the turn detector more time to decide if the user is done.
        // Default 500ms was too aggressive for natural speech pauses (BUG-014).
        minEndpointingDelay: 800,
        maxEndpointingDelay: 3000,
        // Require deliberate speech before interrupting agent TTS — reduces
        // false interruptions from brief noises that pass VAD (TASK-014).
        minInterruptionDuration: 800,
        // Require at least 1 transcribed word before interrupting — prevents
        // non-speech sounds (coughs, sighs) from cutting off the agent.
        minInterruptionWords: 1,
      },
      connOptions: {
        // Allow TTS to fail without killing the session.  When TTS hits a
        // rate limit (e.g. Gemini 429), multiple parallel sentence failures
        // each emit a separate error event — the default threshold of 3 is
        // exceeded in a single turn.  Text transcriptions still flow via the
        // data channel regardless of TTS state. (BUG-024)
        maxUnrecoverableErrors: Infinity,
        // Don't retry TTS on 429 — the SDK's fixed-interval retries (0.1ms,
        // 2s, 2s) are too aggressive for rate limits.  With N parallel
        // sentences hitting 429, retries multiply the storm.  Let each
        // sentence fail once; the rate limit window resets naturally and
        // the next turn's TTS calls succeed. (BUG-024)
        ttsConnOptions: { maxRetry: 0 },
      },
    });

    await session.start({
      agent: new voice.Agent(),
      room: ctx.room,
      // Disable SDK transcription — we publish agent text ourselves via
      // the onContent callback → ganglia-events data channel.  This avoids
      // the SDK bug where performTextForwarding is gated behind speech
      // handle scheduling and never created when the user interrupts.
      outputOptions: { transcriptionEnabled: false },
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

    // -----------------------------------------------------------------------
    // User transcript forwarding — publish STT results to the data channel.
    //
    // The SDK's built-in lk.transcription forwarding for user input is gated
    // behind outputOptions.transcriptionEnabled, which we disabled to work
    // around the broken agent transcript pipeline (BUG-010).  Disabling it
    // also killed user transcript forwarding (BUG-012).
    //
    // We forward both interim and final user transcripts ourselves via the
    // ganglia-events data channel, matching the pattern used for agent
    // transcripts.
    // -----------------------------------------------------------------------
    let userSegmentCounter = 0;
    let currentUserSegmentId: string | null = null;

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal) {
        logger.info({ transcript: ev.transcript }, 'User input (final)');
      }
      // Allocate a new segment on first interim of a new utterance
      if (!currentUserSegmentId) {
        currentUserSegmentId = `user_seg_${++userSegmentCounter}`;
      }
      publishEvent({
        type: 'user_transcript',
        segmentId: currentUserSegmentId,
        text: ev.transcript,
        final: ev.isFinal,
      });
      if (ev.isFinal) {
        currentUserSegmentId = null;
      }
    });

    // -----------------------------------------------------------------------
    // Pipeline error reporting — forward errors to the client as artifacts.
    //
    // All error artifacts are debounced to at most 1 per minute.  During a
    // TTS quota burst (e.g. Gemini 429), hundreds of errors fire within
    // seconds — we log them all server-side but only surface one artifact
    // to the user per minute to avoid spamming the UI.
    // -----------------------------------------------------------------------
    let lastErrorArtifact = 0;
    const ERROR_ARTIFACT_DEBOUNCE_MS = 60_000;

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

      // Debounce all error artifacts — at most 1 per minute
      const now = Date.now();
      if (now - lastErrorArtifact > ERROR_ARTIFACT_DEBOUNCE_MS) {
        lastErrorArtifact = now;
        const isTts = err.type === 'tts_error' || message.includes('TTS');
        publishEvent({
          type: 'artifact',
          artifact_type: 'error',
          title: isTts ? 'Voice Unavailable' : `${source} Error`,
          message: isTts
            ? 'Text responses will continue to appear.'
            : message,
        });
      }

      // Stop ack sound on pipeline error
      stopAck();
    });

    // -----------------------------------------------------------------------
    // Session death — disconnect from room so LiveKit can dispatch fresh agent.
    // Without this, a dead session leaves a zombie agent in the room for the
    // full departure_timeout (120s), blocking recovery. See BUG-020.
    // -----------------------------------------------------------------------
    session.on(voice.AgentSessionEventTypes.Close, (ev: any) => {
      logger.info({ reason: ev.reason }, 'AgentSession closed');
      if (ev.reason === 'error') {
        logger.error({ error: ev.error }, 'AgentSession died — disconnecting from room to allow fresh dispatch');
        ctx.room.disconnect();
      }
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

    // -----------------------------------------------------------------------
    // Bootstrap message — inject a synthetic user message at session start.
    // Fires after session routing is resolved so OpenClaw receives correct
    // session headers.  Uses generateReply() to flow through the full voice
    // pipeline (STT → LLM → TTS) rather than a system-level instruction
    // that OpenClaw may ignore. (TASK-022)
    // -----------------------------------------------------------------------
    const bootstrapMsg = buildBootstrapMessage({
      roomName: ctx.room.name ?? '',
      participantIdentity: participant.identity,
    });
    const isE2e = (ctx.room.name ?? '').startsWith('e2e-');
    logger.info({ room: ctx.room.name, e2e: isE2e }, 'Sending bootstrap message');
    session.generateReply({ userInput: bootstrapMsg });

    // -----------------------------------------------------------------------
    // Participant lifecycle — log disconnect/reconnect for observability.
    // The actual reconnection is handled by LiveKit infrastructure: the
    // departure_timeout (120s) keeps the room alive while the client
    // completes network handoffs (e.g., WiFi→5G). See BUG-015.
    // -----------------------------------------------------------------------
    ctx.room.on(RoomEvent.ParticipantDisconnected, (p) => {
      logger.warn({ identity: p.identity, room: ctx.room.name }, 'Participant disconnected — waiting for reconnect (departure_timeout=120s)');
    });

    ctx.room.on(RoomEvent.ParticipantConnected, (p) => {
      logger.info({ identity: p.identity, room: ctx.room.name }, 'Participant connected');
      // If the reconnecting participant matches the original, update session routing
      if (p.identity === participant.identity) {
        logger.info({ identity: p.identity }, 'Original participant reconnected — session continues');
      }
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
