/**
 * Synthesizes a short digital acknowledgment tone (~300ms).
 *
 * The tone is a two-note ascending chime (C5 -> E5) with a smooth
 * amplitude envelope (attack/decay). It sounds mechanical/digital,
 * not human — communicating "heard you, processing" honestly.
 *
 * The tone is generated as an AsyncIterable<AudioFrame> compatible
 * with the LiveKit BackgroundAudioPlayer's thinkingSound option.
 *
 * Audio parameters: 48kHz, mono, 16-bit PCM (Int16).
 */

import { AudioFrame } from '@livekit/rtc-node';

/** Standard sample rate used throughout the LiveKit pipeline. */
const SAMPLE_RATE = 48000;
/** Mono channel. */
const NUM_CHANNELS = 1;

/** Frequency of the first note (C5 = 523.25 Hz). */
const NOTE1_FREQ = 523.25;
/** Frequency of the second note (E5 = 659.25 Hz). */
const NOTE2_FREQ = 659.25;

/** Duration of each note in seconds. */
const NOTE_DURATION_S = 0.12;
/** Gap between notes in seconds. */
const GAP_DURATION_S = 0.04;
/** Fade-in time in seconds (attack). */
const ATTACK_S = 0.01;
/** Fade-out time in seconds (decay). */
const DECAY_S = 0.06;

/** Peak amplitude as fraction of Int16 max. Keep subtle. */
const AMPLITUDE = 0.25;

/** How many samples per AudioFrame chunk we yield (100ms at 48kHz). */
const CHUNK_SAMPLES = 4800;

/**
 * Generate a smooth amplitude envelope for a single note.
 *
 * @param sampleIndex - sample index within the note
 * @param totalSamples - total samples in the note
 * @param attackSamples - number of attack (fade-in) samples
 * @param decaySamples - number of decay (fade-out) samples
 * @returns envelope value in [0, 1]
 */
function envelope(
  sampleIndex: number,
  totalSamples: number,
  attackSamples: number,
  decaySamples: number,
): number {
  if (sampleIndex < attackSamples) {
    // Smooth attack (sine curve)
    return Math.sin((Math.PI / 2) * (sampleIndex / attackSamples));
  }
  const decayStart = totalSamples - decaySamples;
  if (sampleIndex >= decayStart) {
    // Smooth decay (cosine curve)
    return Math.cos((Math.PI / 2) * ((sampleIndex - decayStart) / decaySamples));
  }
  return 1.0;
}

/**
 * Synthesize the raw Int16 PCM samples for the acknowledgment tone.
 *
 * Returns the complete waveform as a single Int16Array.
 */
export function synthesizeAckTone(): Int16Array {
  const noteSamples = Math.round(NOTE_DURATION_S * SAMPLE_RATE);
  const gapSamples = Math.round(GAP_DURATION_S * SAMPLE_RATE);
  const attackSamples = Math.round(ATTACK_S * SAMPLE_RATE);
  const decaySamples = Math.round(DECAY_S * SAMPLE_RATE);

  const totalSamples = noteSamples + gapSamples + noteSamples;
  const pcm = new Int16Array(totalSamples);
  const maxAmplitude = 32767 * AMPLITUDE;

  // Note 1: C5
  for (let i = 0; i < noteSamples; i++) {
    const t = i / SAMPLE_RATE;
    const env = envelope(i, noteSamples, attackSamples, decaySamples);
    pcm[i] = Math.round(Math.sin(2 * Math.PI * NOTE1_FREQ * t) * env * maxAmplitude);
  }

  // Gap: silence (already zero-filled)

  // Note 2: E5
  const note2Start = noteSamples + gapSamples;
  for (let i = 0; i < noteSamples; i++) {
    const t = i / SAMPLE_RATE;
    const env = envelope(i, noteSamples, attackSamples, decaySamples);
    pcm[note2Start + i] = Math.round(Math.sin(2 * Math.PI * NOTE2_FREQ * t) * env * maxAmplitude);
  }

  return pcm;
}

/**
 * Create an AsyncIterable<AudioFrame> that yields the acknowledgment tone
 * as a sequence of audio frame chunks.
 *
 * Compatible with LiveKit's BackgroundAudioPlayer thinkingSound option.
 * The iterable is single-use (plays the tone once, then ends).
 */
export async function* ackToneFrames(): AsyncGenerator<AudioFrame> {
  const pcm = synthesizeAckTone();
  let offset = 0;

  while (offset < pcm.length) {
    const remaining = pcm.length - offset;
    const chunkSize = Math.min(CHUNK_SAMPLES, remaining);
    const chunkData = pcm.slice(offset, offset + chunkSize);

    yield new AudioFrame(chunkData, SAMPLE_RATE, NUM_CHANNELS, chunkSize);
    offset += chunkSize;
  }
}

/**
 * Create a factory function that produces a fresh AsyncIterable<AudioFrame>
 * each time it's called. This is necessary because BackgroundAudioPlayer
 * needs a new iterable for each play invocation.
 */
export function createAckToneSource(): AsyncIterable<AudioFrame> {
  return {
    [Symbol.asyncIterator]: () => ackToneFrames(),
  };
}
