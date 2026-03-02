import { describe, expect, it } from 'bun:test';
import { ackToneFrames, synthesizeAckTone, createAckToneSource } from './ack-tone';

describe('synthesizeAckTone', () => {
  it('produces a non-empty Int16Array', () => {
    const pcm = synthesizeAckTone();
    expect(pcm).toBeInstanceOf(Int16Array);
    expect(pcm.length).toBeGreaterThan(0);
  });

  it('produces ~300ms of audio at 48kHz', () => {
    const pcm = synthesizeAckTone();
    // 2 notes of 120ms + 40ms gap = 280ms => ~13440 samples at 48kHz
    const expectedSamples = Math.round((0.12 + 0.04 + 0.12) * 48000);
    expect(pcm.length).toBe(expectedSamples);
  });

  it('contains non-zero samples (actual audio data)', () => {
    const pcm = synthesizeAckTone();
    const hasNonZero = pcm.some((v) => v !== 0);
    expect(hasNonZero).toBe(true);
  });

  it('has a silent gap between the two notes', () => {
    const pcm = synthesizeAckTone();
    const noteSamples = Math.round(0.12 * 48000);
    const gapSamples = Math.round(0.04 * 48000);

    // Middle of the gap should be silent
    const gapMid = noteSamples + Math.floor(gapSamples / 2);
    expect(pcm[gapMid]).toBe(0);
  });

  it('amplitude stays within +-25% of Int16 max', () => {
    const pcm = synthesizeAckTone();
    const maxAbs = pcm.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    // 0.25 * 32767 = 8191.75 — allow a small margin
    expect(maxAbs).toBeLessThanOrEqual(8192);
    expect(maxAbs).toBeGreaterThan(0);
  });
});

describe('ackToneFrames', () => {
  it('yields AudioFrame objects with correct properties', async () => {
    const frames = [];
    for await (const frame of ackToneFrames()) {
      frames.push(frame);
    }
    expect(frames.length).toBeGreaterThan(0);

    for (const frame of frames) {
      expect(frame.sampleRate).toBe(48000);
      expect(frame.channels).toBe(1);
      expect(frame.samplesPerChannel).toBeGreaterThan(0);
      expect(frame.data).toBeInstanceOf(Int16Array);
      expect(frame.data.length).toBe(frame.samplesPerChannel);
    }
  });

  it('total samples across all frames matches synthesized PCM length', async () => {
    const pcm = synthesizeAckTone();
    let totalSamples = 0;
    for await (const frame of ackToneFrames()) {
      totalSamples += frame.samplesPerChannel;
    }
    expect(totalSamples).toBe(pcm.length);
  });
});

describe('createAckToneSource', () => {
  it('returns an AsyncIterable that can be consumed', async () => {
    const source = createAckToneSource();
    const frames = [];
    for await (const frame of source) {
      frames.push(frame);
    }
    expect(frames.length).toBeGreaterThan(0);
  });

  it('can be iterated multiple times (new iterator each time)', async () => {
    const source = createAckToneSource();

    const frames1 = [];
    for await (const frame of source) {
      frames1.push(frame);
    }

    const frames2 = [];
    for await (const frame of source) {
      frames2.push(frame);
    }

    expect(frames1.length).toBe(frames2.length);
  });
});
