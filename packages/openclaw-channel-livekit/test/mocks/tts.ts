/**
 * Mock TTS (Text-to-Speech) provider for testing.
 *
 * Simulates Cartesia/ElevenLabs audio synthesis without actual API calls.
 */
import { vi } from "vitest";

export interface TTSSynthesisOptions {
  voiceId?: string;
  speed?: number;
  emotion?: string;
}

export interface MockTTSProvider {
  /**
   * Synthesize text to audio stream.
   */
  synthesize: (text: string, options?: TTSSynthesisOptions) => AsyncGenerator<Buffer>;

  /**
   * Close the TTS connection.
   */
  close: ReturnType<typeof vi.fn>;

  // Test helpers
  _calls: Array<{ text: string; options?: TTSSynthesisOptions }>;
  _audioChunks: Buffer[];
  _setAudioChunks: (chunks: Buffer[]) => void;
  _simulateError: (error: Error) => void;
}

export function createMockTTS(): MockTTSProvider {
  const calls: Array<{ text: string; options?: TTSSynthesisOptions }> = [];
  let audioChunks: Buffer[] = [Buffer.alloc(1024), Buffer.alloc(1024)];
  let pendingError: Error | null = null;

  const provider: MockTTSProvider = {
    synthesize: async function* (text: string, options?: TTSSynthesisOptions) {
      calls.push({ text, options });

      if (pendingError) {
        const error = pendingError;
        pendingError = null;
        throw error;
      }

      // Yield audio chunks
      for (const chunk of audioChunks) {
        yield chunk;
      }
    },

    close: vi.fn(),

    // Test helpers
    _calls: calls,
    _audioChunks: audioChunks,

    _setAudioChunks: (chunks: Buffer[]) => {
      audioChunks = chunks;
    },

    _simulateError: (error: Error) => {
      pendingError = error;
    },
  };

  return provider;
}

/**
 * Collect all chunks from a TTS synthesis stream.
 */
export async function collectAudioChunks(
  stream: AsyncGenerator<Buffer>
): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}
