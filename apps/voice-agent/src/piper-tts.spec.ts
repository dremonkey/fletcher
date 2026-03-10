import { describe, it, expect, afterEach, mock } from 'bun:test';
import { PiperTTS, piperSynthesize, WAV_HEADER_SIZE } from './piper-tts';
import { APIStatusError, APIConnectionError, initializeLogger } from '@livekit/agents';

// LiveKit SDK requires a global logger — initialize once
initializeLogger({ pretty: false, level: 'silent' });

// ---------------------------------------------------------------------------
// Helper: build a minimal valid WAV file from raw PCM samples
// ---------------------------------------------------------------------------
function createTestWav(pcmSamples: Int16Array, sampleRate = 22050): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmSamples.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM payload
  const dst = new Int16Array(buffer, 44);
  dst.set(pcmSamples);

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ---------------------------------------------------------------------------
const BASE_URL = 'http://localhost:5000';
const originalFetch = globalThis.fetch;

describe('PiperTTS', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Integration tests — go through ChunkedStream (happy path only)
  // -----------------------------------------------------------------------

  it('synthesize() produces AudioFrames from WAV response', async () => {
    const samples = new Int16Array(2205); // 100ms at 22050 Hz
    for (let i = 0; i < samples.length; i++) samples[i] = i;
    const wavBuf = createTestWav(samples);

    globalThis.fetch = mock(async () =>
      new Response(wavBuf, { status: 200, headers: { 'Content-Type': 'audio/wav' } }),
    ) as unknown as typeof fetch;

    const piperTts = new PiperTTS({ baseUrl: BASE_URL });
    const stream = piperTts.synthesize('Hello world');

    const frames: Array<{ requestId: string; final: boolean }> = [];
    for await (const audio of stream) {
      expect(audio.frame).toBeDefined();
      expect(audio.frame.sampleRate).toBe(22050);
      expect(audio.frame.channels).toBe(1);
      frames.push({ requestId: audio.requestId, final: audio.final });
    }

    expect(frames.length).toBeGreaterThan(0);

    // All frames share the same requestId
    const ids = new Set(frames.map((f) => f.requestId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^piper-/);

    // Only the last frame is final
    expect(frames[frames.length - 1]!.final).toBe(true);
    for (let i = 0; i < frames.length - 1; i++) {
      expect(frames[i]!.final).toBe(false);
    }
  });

  it('synthesize() sends raw text body', async () => {
    const samples = new Int16Array(100);
    const wavBuf = createTestWav(samples);
    let capturedBody: string | undefined;

    globalThis.fetch = mock(async (_url: any, init: any) => {
      capturedBody = init.body;
      return new Response(wavBuf, { status: 200 });
    }) as unknown as typeof fetch;

    const piperTts = new PiperTTS({ baseUrl: BASE_URL });
    const stream = piperTts.synthesize('Hi');
    for await (const _ of stream) { /* drain */ }

    expect(capturedBody).toBe('Hi');
  });

  it('uses custom sampleRate', async () => {
    const sampleRate = 16000;
    const samples = new Int16Array(1600); // 100ms at 16kHz
    const wavBuf = createTestWav(samples, sampleRate);

    globalThis.fetch = mock(async () =>
      new Response(wavBuf, { status: 200 }),
    ) as unknown as typeof fetch;

    const piperTts = new PiperTTS({ baseUrl: BASE_URL, sampleRate });
    expect(piperTts.sampleRate).toBe(16000);

    const stream = piperTts.synthesize('Hello');
    for await (const audio of stream) {
      expect(audio.frame.sampleRate).toBe(16000);
    }
  });

  it('posts to correct URL (strips trailing slash)', async () => {
    const samples = new Int16Array(100);
    const wavBuf = createTestWav(samples);
    let capturedUrl: string | undefined;

    globalThis.fetch = mock(async (url: any) => {
      capturedUrl = String(url);
      return new Response(wavBuf, { status: 200 });
    }) as unknown as typeof fetch;

    const piperTts = new PiperTTS({ baseUrl: 'http://piper:5000/' });
    const stream = piperTts.synthesize('Test');
    for await (const _ of stream) { /* drain */ }

    expect(capturedUrl).toBe('http://piper:5000');
  });

  it('stream() throws (not supported)', () => {
    const piperTts = new PiperTTS({ baseUrl: BASE_URL });
    expect(() => piperTts.stream()).toThrow('does not support streaming');
  });

  // -----------------------------------------------------------------------
  // piperSynthesize() — unit tests for the HTTP layer.
  //
  // Error cases are tested here directly (bypassing ChunkedStream) because
  // the base class runs mainTask in a fire-and-forget microtask that
  // produces unhandled rejections on error, which Bun's test runner treats
  // as test failures.  These errors are harmless in production because
  // FallbackAdapter catches them via the TTS 'error' event.
  // -----------------------------------------------------------------------

  it('piperSynthesize() returns WAV buffer on success', async () => {
    const samples = new Int16Array(100);
    const wavBuf = createTestWav(samples);

    globalThis.fetch = mock(async () =>
      new Response(wavBuf, { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await piperSynthesize({
      baseUrl: BASE_URL,
      text: 'Hello',
      timeoutMs: 5000,
    });
    expect(result.byteLength).toBe(44 + samples.byteLength);
  });

  it('piperSynthesize() throws APIStatusError on HTTP 500', async () => {
    globalThis.fetch = mock(async () =>
      new Response('Internal Server Error', { status: 500 }),
    ) as unknown as typeof fetch;

    try {
      await piperSynthesize({ baseUrl: BASE_URL, text: 'Hello', timeoutMs: 5000 });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(APIStatusError);
      const apiErr = err as APIStatusError;
      expect(apiErr.statusCode).toBe(500);
      expect(apiErr.retryable).toBe(true);
    }
  });

  it('piperSynthesize() throws APIStatusError on HTTP 429', async () => {
    globalThis.fetch = mock(async () =>
      new Response('Too Many Requests', { status: 429 }),
    ) as unknown as typeof fetch;

    try {
      await piperSynthesize({ baseUrl: BASE_URL, text: 'Hello', timeoutMs: 5000 });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(APIStatusError);
      const apiErr = err as APIStatusError;
      expect(apiErr.statusCode).toBe(429);
      expect(apiErr.retryable).toBe(false);
    }
  });

  it('piperSynthesize() throws APIConnectionError on network failure', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    try {
      await piperSynthesize({ baseUrl: BASE_URL, text: 'Hello', timeoutMs: 5000 });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(APIConnectionError);
      expect((err as APIConnectionError).message).toBe('fetch failed');
    }
  });

  it('piperSynthesize() throws APIConnectionError on empty WAV', async () => {
    const emptyWav = new ArrayBuffer(WAV_HEADER_SIZE);
    globalThis.fetch = mock(async () =>
      new Response(emptyWav, { status: 200 }),
    ) as unknown as typeof fetch;

    try {
      await piperSynthesize({ baseUrl: BASE_URL, text: 'Hello', timeoutMs: 5000 });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(APIConnectionError);
      expect((err as APIConnectionError).message).toContain('empty or invalid WAV');
    }
  });

  it('piperSynthesize() sends raw text body', async () => {
    const samples = new Int16Array(100);
    const wavBuf = createTestWav(samples);
    let capturedBody: string | undefined;

    globalThis.fetch = mock(async (_url: any, init: any) => {
      capturedBody = init.body;
      return new Response(wavBuf, { status: 200 });
    }) as unknown as typeof fetch;

    await piperSynthesize({
      baseUrl: BASE_URL,
      text: 'Hi',
      timeoutMs: 5000,
    });

    expect(capturedBody).toBe('Hi');
  });
});
