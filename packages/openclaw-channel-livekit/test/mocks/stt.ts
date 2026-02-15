/**
 * Mock STT (Speech-to-Text) provider for testing.
 *
 * Simulates Deepgram SDK STT behavior without actual API calls.
 */
import { mock } from "bun:test";

export interface TranscriptEvent {
  text: string;
  is_final: boolean;
  speech_final: boolean;
  confidence?: number;
  words?: Array<{ word: string; start: number; end: number }>;
}

export interface MockSTTProvider {
  transcribe: (audioStream: AsyncIterable<Buffer>) => AsyncGenerator<TranscriptEvent>;
  close: ReturnType<typeof mock>;

  // Test helpers
  _calls: Buffer[][];
  _pendingTranscriptions: TranscriptEvent[];
  _simulateTranscription: (text: string, options?: Partial<TranscriptEvent>) => void;
  _simulatePartial: (text: string) => void;
  _simulateFinal: (text: string) => void;
}

export function createMockSTT(): MockSTTProvider {
  const calls: Buffer[][] = [];
  const pendingTranscriptions: TranscriptEvent[] = [];

  const provider: MockSTTProvider = {
    transcribe: async function* (audioStream: AsyncIterable<Buffer>) {
      const chunks: Buffer[] = [];
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
      calls.push(chunks);

      for (const t of pendingTranscriptions) {
        yield t;
      }
      pendingTranscriptions.length = 0;
    },

    close: mock(() => {}),

    _calls: calls,
    _pendingTranscriptions: pendingTranscriptions,

    _simulateTranscription: (text: string, options: Partial<TranscriptEvent> = {}) => {
      pendingTranscriptions.push({
        text,
        is_final: options.is_final ?? true,
        speech_final: options.speech_final ?? true,
        confidence: options.confidence ?? 0.95,
        words: options.words,
      });
    },

    _simulatePartial: (text: string) => {
      pendingTranscriptions.push({
        text,
        is_final: false,
        speech_final: false,
        confidence: 0.8,
      });
    },

    _simulateFinal: (text: string) => {
      pendingTranscriptions.push({
        text,
        is_final: true,
        speech_final: true,
        confidence: 0.95,
      });
    },
  };

  return provider;
}

export async function* createTestAudioStream(
  chunks: number = 10,
  chunkSize: number = 1024
): AsyncGenerator<Buffer> {
  for (let i = 0; i < chunks; i++) {
    yield Buffer.alloc(chunkSize);
  }
}
