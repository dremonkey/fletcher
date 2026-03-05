/**
 * PiperTTS — a lightweight TTS plugin that delegates to a Piper HTTP sidecar.
 *
 * Non-streaming only (`capabilities: { streaming: false }`).  The LiveKit
 * `FallbackAdapter` auto-wraps it with `StreamAdapter` when streaming is needed.
 *
 * Piper returns a complete WAV file per request.  We strip the 44-byte header
 * and feed raw PCM into `AudioByteStream` to produce `AudioFrame[]`.
 */

import {
  tts,
  AudioByteStream,
  shortuuid,
  APIStatusError,
  APIConnectionError,
  type APIConnectOptions,
} from '@livekit/agents';

export const WAV_HEADER_SIZE = 44;
const DEFAULT_SAMPLE_RATE = 22050;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface PiperTTSOptions {
  /** Base URL of the Piper HTTP sidecar (e.g. "http://localhost:5000") */
  baseUrl: string;
  /** Request timeout in milliseconds (default: 10 000) */
  timeoutMs?: number;
  /** Sample rate of Piper output (default: 22 050 Hz) */
  sampleRate?: number;
}

/**
 * Fetch synthesized WAV audio from the Piper HTTP sidecar.
 *
 * Exported for unit testing — the ChunkedStream calls this internally.
 * Throws `APIStatusError` on 4xx/5xx, `APIConnectionError` on network/timeout.
 */
export async function piperSynthesize(opts: {
  baseUrl: string;
  text: string;
  timeoutMs: number;
}): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(opts.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: opts.text,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Piper connection failed';
    throw new APIConnectionError({ message });
  }

  if (!response.ok) {
    throw new APIStatusError({
      message: `Piper returned HTTP ${response.status}`,
      options: {
        statusCode: response.status,
        body: null,
        retryable: response.status >= 500,
      },
    });
  }

  const wavBuffer = await response.arrayBuffer();

  if (wavBuffer.byteLength <= WAV_HEADER_SIZE) {
    throw new APIConnectionError({ message: 'Piper returned empty or invalid WAV' });
  }

  return wavBuffer;
}

export class PiperTTS extends tts.TTS {
  readonly label = 'piper';

  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(opts: PiperTTSOptions) {
    const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
    super(sampleRate, 1, { streaming: false });
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  synthesize(
    text: string,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal,
  ): tts.ChunkedStream {
    return new PiperChunkedStream(this, text, {
      baseUrl: this.#baseUrl,
      timeoutMs: this.#timeoutMs,
      sampleRate: this.sampleRate,
      connOptions,
      abortSignal,
    });
  }

  stream(): tts.SynthesizeStream {
    throw new Error('PiperTTS does not support streaming — use FallbackAdapter with StreamAdapter');
  }
}

interface PiperChunkedStreamOpts {
  baseUrl: string;
  timeoutMs: number;
  sampleRate: number;
  connOptions?: APIConnectOptions;
  abortSignal?: AbortSignal;
}

class PiperChunkedStream extends tts.ChunkedStream {
  readonly label = 'piper';

  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #piperSampleRate: number;

  constructor(piperTts: PiperTTS, text: string, opts: PiperChunkedStreamOpts) {
    super(text, piperTts, opts.connOptions, opts.abortSignal);
    this.#baseUrl = opts.baseUrl;
    this.#timeoutMs = opts.timeoutMs;
    this.#piperSampleRate = opts.sampleRate;
  }

  protected async run(): Promise<void> {
    const requestId = shortuuid('piper-');
    const segmentId = shortuuid('seg-');

    const wavBuffer = await piperSynthesize({
      baseUrl: this.#baseUrl,
      text: this.inputText,
      timeoutMs: this.#timeoutMs,
    });

    // Strip WAV header → raw PCM
    const pcmBuffer = wavBuffer.slice(WAV_HEADER_SIZE);

    // Convert raw PCM bytes → AudioFrame[]
    const byteStream = new AudioByteStream(this.#piperSampleRate, 1);
    const frames = byteStream.write(pcmBuffer);
    const flushed = byteStream.flush();
    const allFrames = [...frames, ...flushed];

    for (let i = 0; i < allFrames.length; i++) {
      const isFinal = i === allFrames.length - 1;
      this.queue.put({
        requestId,
        segmentId,
        frame: allFrames[i]!,
        final: isFinal,
      });
    }
  }
}
