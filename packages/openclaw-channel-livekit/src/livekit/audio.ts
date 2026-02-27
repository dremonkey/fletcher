/**
 * Voice agent implementation using @livekit/agents SDK + Ganglia.
 *
 * Uses deepgram.STT, cartesia.TTS, and ganglia LLM to handle the full
 * audio pipeline. The SDK's voice.AgentSession manages STT → LLM → TTS routing.
 */
import type { Room } from "@livekit/rtc-node";
import { voice } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as cartesia from "@livekit/agents-plugin-cartesia";
import {
  createGanglia,
  type GangliaLLM,
} from "@knittt/livekit-agent-ganglia";
import { getLivekitLogger } from "../runtime.js";
import { ParticipantTracker } from "./participant.js";
import type { ResolvedLivekitAccount } from "../types.js";

/**
 * Voice agent configuration.
 */
export interface VoiceAgentConfig {
  roomId: string;
  account: ResolvedLivekitAccount;
}

/**
 * Voice agent state.
 */
type AgentState = "idle" | "listening" | "thinking" | "speaking";

/**
 * Voice agent for handling real-time voice conversations.
 *
 * This is a thin bridge between LiveKit's audio pipeline and the OpenClaw brain.
 * All personality, instructions, and tools are owned by the OpenClaw agent —
 * the voice.Agent here is an empty shell required by AgentSession.start().
 *
 * Pipeline: deepgram.STT → Ganglia LLM (OpenClaw) → cartesia.TTS
 * Orchestration: voice.AgentSession handles VAD, turn detection, interruptions.
 *
 * Caveats of the passthrough approach:
 * - LiveKit's built-in tool execution won't work (tools live in OpenClaw).
 *   If LiveKit-side tools are ever needed (e.g. client-side actions like
 *   muting/transferring), a hybrid approach with tools on both sides would
 *   be required.
 * - The Agent's chatCtx accumulates conversation history locally, but OpenClaw
 *   maintains its own history. These can drift if messages are dropped or
 *   retried. Currently harmless since OpenClaw is the source of truth.
 */
export class VoiceAgent {
  private roomId: string;
  private account: ResolvedLivekitAccount;
  private room: Room | null = null;
  private participantTracker: ParticipantTracker | null = null;
  private state: AgentState = "idle";
  private isRunning = false;

  // SDK components
  private sttInstance: deepgram.STT | null = null;
  private ttsInstance: cartesia.TTS | null = null;
  private llmInstance: GangliaLLM | null = null;
  private agent: voice.Agent | null = null;
  private session: voice.AgentSession | null = null;

  constructor(config: VoiceAgentConfig) {
    this.roomId = config.roomId;
    this.account = config.account;
  }

  /**
   * Start the voice agent in a room.
   */
  async start(room: Room): Promise<void> {
    const log = getLivekitLogger();

    if (this.isRunning) {
      log.warn(`Voice agent already running for room ${this.roomId}`);
      return;
    }

    this.room = room;
    this.isRunning = true;
    this.state = "listening";

    log.info(`Starting voice agent for room ${this.roomId}`);

    // Create STT from account config
    this.sttInstance = new deepgram.STT({
      model: this.account.stt.deepgram.model as any,
      language: this.account.stt.deepgram.language,
      apiKey: this.account.stt.apiKey,
    });

    // Create TTS from account config
    this.ttsInstance = new cartesia.TTS({
      model: this.account.tts.cartesia.model,
      voice: this.account.tts.cartesia.voiceId,
      speed: this.account.tts.cartesia.speed as any,
      emotion: this.account.tts.cartesia.emotion
        ? [this.account.tts.cartesia.emotion]
        : undefined,
      apiKey: this.account.tts.apiKey,
    });

    // Create Ganglia LLM
    this.llmInstance = await createGanglia({
      type: "openclaw",
      openclaw: {
        endpoint: this.account.url,
        token: this.account.apiKey,
      },
    });

    // Empty shell — OpenClaw owns the personality, instructions, and tools.
    // voice.Agent is required by AgentSession.start() but contributes nothing.
    this.agent = new voice.Agent({
      instructions: "",
      llm: this.llmInstance,
      stt: this.sttInstance,
      tts: this.ttsInstance,
    });

    // Set up participant tracking — start session when a participant joins
    this.participantTracker = new ParticipantTracker(room, {
      onJoin: (participant) => {
        log.info(`Participant joined: ${participant.identity}`);
        this.startSession(room);
      },
      onLeave: (participant) => {
        log.info(`Participant left: ${participant.identity}`);
      },
    });

    // Start session if participants are already in the room
    const existing = this.participantTracker.getParticipants();
    if (existing.length > 0) {
      this.startSession(room);
    }

    log.info(`Voice agent started for room ${this.roomId}`);
  }

  /**
   * Start a voice.AgentSession connected to the room.
   */
  private async startSession(room: Room): Promise<void> {
    const log = getLivekitLogger();

    if (this.session) {
      log.debug("Session already active, skipping");
      return;
    }

    if (!this.agent) {
      log.warn("Cannot start session - agent not initialized");
      return;
    }

    try {
      this.session = new voice.AgentSession({
        stt: this.sttInstance ?? undefined,
        tts: this.ttsInstance ?? undefined,
        llm: this.llmInstance ?? undefined,
      });

      await this.session.start({ agent: this.agent, room });
      log.info("Voice session started");
    } catch (error) {
      log.error(`Error starting voice session: ${error}`);
      this.session = null;
    }
  }

  /**
   * Synthesize and speak a text response.
   */
  async say(text: string): Promise<void> {
    const log = getLivekitLogger();

    if (!this.session) {
      log.warn("Cannot say - no active session");
      return;
    }

    log.info(`Speaking: ${text.substring(0, 50)}...`);
    this.state = "speaking";

    try {
      this.session.say(text);
    } catch (error) {
      log.error(`Error speaking: ${error}`);
    } finally {
      this.state = "listening";
    }
  }

  /**
   * Get the current agent state.
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * Check if the agent is running.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Stop the voice agent.
   */
  async close(): Promise<void> {
    const log = getLivekitLogger();

    if (!this.isRunning) {
      return;
    }

    log.info(`Stopping voice agent for room ${this.roomId}`);

    this.isRunning = false;
    this.state = "idle";

    if (this.session) {
      await this.session.close();
      this.session = null;
    }

    if (this.participantTracker) {
      this.participantTracker.dispose();
      this.participantTracker = null;
    }

    this.agent = null;
    this.sttInstance = null;
    this.ttsInstance = null;
    this.llmInstance = null;
    this.room = null;

    log.info(`Voice agent stopped for room ${this.roomId}`);
  }
}
