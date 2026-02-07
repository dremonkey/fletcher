/**
 * Speech-to-Text (STT) pipeline configuration and management.
 *
 * Provides an abstraction layer over STT providers (Deepgram, etc.)
 */
import { getLivekitLogger } from "../runtime.js";
import type { STTConfig, TranscriptionResult } from "../types.js";

/**
 * STT provider interface.
 */
export interface STTProvider {
  /**
   * Process audio and yield transcription results.
   */
  transcribe(audioStream: AsyncIterable<Buffer>): AsyncGenerator<TranscriptionResult>;

  /**
   * Close the STT connection.
   */
  close(): void;
}

/**
 * Transcription event handler.
 */
export type TranscriptionHandler = (result: TranscriptionResult) => void;

/**
 * Create an STT provider based on configuration.
 */
export function createSTT(config: STTConfig): STTProvider {
  const log = getLivekitLogger();

  switch (config.provider) {
    case "deepgram":
      return createDeepgramSTT(config);
    default:
      log.warn(`Unknown STT provider: ${config.provider}, falling back to Deepgram`);
      return createDeepgramSTT(config);
  }
}

/**
 * Create a Deepgram STT provider.
 *
 * In a full implementation, this would use @livekit/agents-plugin-deepgram
 * or the Deepgram SDK directly.
 */
function createDeepgramSTT(config: STTConfig): STTProvider {
  const log = getLivekitLogger();
  const model = config.deepgram?.model ?? "nova-3";
  const language = config.deepgram?.language ?? "en";

  log.debug(`Creating Deepgram STT with model=${model}, language=${language}`);

  let isOpen = true;

  return {
    async *transcribe(audioStream: AsyncIterable<Buffer>): AsyncGenerator<TranscriptionResult> {
      // TODO: Implement actual Deepgram integration
      // This is a placeholder that simulates the STT flow
      //
      // Real implementation would:
      // 1. Create a Deepgram WebSocket connection
      // 2. Stream audio chunks to Deepgram
      // 3. Yield transcription results as they arrive
      // 4. Handle is_final and speech_final flags

      log.debug("Starting Deepgram transcription stream");

      let chunkCount = 0;
      for await (const chunk of audioStream) {
        if (!isOpen) break;

        chunkCount++;
        // In real implementation, send chunk to Deepgram
        log.debug(`Processing audio chunk ${chunkCount}: ${chunk.length} bytes`);
      }

      log.debug(`Finished processing ${chunkCount} audio chunks`);

      // Placeholder: yield a final result
      // Real implementation would yield results from Deepgram callbacks
    },

    close(): void {
      log.debug("Closing Deepgram STT");
      isOpen = false;
    },
  };
}

/**
 * Parse Deepgram response flags for utterance detection.
 *
 * - is_final: This transcript segment is complete
 * - speech_final: User has stopped speaking (end of utterance)
 *
 * Only route to OpenClaw when speech_final is true.
 */
export function shouldRouteToAgent(isFinal: boolean, speechFinal: boolean): boolean {
  return isFinal && speechFinal;
}

/**
 * Combine partial transcripts into a complete utterance.
 */
export class TranscriptAccumulator {
  private parts: string[] = [];

  /**
   * Add a partial transcript.
   */
  addPartial(text: string): void {
    // Replace the last partial with the new one
    // (Deepgram sends updated partials, not incremental)
    if (this.parts.length > 0) {
      this.parts[this.parts.length - 1] = text;
    } else {
      this.parts.push(text);
    }
  }

  /**
   * Add a final transcript segment.
   */
  addFinal(text: string): void {
    // Replace any pending partial and mark as final
    if (this.parts.length > 0) {
      this.parts[this.parts.length - 1] = text;
    } else {
      this.parts.push(text);
    }
  }

  /**
   * Get the complete accumulated transcript.
   */
  getText(): string {
    return this.parts.join(" ").trim();
  }

  /**
   * Clear the accumulator.
   */
  clear(): void {
    this.parts = [];
  }
}
