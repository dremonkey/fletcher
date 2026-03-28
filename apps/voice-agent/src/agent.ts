#!/usr/bin/env bun
/**
 * Voice agent using @livekit/agents with ganglia LLM backend.
 *
 * A pure STT/TTS + Ganglia bridge — the LLM backend (ACP/Nanoclaw)
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
 *   GANGLIA_TYPE - Backend type: 'acp' (default), 'relay', or 'nanoclaw'
 *   FLETCHER_OWNER_IDENTITY - Participant identity of the owner (for session routing)
 *   DEEPGRAM_API_KEY - Deepgram API key for STT
 *   TTS_PROVIDER - TTS backend: 'elevenlabs' | 'google' | 'piper' (default)
 *   ELEVENLABS_API_KEY - ElevenLabs API key for TTS (when TTS_PROVIDER=elevenlabs)
 *   GOOGLE_API_KEY - Google AI Studio API key (when TTS_PROVIDER=google)
 *   GOOGLE_TTS_VOICE - Gemini voice name (default: 'Kore')
 *   FLETCHER_HOLD_TIMEOUT_MS - Idle timeout before entering hold mode (default: 60000, 0 to disable)
 *   FLETCHER_VOICE_TAG - Tag prepended to all user messages (default: '[VOICE]', empty string to disable)
 *   FLETCHER_ACK_SOUND - Acknowledgment sound on EOU: path to audio file, 'builtin' (default), or 'disabled'
 *   FLETCHER_STT_WATCHDOG_MS - STT liveness timeout in ms (default: 30000, 0 to disable) (BUG-027)
 *   PIPER_URL - Piper TTS sidecar URL for local fallback (e.g. 'http://localhost:5000')
 *   PIPER_VOICE - Piper voice name (default: sidecar default)
 *
 * ACP backend env vars (when GANGLIA_TYPE=acp, which is the default):
 *   ACP_COMMAND - Command to spawn as ACP subprocess (default: 'openclaw')
 *   ACP_ARGS - Comma-separated arguments to pass to ACP subprocess (default: 'acp')
 *   ACP_PROMPT_TIMEOUT_MS - Timeout in ms waiting for ACP response (default: 120000)
 *
 * Relay backend env vars (when GANGLIA_TYPE=relay):
 *   (No additional env vars required — uses the LiveKit room connection directly.)
 *
 * Nanoclaw backend env vars (when GANGLIA_TYPE=nanoclaw):
 *   NANOCLAW_URL - Nanoclaw server URL (default: 'http://localhost:18789')
 *   NANOCLAW_CHANNEL_PREFIX - Channel prefix (default: 'lk')
 */

import {
  defineAgent,
  cli,
  ServerOptions,
  tts,
  type JobContext,
  type JobProcess,
} from "@livekit/agents";
import { voice } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as silero from "@livekit/agents-plugin-silero";
import * as livekit from "@livekit/agents-plugin-livekit";
import { RoomEvent, ParticipantKind, TrackKind, type RemoteParticipant } from "@livekit/rtc-node";
import {
  createGangliaFromEnv,
  resolveSessionKeySimple,
} from "@knittt/livekit-agent-ganglia";
import pino from "pino";
import { TurnMetricsCollector } from "./metrics";
import { initTelemetry, shutdownTelemetry } from "./telemetry";
import { resolveAckSound } from "./ack-sound-config";
import { createTTS, type TTSProvider } from "./tts-provider";
import { TranscriptManager } from "./transcript-manager";
import { initHeapDiagnostics } from "./heap-snapshot";
import { buildBootstrapMessage, VOICE_TAG } from "./bootstrap";
import { attachFallbackMonitor } from "./tts-fallback-monitor";
import { guardTTSInputStream } from "./tts-chunk-guard";
import { createSttWatchdog } from "./stt-watchdog";
import { RelayRoom } from "@knittt/livekit-agent-ganglia/dist/ganglia-types";

// ---------------------------------------------------------------------------
// Logger setup — pretty-print when running locally, JSON in production
// ---------------------------------------------------------------------------
const isLocal = process.env.NODE_ENV !== "production" && !process.env.K_SERVICE;
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(isLocal
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "DEEPGRAM_API_KEY",
] as const;

const ttsProvider = (process.env.TTS_PROVIDER ?? "piper") as TTSProvider;
const HOLD_TIMEOUT_MS = parseInt(
  process.env.FLETCHER_HOLD_TIMEOUT_MS ?? "60000",
  10,
);
const STT_WATCHDOG_MS = parseInt(
  process.env.FLETCHER_STT_WATCHDOG_MS ?? "30000",
  10,
);

// Skip env validation for download-files (runs during Docker build without env)
if (!process.argv.includes("download-files")) {
  const missing: string[] = REQUIRED_ENV.filter((k) => !process.env[k]);

  // TTS-provider-specific requirements
  if (ttsProvider === "elevenlabs" && !process.env.ELEVENLABS_API_KEY) {
    missing.push("ELEVENLABS_API_KEY");
  }
  if (ttsProvider === "google" && !process.env.GOOGLE_API_KEY) {
    missing.push("GOOGLE_API_KEY");
  }
  if (ttsProvider === "piper" && !process.env.PIPER_URL) {
    missing.push("PIPER_URL");
  }

  if (missing.length > 0) {
    logger.fatal(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  // ACP is the default backend — no API key required from the voice agent.
  // The ACP subprocess (e.g. openclaw) handles its own authentication.
  const gangliaType = process.env.GANGLIA_TYPE ?? "acp";

  logger.info(
    {
      livekitUrl: process.env.LIVEKIT_URL,
      gangliaType,
      ttsProvider,
    },
    "Environment validated",
  );
}

// ---------------------------------------------------------------------------
// waitForDeviceParticipant — like ctx.waitForParticipant() but skips relay
// participants (identity: "relay-*"). The relay is a data-only participant
// with no audio tracks; linking the agent session to it makes STT/VAD deaf.
// (BUG-030)
// ---------------------------------------------------------------------------
async function waitForDeviceParticipant(ctx: JobContext): Promise<RemoteParticipant> {
  const isDevice = (p: RemoteParticipant) =>
    p.info.kind !== ParticipantKind.AGENT && !p.identity.startsWith("relay-");

  for (const p of ctx.room.remoteParticipants.values()) {
    if (isDevice(p)) return p;
  }

  return new Promise<RemoteParticipant>((resolve, reject) => {
    const onConnected = (p: RemoteParticipant) => {
      if (isDevice(p)) { cleanup(); resolve(p); }
    };
    const onDisconnected = () => {
      cleanup();
      reject(new Error("Room disconnected while waiting for device participant"));
    };
    const cleanup = () => {
      ctx.room.off(RoomEvent.ParticipantConnected, onConnected);
      ctx.room.off(RoomEvent.Disconnected, onDisconnected);
    };
    ctx.room.on(RoomEvent.ParticipantConnected, onConnected);
    ctx.room.on(RoomEvent.Disconnected, onDisconnected);
  });
}

// ---------------------------------------------------------------------------
// Guarded Agent — applies the TTS empty chunk guard to all TTS inference.
//
// Overrides ttsNode() to wrap the LLM text stream with guardTTSInputStream()
// before it reaches the TTS engine.  This prevents TTS errors caused by
// leading punctuation-only or whitespace-only chunks (e.g., `"."`, `"—"`,
// `" "`) which some TTS engines (Cartesia, ElevenLabs) reject with an
// "invalid transcript" error.  See BUG-005, Task 02/009.
// ---------------------------------------------------------------------------
class GuardedAgent extends voice.Agent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async ttsNode(text: any, modelSettings: any): Promise<any> {
    return super.ttsNode(
      guardTTSInputStream(text as ReadableStream<string>) as any,
      modelSettings,
    );
  }
}

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------
export default defineAgent({
  prewarm: async (_proc: JobProcess) => {
    // Pre-load the Silero VAD model — this is the heaviest initialization
    // in the pipeline and takes ~500ms on first load.  By loading it during
    // process prewarm, the model is ready in memory when a job arrives,
    // eliminating cold-start latency from VAD initialization.
    //
    // STT, TTS, and LLM clients don't need prewarming — they establish
    // connections lazily on first use with negligible cold-start overhead.
    await silero.VAD.load({ activationThreshold: 0.6 });
    logger.info("Agent pre-warmed: VAD model loaded");
  },
  entry: async (ctx: JobContext) => {
    const entryStartMs = performance.now();
    await initTelemetry(logger);
    initHeapDiagnostics(logger);

    // Publish a ganglia event to the data channel
    const publishEvent = (event: Record<string, unknown>) => {
      const localParticipant = ctx.room.localParticipant;
      if (!localParticipant) return;
      // Auto-stamp artifact events with current segment ID for correct
      // client-side attachment (BUG-012 fix).  The client prefers this
      // server-provided segmentId over its own _lastAgentSegmentId.
      if (event.type === 'artifact' && !event.segmentId) {
        event.segmentId = transcriptMgr.activeSegmentId;
      }
      localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(event)),
        { topic: "ganglia-events", reliable: true },
      );
    };

    const publishStatus = (action: string, detail?: string | null) => {
      const event =
        detail != null
          ? { type: "status", action, detail, startedAt: Date.now() }
          : { type: "status", action, startedAt: Date.now() };
      publishEvent(event);
    };

    let session: voice.AgentSession;

    // -----------------------------------------------------------------------
    // Hold mode — Gemini Live-style idle detection (BUG-027).
    //
    // After HOLD_TIMEOUT_MS of silence (no user speech, no agent activity),
    // the agent sends a 'session_hold' event to the client and disconnects.
    // The client shows "on hold — tap or speak to resume" and dispatches a
    // fresh agent on interaction.  The relay stays in the room, keeping the
    // ACP session alive for seamless conversation continuity.
    //
    // This also fixes BUG-027: when the SDK's STT stream dies silently,
    // the hold timer correctly fires (there IS silence) and the user gets
    // a clean recovery path instead of a zombie agent.
    // -----------------------------------------------------------------------
    let holdTimerHandle: ReturnType<typeof setTimeout> | null = null;

    const clearHoldTimer = () => {
      if (holdTimerHandle) {
        clearTimeout(holdTimerHandle);
        holdTimerHandle = null;
      }
    };

    const resetHoldTimer = () => {
      if (!bootstrapSent || HOLD_TIMEOUT_MS <= 0) return;
      clearHoldTimer();
      holdTimerHandle = setTimeout(() => {
        logger.info(
          { holdTimeoutMs: HOLD_TIMEOUT_MS },
          "Hold timeout — entering hold mode",
        );
        publishEvent({ type: "session_hold", reason: "idle" });
        // Grace period for SCTP delivery before disconnect
        setTimeout(() => ctx.room.disconnect(), 500);
        holdTimerHandle = null;
      }, HOLD_TIMEOUT_MS);
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
    const transcriptMgr = new TranscriptManager({
      publishEvent,
      publishStatus,
      stopAck,
      logger,
    });

    const gangliaLlm = await createGangliaFromEnv({
      logger,
      room: ctx.room as RelayRoom, // Used by GANGLIA_TYPE=relay; ignored by other backends
      onPondering: (phrase, streamId) =>
        transcriptMgr.onPondering(phrase, streamId),
      onContent: (delta, fullText, streamId) =>
        transcriptMgr.onContent(delta, fullText, streamId),
    });
    logger.info(`Using ganglia backend: ${gangliaLlm.gangliaType()}`);

    // Wrap the ganglia LLM to prepend the voice tag to every user message.
    // This lets the backend (OpenClaw/ACP) distinguish voice-agent messages
    // from other sources (web chat, API). The tag value is configurable via
    // FLETCHER_VOICE_TAG (default: "[VOICE]").
    if (VOICE_TAG) {
      const originalChat = gangliaLlm.chat.bind(gangliaLlm);
      (gangliaLlm as any).chat = (opts: any) => {
        const items = opts.chatCtx?.items;
        if (items) {
          for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item.role === "user" && item.content) {
              const idx = item.content.findIndex((c: unknown) => typeof c === "string");
              if (idx !== -1) {
                const text = item.content[idx] as string;
                // Skip bootstrap messages (they inject system instructions, not
                // user speech) and already-tagged content (prevents accumulation
                // when preemptive generations share the same chat context).
                if (
                  !text.startsWith(VOICE_TAG) &&
                  !text.includes("Do not reply to this message")
                ) {
                  item.content[idx] = `${VOICE_TAG} ${text}`;
                }
              }
              break;
            }
          }
        }
        return originalChat(opts);
      };
      logger.info({ voiceTag: VOICE_TAG }, "Voice tag enabled");
    }

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
    const ttsInstance = createTTS(ttsProvider, logger);

    // -----------------------------------------------------------------------
    // TTS fallback detection — when a FallbackAdapter is in use, listen for
    // availability changes to notify the client of degraded/restored voice.
    //
    // "Voice Degraded" = primary TTS failed, fallback (Piper) is active.
    // "Voice Restored" = primary TTS recovered after a previous degradation.
    //
    // Distinct from "Voice Unavailable" (below), which fires when ALL TTS
    // instances fail entirely — no audio at all, text-only mode. (TASK-015)
    // -----------------------------------------------------------------------
    if (ttsInstance instanceof tts.FallbackAdapter) {
      attachFallbackMonitor(ttsInstance, { publishEvent, logger });
    }

    session = new voice.AgentSession({
      vad,
      turnDetection,
      stt,
      tts: ttsInstance,
      llm: gangliaLlm,
      voiceOptions: {
        // Disabled: preemptive generation fires the LLM on interim transcripts,
        // which transitions the agent to "thinking" and prematurely finalizes
        // the user transcript segment — closing the message box mid-sentence.
        // The 200-400ms latency saving isn't worth the broken transcript UX.
        preemptiveGeneration: false,
        // Give the turn detector time to decide if the user is done.
        // Slightly above SDK default (500ms) to reduce premature EOU,
        // but lower than previous 800ms to keep response time snappy
        // now that preemptiveGeneration is off.
        minEndpointingDelay: 600,
        maxEndpointingDelay: 2000,
        // Require deliberate speech before interrupting agent TTS — reduces
        // false interruptions from brief noises that pass VAD (TASK-014).
        minInterruptionDuration: 800,
        // Require at least 1 transcribed word before interrupting — prevents
        // non-speech sounds (coughs, sighs) from cutting off the agent.
        minInterruptionWords: 1,
        // Disable the SDK's 15-second userAwayTimeout — it silently kills the
        // STT stream, leaving a zombie agent with no recovery path (BUG-027).
        // Hold mode (below) provides proper idle detection with clean UX.
        userAwayTimeout: null,
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
      agent: new GuardedAgent({ instructions: "" }),
      room: ctx.room,
      // Disable SDK transcription — we publish agent text ourselves via
      // the onContent callback → ganglia-events data channel.  This avoids
      // the SDK bug where performTextForwarding is gated behind speech
      // handle scheduling and never created when the user interrupts.
      outputOptions: { transcriptionEnabled: false },
    });
    await ctx.connect();
    const connectLatencyMs = Math.round(performance.now() - entryStartMs);
    logger.info(
      { connectLatencyMs },
      `Agent dispatch-to-connect latency: ${connectLatencyMs}ms — room: ${ctx.room.name}`,
    );

    // -----------------------------------------------------------------------
    // STT Health Watchdog — detects silent STT pipeline death (BUG-027).
    //
    // The SDK's AudioRecognition tasks (VAD + STT) can die silently when
    // the stream reader is released (e.g., track resubscription, network
    // glitches).  The error is caught by isStreamReaderReleaseError() and
    // swallowed — no events, no recovery.  The agent becomes a zombie.
    //
    // The watchdog monitors UserInputTranscribed events.  If no STT
    // activity arrives for STT_WATCHDOG_MS while the agent is listening
    // (and STT was previously active), the watchdog disconnects the room.
    // This triggers hold mode, giving the client a clean recovery path.
    //
    // The watchdog only arms after the first STT event, so it doesn't
    // trigger when the user simply hasn't spoken yet or has their mic off.
    // -----------------------------------------------------------------------
    const sttWatchdog = createSttWatchdog(
      {
        getAgentState: () => session.agentState as any,
        disconnectRoom: () => {
          // session_hold is sent early by the watchdog (on first silence
          // detection) while the data channel is still alive.  By the time
          // disconnectRoom fires, the data channel may have DTLS-timed-out,
          // so we don't rely on publishing here.
          setTimeout(() => ctx.room.disconnect(), 500);
        },
        publishEvent,
        logger,
      },
      STT_WATCHDOG_MS,
    );

    // -----------------------------------------------------------------------
    // Client data channel commands — listen for control events from the
    // mobile app (e.g., tts-mode toggle).  Events arrive as JSON on the
    // 'ganglia-events' topic. (TASK-030)
    // -----------------------------------------------------------------------
    let ttsEnabled = true;
    let bootstrapSent = false;
    let bootstrapComplete = false;
    // sendBootstrap is assigned after participant is resolved (see below).
    let sendBootstrap: (() => void) | undefined;

    ctx.room.on(
      RoomEvent.DataReceived,
      (payload: Uint8Array, participant: any, _kind: any, topic?: string) => {
        if (topic !== "ganglia-events") return;
        try {
          const event = JSON.parse(new TextDecoder().decode(payload));
          resetHoldTimer(); // Client interaction — reset idle timer
          if (event.type === "tts-mode") {
            ttsEnabled = event.value !== "off";
            session.output.setAudioEnabled(ttsEnabled);
            logger.info(
              { ttsEnabled, participant: participant?.identity },
              "TTS mode changed",
            );
          }

          // Voice→text mode switch — client signals the agent to self-terminate
          // so a fresh agent with a fresh pipeline can be dispatched on return
          // to voice mode.  Without this, the client would have to wait for
          // the 60s hold timer or 30s STT watchdog. (BUG-027c, Epic 26)
          if (event.type === 'end_voice_session') {
            logger.info({}, 'Received end_voice_session — user switched to text mode');
            sttWatchdog.dispose();
            clearHoldTimer();
            ctx.room.disconnect();
            return;
          }
          // Note: text_message is no longer sent by mobile (T30.03).
          // Typed text in voice mode now routes through the relay as
          // session/prompt, consistent with text mode.
        } catch (e) {
          logger.debug(
            { error: e },
            "Failed to parse incoming data channel event",
          );
        }
      },
    );

    // Initialize the background audio player without thinkingSound —
    // we control play/stop manually via the pondering lifecycle above.
    if (ackSound) {
      bgAudioPlayer = new voice.BackgroundAudioPlayer();
      await bgAudioPlayer.start({ room: ctx.room, agentSession: session });
      logger.info(
        "Acknowledgment sound enabled (plays on EOU, stops on first token or error)",
      );
    } else {
      logger.info("Acknowledgment sound disabled");
    }

    // -----------------------------------------------------------------------
    // Metrics & observability — listen to SDK pipeline events
    // -----------------------------------------------------------------------
    const turnCollector = new TurnMetricsCollector(logger);

    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      const m = ev.metrics;
      // Log individual component metrics at debug level
      switch (m.type) {
        case "llm_metrics":
          logger.debug(
            {
              ttftMs: m.ttftMs,
              durationMs: m.durationMs,
              tokensPerSecond: Math.round(m.tokensPerSecond),
              speechId: m.speechId,
            },
            "LLM metrics",
          );
          break;
        case "tts_metrics":
          logger.debug(
            {
              ttfbMs: m.ttfbMs,
              durationMs: m.durationMs,
              speechId: m.speechId,
            },
            "TTS metrics",
          );
          break;
        case "eou_metrics":
          logger.debug(
            {
              endOfUtteranceDelayMs: m.endOfUtteranceDelayMs,
              transcriptionDelayMs: m.transcriptionDelayMs,
              speechId: m.speechId,
            },
            "EOU metrics",
          );
          break;
      }
      // Correlate into per-turn summaries
      turnCollector.collect(m);
    });

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      logger.info(
        { from: ev.oldState, to: ev.newState },
        "Agent state changed",
      );

      // STT watchdog: track agent state to know when silence is expected
      if (ev.newState === "listening") {
        sttWatchdog.onAgentListening();
      } else {
        sttWatchdog.onAgentBusy();
      }

      // Finalize user transcript segment — EOU confirmed, LLM is dispatching.
      // This closes the accumulated user text as a single message box.
      if (ev.newState === "thinking") {
        finalizeUserSegment();
      }

      // Bootstrap completion — first transition to "listening" after bootstrap
      // was sent signals the bootstrap round-trip is done and the agent is ready
      // for user speech.  Publish a bootstrap_end event so the UI can dismiss
      // the "Connecting..." indicator. (BUG-031)
      if (
        ev.newState === "listening" &&
        bootstrapSent &&
        !bootstrapComplete
      ) {
        bootstrapComplete = true;
        publishEvent({ type: "bootstrap", phase: "end" });
        logger.info("Bootstrap complete — agent ready for user speech");
        sttWatchdog.activate(); // Bootstrap done — start monitoring STT health
      }

      // Hold timer: clear during agent activity (thinking/speaking),
      // restart when agent finishes speaking (listening again).
      if (ev.newState === "thinking" || ev.newState === "speaking") {
        clearHoldTimer();
      } else if (
        ev.newState === "listening" &&
        (ev.oldState === "speaking" || ev.oldState === "thinking")
      ) {
        resetHoldTimer();
      }

      // Start ack on EOU detection (thinking state) — skip when TTS is
      // disabled since there's no point playing a chime if the user wants
      // silence (TASK-030).
      if (
        ev.newState === "thinking" &&
        bgAudioPlayer &&
        ackSound &&
        !ackPlayHandle &&
        ttsEnabled
      ) {
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
    // Transcript grouping: Deepgram emits `speech_final` on every pause,
    // which would split a single thought into multiple message boxes.  We
    // keep accumulating text under the same segmentId until the agent
    // enters `thinking` (i.e., EOU confirmed and LLM dispatched).  This
    // groups all Deepgram segments that belong to the same turn into one
    // message box on the client.
    // -----------------------------------------------------------------------
    let userSegmentCounter = 0;
    let currentUserSegmentId: string | null = null;
    let accumulatedUserText = "";

    const finalizeUserSegment = () => {
      if (!currentUserSegmentId) return;
      if (accumulatedUserText) {
        publishEvent({
          type: "user_transcript",
          segmentId: currentUserSegmentId,
          text: accumulatedUserText,
          final: true,
        });
      }
      currentUserSegmentId = null;
      accumulatedUserText = "";
    };

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      resetHoldTimer(); // User spoke — reset idle timer
      sttWatchdog.onSttActivity(); // STT is alive — reset watchdog
      if (ev.isFinal) {
        logger.info({ transcript: ev.transcript }, "User input (final)");
      }
      // Allocate a new segment on first interim of a new utterance
      if (!currentUserSegmentId) {
        currentUserSegmentId = `user_seg_${++userSegmentCounter}`;
      }
      if (ev.isFinal) {
        // Deepgram speech_final — append to accumulated text but keep
        // the same segmentId.  The segment stays open until the LLM fires.
        accumulatedUserText +=
          (accumulatedUserText ? " " : "") + ev.transcript;
        publishEvent({
          type: "user_transcript",
          segmentId: currentUserSegmentId,
          text: accumulatedUserText,
          final: false, // not final until LLM dispatches
        });
      } else {
        // Interim — show accumulated finals + current interim together
        const displayText = accumulatedUserText
          ? accumulatedUserText + " " + ev.transcript
          : ev.transcript;
        publishEvent({
          type: "user_transcript",
          segmentId: currentUserSegmentId,
          text: displayText,
          final: false,
        });
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
      const err = ev.error as {
        type?: string;
        label?: string;
        error?: Error;
        recoverable?: boolean;
      };
      const message = err.error?.message ?? String(err);

      // "Queue is closed" is expected during disconnect — don't forward to client
      if (message.includes("Queue is closed")) {
        logger.debug(
          { label: err.label },
          "Queue closed (expected during disconnect)",
        );
        return;
      }

      // Use the SDK label (e.g. "elevenlabs.TTS", "deepgram.STT") for specificity,
      // fall back to generic category
      const source =
        err.label ??
        (err.type === "tts_error"
          ? "TTS"
          : err.type === "stt_error"
            ? "STT"
            : err.type === "llm_error"
              ? "LLM"
              : "Pipeline");
      logger.error(
        { source, message, recoverable: err.recoverable },
        "Pipeline error",
      );

      const isTts = err.type === "tts_error" || message.includes("TTS");

      // When using FallbackAdapter and the fallback TTS is still available,
      // suppress "Voice Unavailable" artifacts — the voice is degraded, not
      // unavailable.  The tts-fallback-monitor handles "Voice Degraded" /
      // "Voice Restored" artifacts separately.
      //
      // Without this check, the FallbackAdapter's background recovery probes
      // (every 1s against the dead primary) forward errors through
      // setupEventForwarding(), producing a misleading "Voice Unavailable"
      // artifact every 60s even though Piper is serving audio fine.
      if (isTts && ttsInstance instanceof tts.FallbackAdapter) {
        const anyFallbackAvailable = ttsInstance.status.some(
          (s, i) => i > 0 && s.available,
        );
        if (anyFallbackAvailable) {
          logger.debug(
            { source, message },
            "TTS error suppressed — fallback still available",
          );
          stopAck();
          return;
        }
      }

      // Debounce all error artifacts — at most 1 per minute
      const now = Date.now();
      if (now - lastErrorArtifact > ERROR_ARTIFACT_DEBOUNCE_MS) {
        lastErrorArtifact = now;
        publishEvent({
          type: "system_event",
          severity: "error",
          title: isTts ? "Voice Unavailable" : `${source} Error`,
          message: isTts
            ? "All voice synthesis failed. Text responses will continue to appear."
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
      logger.info({ reason: ev.reason }, "AgentSession closed");
      if (ev.reason === "error") {
        logger.error(
          { error: ev.error },
          "AgentSession died — disconnecting from room to allow fresh dispatch",
        );
        ctx.room.disconnect();
      }
    });

    // Wait for a device participant (not the relay or another agent).
    // ctx.waitForParticipant() returns the first non-AGENT participant,
    // which can be the relay (identity: "relay-*") if it joins before
    // the device. Linking audio input to the relay breaks STT/VAD since
    // it has no audio tracks. (BUG-030)
    const participant = await waitForDeviceParticipant(ctx);
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
    logger.info(
      { type: sessionKey.type, key: sessionKey.key },
      "Session routing resolved",
    );

    gangliaLlm.setSessionKey?.(sessionKey);
    gangliaLlm.setDefaultSession?.({
      roomName: ctx.room.name,
      participantIdentity: participant.identity,
    });

    // -----------------------------------------------------------------------
    // Bootstrap message — deferred until voice mode is activated.
    // The bootstrap injects TTS/STT instructions into the session. It only
    // makes sense when voice mode is ON (ttsEnabled=true). Sending it
    // immediately on room join wastes a relay prompt round-trip and times
    // out when the user hasn't enabled voice yet. (BUG-023)
    //
    // For e2e tests, voice mode is always on — send bootstrap immediately.
    // -----------------------------------------------------------------------
    sendBootstrap = async () => {
      if (bootstrapSent) return;
      bootstrapSent = true;
      // Signal the UI that bootstrap is starting — the client can show a
      // "Connecting..." indicator until bootstrap_end arrives. (BUG-031)
      publishEvent({ type: "bootstrap", phase: "start" });
      // Wait for the WebRTC data channel to the relay to be fully
      // established. publishData silently drops messages if the
      // channel isn't ready yet (~150ms after room join is too early).
      // 2s is conservative but reliable. (BUG-023)
      await new Promise((r) => setTimeout(r, 2000));
      const bootstrapMsg = buildBootstrapMessage({
        roomName: ctx.room.name ?? "",
        participantIdentity: participant.identity,
      });
      logger.info(
        { room: ctx.room.name },
        "Sending bootstrap message (voice mode activated)",
      );
      // allowInterruptions: false prevents barge-in during bootstrap.
      // Without this, user speech during the bootstrap round-trip cancels
      // the bootstrap LLM call, leaving the ACP session in a bad state
      // where the last instruction was "Do not reply to this message."
      // Subsequent user messages then get empty/broken responses. (BUG-031)
      session.generateReply({
        userInput: bootstrapMsg,
        allowInterruptions: false,
      });
      resetHoldTimer(); // Session started — begin idle tracking
    };

    const isE2e = (ctx.room.name ?? "").startsWith("e2e-");
    if (isE2e) {
      sendBootstrap();
    } else {
      logger.info("Bootstrap deferred — waiting for voice mode activation (mic on)");
    }

    // -----------------------------------------------------------------------
    // Voice mode activation — trigger bootstrap on first device audio track.
    // The mic toggle is the true voice mode signal. When the user enables
    // the mic, the device publishes an audio track. The first audio track
    // subscription from a non-agent participant triggers the bootstrap. (BUG-023)
    // -----------------------------------------------------------------------
    ctx.room.on(
      RoomEvent.TrackSubscribed,
      (track: any, _publication: any, trackParticipant: any) => {
        if (
          track.kind === TrackKind.KIND_AUDIO &&
          trackParticipant?.kind !== ParticipantKind.AGENT
        ) {
          sendBootstrap?.();
          // Notify watchdog that user audio is available — if STT never
          // activates within the timeout, the pipeline failed to start.
          sttWatchdog.onAudioTrackSubscribed();
        }
      },
    );

    // -----------------------------------------------------------------------
    // Participant lifecycle — log disconnect/reconnect for observability.
    // The actual reconnection is handled by LiveKit infrastructure: the
    // departure_timeout (120s) keeps the room alive while the client
    // completes network handoffs (e.g., WiFi→5G). See BUG-015.
    // -----------------------------------------------------------------------
    ctx.room.on(RoomEvent.ParticipantDisconnected, (p) => {
      logger.warn(
        { identity: p.identity, room: ctx.room.name },
        "Participant disconnected — waiting for reconnect (departure_timeout=120s)",
      );
    });

    ctx.room.on(RoomEvent.ParticipantConnected, (p) => {
      // Duplicate agent guard — if another agent joins, this (older) agent
      // exits to prevent overlapping audio/responses (BUG-013).  The newer
      // agent was dispatched intentionally; this one is likely a zombie from
      // a previous session that outlived the user's departure_timeout.
      if (p.kind === ParticipantKind.AGENT) {
        logger.warn(
          {
            newAgent: p.identity,
            myIdentity: ctx.room.localParticipant?.identity,
          },
          "Another agent joined — this agent exiting to prevent duplicate (BUG-013)",
        );
        ctx.room.disconnect();
        return;
      }

      logger.info(
        { identity: p.identity, room: ctx.room.name },
        "Participant connected",
      );
      // If the reconnecting participant matches the original, update session routing
      if (p.identity === participant.identity) {
        logger.info(
          { identity: p.identity },
          "Original participant reconnected — session continues",
        );
      }
    });

    ctx.addShutdownCallback(async () => {
      logger.info("Shutting down voice agent...");
      clearHoldTimer();
      sttWatchdog.dispose();
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
    agentName: "fletcher-voice",
    initializeProcessTimeout: 60_000,
    loadFunc: async () => 0,
  }),
);
