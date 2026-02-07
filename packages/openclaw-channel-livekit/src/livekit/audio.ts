/**
 * Voice agent implementation using LiveKit AgentSession.
 *
 * Handles the STT → OpenClaw → TTS pipeline.
 */
import type { Room, RemoteParticipant } from "@livekit/rtc-node";
import { getLivekitRuntime, getLivekitLogger } from "../runtime.js";
import { ParticipantTracker, createSpeaker } from "./participant.js";
import { createSTT } from "../pipeline/stt.js";
import { createTTS } from "../pipeline/tts.js";
import type { ResolvedLivekitAccount, Speaker } from "../types.js";

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
 * Pipeline:
 * 1. Receive audio from participant via LiveKit
 * 2. Transcribe via STT (Deepgram)
 * 3. Route transcription to OpenClaw brain
 * 4. Synthesize response via TTS (Cartesia)
 * 5. Publish audio back to LiveKit room
 */
export class VoiceAgent {
  private roomId: string;
  private account: ResolvedLivekitAccount;
  private room: Room | null = null;
  private participantTracker: ParticipantTracker | null = null;
  private state: AgentState = "idle";
  private isRunning = false;

  // Pipeline components (will be initialized on start)
  private stt: ReturnType<typeof createSTT> | null = null;
  private tts: ReturnType<typeof createTTS> | null = null;

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

    // Initialize participant tracker
    this.participantTracker = new ParticipantTracker(room, {
      onJoin: (participant) => {
        log.info(`Participant joined: ${participant.identity}`);
        // Optionally send a greeting
      },
      onLeave: (participant) => {
        log.info(`Participant left: ${participant.identity}`);
      },
    });

    // Initialize STT
    this.stt = createSTT(this.account.stt);

    // Initialize TTS
    this.tts = createTTS(this.account.tts);

    // Set up audio track handling
    await this.setupAudioPipeline();

    log.info(`Voice agent started for room ${this.roomId}`);
  }

  /**
   * Set up the audio processing pipeline.
   */
  private async setupAudioPipeline(): Promise<void> {
    const log = getLivekitLogger();

    if (!this.room) {
      throw new Error("Room not connected");
    }

    // Subscribe to participant audio tracks
    // In a real implementation, this would:
    // 1. Subscribe to audio tracks from participants
    // 2. Pipe audio to STT
    // 3. Handle transcription events
    // 4. Route to OpenClaw
    // 5. Synthesize and publish response

    log.debug("Audio pipeline setup complete (placeholder)");

    // TODO: Implement full audio pipeline when @livekit/agents types are available
    // The implementation would look like:
    //
    // for (const participant of this.room.remoteParticipants.values()) {
    //   for (const track of participant.trackPublications.values()) {
    //     if (track.kind === TrackKind.AUDIO && track.track) {
    //       await this.processAudioTrack(participant, track.track);
    //     }
    //   }
    // }
  }

  /**
   * Handle a transcription from STT.
   */
  private async handleTranscription(
    text: string,
    speaker: Speaker,
    isFinal: boolean
  ): Promise<void> {
    const log = getLivekitLogger();
    const runtime = getLivekitRuntime();

    if (!isFinal) {
      // Partial transcription - could show typing indicator
      log.debug(`Partial transcription from ${speaker.id}: ${text}`);
      return;
    }

    log.info(`Final transcription from ${speaker.id}: ${text}`);
    this.state = "thinking";

    try {
      // Route to OpenClaw brain
      const response = await runtime.gateway.handleMessage({
        channel: "livekit",
        conversationId: this.roomId,
        text,
        sender: speaker,
      });

      if (response?.text) {
        await this.say(response.text);
      }
    } catch (error) {
      log.error(`Error handling transcription: ${error}`);
    } finally {
      this.state = "listening";
    }
  }

  /**
   * Synthesize and speak a text response.
   */
  async say(text: string): Promise<void> {
    const log = getLivekitLogger();

    if (!this.tts || !this.room) {
      log.warn("Cannot say - TTS or room not initialized");
      return;
    }

    log.info(`Speaking: ${text.substring(0, 50)}...`);
    this.state = "speaking";

    try {
      // Synthesize text to audio
      const audioStream = this.tts.synthesize(text);

      // Publish audio chunks to room
      for await (const chunk of audioStream) {
        // TODO: Publish audio chunk to room
        // await this.publishAudioChunk(chunk);
        log.debug(`Audio chunk: ${chunk.length} bytes`);
      }

      log.debug("Finished speaking");
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

    // Clean up components
    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }

    if (this.tts) {
      this.tts.close();
      this.tts = null;
    }

    if (this.participantTracker) {
      this.participantTracker.dispose();
      this.participantTracker = null;
    }

    this.room = null;

    log.info(`Voice agent stopped for room ${this.roomId}`);
  }
}
