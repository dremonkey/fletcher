/**
 * Mock TTS (Text-to-Speech) provider for testing.
 *
 * Simulates Cartesia SDK TTS behavior without actual API calls.
 */
import { mock } from "bun:test";

export interface TTSSynthesisOptions {
  voiceId?: string;
  speed?: number;
  emotion?: string;
}

export interface MockTTSProvider {
  synthesize: (text: string, options?: TTSSynthesisOptions) => AsyncGenerator<Buffer>;
  close: ReturnType<typeof mock>;

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

      for (const chunk of audioChunks) {
        yield chunk;
      }
    },

    close: mock(() => {}),

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

export async function collectAudioChunks(
  stream: AsyncGenerator<Buffer>
): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}
