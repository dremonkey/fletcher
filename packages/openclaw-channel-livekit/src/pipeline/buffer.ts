/**
 * Audio buffering utilities for optimizing latency.
 *
 * Handles audio chunk management, buffering, and jitter compensation.
 */
import { getLivekitLogger } from "../runtime.js";

/**
 * Buffer configuration.
 */
export interface BufferConfig {
  /** Target buffer size in milliseconds */
  targetMs: number;
  /** Maximum buffer size in milliseconds */
  maxMs: number;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Number of audio channels */
  channels: number;
  /** Bits per sample */
  bitDepth: number;
}

/**
 * Default buffer configuration for low-latency voice.
 */
export const DEFAULT_BUFFER_CONFIG: BufferConfig = {
  targetMs: 100, // 100ms target buffer
  maxMs: 500, // 500ms max buffer
  sampleRate: 48000,
  channels: 1,
  bitDepth: 16,
};

/**
 * Audio buffer for managing incoming/outgoing audio chunks.
 */
export class AudioBuffer {
  private config: BufferConfig;
  private buffer: Buffer[] = [];
  private totalBytes = 0;
  private bytesPerMs: number;

  constructor(config: Partial<BufferConfig> = {}) {
    this.config = { ...DEFAULT_BUFFER_CONFIG, ...config };
    this.bytesPerMs =
      (this.config.sampleRate * this.config.channels * (this.config.bitDepth / 8)) / 1000;
  }

  /**
   * Add audio data to the buffer.
   */
  push(chunk: Buffer): void {
    const log = getLivekitLogger();
    const maxBytes = this.config.maxMs * this.bytesPerMs;

    // Check if buffer is full
    if (this.totalBytes + chunk.length > maxBytes) {
      log.warn(`Audio buffer overflow, dropping ${chunk.length} bytes`);
      // Drop oldest data to make room
      while (this.totalBytes + chunk.length > maxBytes && this.buffer.length > 0) {
        const dropped = this.buffer.shift();
        if (dropped) {
          this.totalBytes -= dropped.length;
        }
      }
    }

    this.buffer.push(chunk);
    this.totalBytes += chunk.length;
  }

  /**
   * Get audio data from the buffer.
   * Returns null if not enough data is available.
   */
  pull(bytes: number): Buffer | null {
    if (this.totalBytes < bytes) {
      return null;
    }

    const result: Buffer[] = [];
    let remaining = bytes;

    while (remaining > 0 && this.buffer.length > 0) {
      const chunk = this.buffer[0];

      if (chunk.length <= remaining) {
        // Take the whole chunk
        result.push(chunk);
        remaining -= chunk.length;
        this.totalBytes -= chunk.length;
        this.buffer.shift();
      } else {
        // Take a portion of the chunk
        result.push(chunk.subarray(0, remaining));
        this.buffer[0] = chunk.subarray(remaining);
        this.totalBytes -= remaining;
        remaining = 0;
      }
    }

    return Buffer.concat(result);
  }

  /**
   * Get all available audio data.
   */
  pullAll(): Buffer {
    const result = Buffer.concat(this.buffer);
    this.buffer = [];
    this.totalBytes = 0;
    return result;
  }

  /**
   * Get the current buffer duration in milliseconds.
   */
  getDurationMs(): number {
    return this.totalBytes / this.bytesPerMs;
  }

  /**
   * Check if buffer has enough data for playback.
   */
  isReady(): boolean {
    return this.getDurationMs() >= this.config.targetMs;
  }

  /**
   * Check if buffer is empty.
   */
  isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  /**
   * Get the current buffer size in bytes.
   */
  getSize(): number {
    return this.totalBytes;
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.buffer = [];
    this.totalBytes = 0;
  }
}

/**
 * Jitter buffer for smoothing out network timing variations.
 */
export class JitterBuffer extends AudioBuffer {
  private minBufferMs: number;
  private lastPullTime: number | null = null;

  constructor(config: Partial<BufferConfig> & { minBufferMs?: number } = {}) {
    super(config);
    this.minBufferMs = config.minBufferMs ?? 50; // 50ms minimum buffer
  }

  /**
   * Pull audio data, waiting for minimum buffer if needed.
   */
  pullWithJitterCompensation(bytes: number): Buffer | null {
    const currentDuration = this.getDurationMs();

    // Wait until we have minimum buffer
    if (currentDuration < this.minBufferMs) {
      return null;
    }

    return this.pull(bytes);
  }

  /**
   * Get jitter statistics.
   */
  getStats(): { durationMs: number; minBufferMs: number; isStable: boolean } {
    const durationMs = this.getDurationMs();
    return {
      durationMs,
      minBufferMs: this.minBufferMs,
      isStable: durationMs >= this.minBufferMs,
    };
  }
}

/**
 * Calculate bytes for a given duration.
 */
export function msToBytes(
  ms: number,
  sampleRate: number,
  channels: number,
  bitDepth: number
): number {
  return Math.ceil((ms / 1000) * sampleRate * channels * (bitDepth / 8));
}

/**
 * Calculate duration for a given number of bytes.
 */
export function bytesToMs(
  bytes: number,
  sampleRate: number,
  channels: number,
  bitDepth: number
): number {
  return (bytes / (sampleRate * channels * (bitDepth / 8))) * 1000;
}
