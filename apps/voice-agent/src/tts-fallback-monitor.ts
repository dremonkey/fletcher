/**
 * TTS Fallback Monitor — publishes ganglia-events artifacts when the
 * FallbackAdapter switches between primary and fallback TTS providers.
 *
 * Three voice states are communicated to the client:
 *
 * | Title              | Meaning                                           |
 * |--------------------|---------------------------------------------------|
 * | "Voice Degraded"   | Primary TTS failed; fallback (Piper) is active.   |
 * | "Voice Restored"   | Primary TTS recovered; high-fidelity voice is back.|
 * | "Voice Unavailable"| All TTS instances failed; text-only mode.          |
 *
 * "Voice Unavailable" is handled separately in the pipeline error handler
 * in agent.ts.  This module only handles "Degraded" and "Restored".
 *
 * (TASK-015)
 */

import { tts } from '@livekit/agents';

export interface FallbackMonitorDeps {
  publishEvent: (event: Record<string, unknown>) => void;
  logger: {
    warn: (obj: Record<string, unknown>, msg: string) => void;
    info: (obj: Record<string, unknown>, msg: string) => void;
  };
}

/**
 * Attaches a `tts_availability_changed` listener to the given FallbackAdapter
 * and publishes "Voice Degraded" / "Voice Restored" artifacts to the client.
 *
 * Only reacts to changes in the *primary* TTS instance (index 0).
 * Debounces artifacts to at most one per `debounceMsOverride` milliseconds.
 *
 * @returns a cleanup function that removes the listener.
 */
export function attachFallbackMonitor(
  adapter: tts.FallbackAdapter,
  deps: FallbackMonitorDeps,
  debounceMsOverride?: number,
): () => void {
  const DEBOUNCE_MS = debounceMsOverride ?? 60_000;
  let lastArtifact = 0;

  const handler = (ev: tts.AvailabilityChangedEvent) => {
    // Only care about the primary TTS (index 0).
    // Fallback (Piper) availability changes are not user-facing.
    if (ev.tts !== adapter.ttsInstances[0]) return;

    const now = Date.now();
    if (now - lastArtifact < DEBOUNCE_MS) return;
    lastArtifact = now;

    if (!ev.available) {
      deps.logger.warn(
        { primary: ev.tts.label },
        'Primary TTS unavailable — using fallback (Piper)',
      );
      deps.publishEvent({
        type: 'artifact',
        artifact_type: 'error',
        title: 'Voice Degraded',
        message: 'Using backup voice. Quality may be reduced.',
      });
    } else {
      deps.logger.info(
        { primary: ev.tts.label },
        'Primary TTS recovered — resuming high-fidelity voice',
      );
      deps.publishEvent({
        type: 'artifact',
        artifact_type: 'error',
        title: 'Voice Restored',
        message: 'High-quality voice is back.',
      });
    }
  };

  // The FallbackAdapter emits 'tts_availability_changed' as a custom event
  // outside its typed EventEmitter interface — cast to subscribe.
  const emitter = adapter as unknown as {
    on(event: string, cb: typeof handler): void;
    off(event: string, cb: typeof handler): void;
  };
  emitter.on('tts_availability_changed', handler);

  return () => {
    emitter.off('tts_availability_changed', handler);
  };
}
