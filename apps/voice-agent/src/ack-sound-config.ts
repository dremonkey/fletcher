/**
 * Resolves the acknowledgment sound source from configuration.
 *
 * FLETCHER_ACK_SOUND env var options:
 *   - undefined / 'builtin' — use the built-in synthesized tone (default)
 *   - 'disabled' — no acknowledgment sound
 *   - any other string — treated as a file path to an audio file
 */

import { existsSync } from 'node:fs';
import type { AudioFrame } from '@livekit/rtc-node';
import type { Logger } from 'pino';
import { createAckToneSingleShotSource } from './ack-tone';

/** Audio source types accepted by BackgroundAudioPlayer. */
type AudioSourceType = string | AsyncIterable<AudioFrame>;

/**
 * Resolve the acknowledgment sound from the FLETCHER_ACK_SOUND env var.
 *
 * @param envValue - value of FLETCHER_ACK_SOUND (may be undefined)
 * @param logger - pino logger for warnings
 * @returns An AudioSourceType for BackgroundAudioPlayer, or undefined to disable
 */
export function resolveAckSound(
  envValue: string | undefined,
  logger: Logger,
): AudioSourceType | undefined {
  const value = envValue?.trim().toLowerCase();

  // Disabled explicitly
  if (value === 'disabled' || value === 'off' || value === 'none' || value === 'false') {
    return undefined;
  }

  // Default: use built-in synthesized tone
  if (!value || value === 'builtin' || value === 'default') {
    return createAckToneSingleShotSource();
  }

  // Custom file path (use original case from env, not lowercased)
  const filePath = envValue!.trim();
  if (!existsSync(filePath)) {
    logger.warn(
      { path: filePath },
      'FLETCHER_ACK_SOUND file not found, falling back to built-in tone',
    );
    return createAckToneSingleShotSource();
  }

  return filePath;
}
