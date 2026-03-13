import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { tts, initializeLogger } from '@livekit/agents';
import { attachFallbackMonitor, type FallbackMonitorDeps } from './tts-fallback-monitor';

// LiveKit SDK requires a global logger — initialize once
initializeLogger({ pretty: false, level: 'silent' });

// ---------------------------------------------------------------------------
// Minimal mock TTS for testing FallbackAdapter events
// ---------------------------------------------------------------------------
class MockTTS extends tts.TTS {
  label: string;

  constructor(label: string) {
    super(22050, 1, { streaming: false });
    this.label = label;
  }

  synthesize(): tts.ChunkedStream {
    throw new Error('not implemented');
  }

  stream(): tts.SynthesizeStream {
    throw new Error('not implemented');
  }
}

describe('attachFallbackMonitor', () => {
  let primaryTts: MockTTS;
  let fallbackTts: MockTTS;
  let adapter: tts.FallbackAdapter;
  let deps: FallbackMonitorDeps;
  let publishedEvents: Record<string, unknown>[];
  let logMessages: { level: string; msg: string }[];

  beforeEach(() => {
    primaryTts = new MockTTS('google.TTS');
    fallbackTts = new MockTTS('piper');
    adapter = new tts.FallbackAdapter({
      ttsInstances: [primaryTts, fallbackTts],
      maxRetryPerTTS: 0,
    });

    publishedEvents = [];
    logMessages = [];

    deps = {
      publishEvent: (event) => publishedEvents.push(event),
      logger: {
        warn: (_obj, msg) => logMessages.push({ level: 'warn', msg }),
        info: (_obj, msg) => logMessages.push({ level: 'info', msg }),
      },
    };
  });

  it('publishes "Voice Degraded" when primary TTS becomes unavailable', () => {
    attachFallbackMonitor(adapter, deps, 0);

    // Simulate the FallbackAdapter marking primary as unavailable
    const emitter = adapter as unknown as {
      emit(event: string, data: tts.AvailabilityChangedEvent): void;
    };
    emitter.emit('tts_availability_changed', { tts: primaryTts, available: false });

    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]).toEqual({
      type: 'system_event',
      severity: 'error',
      title: 'Voice Degraded',
      message: 'Using backup voice. Quality may be reduced.',
    });
  });

  it('publishes "Voice Restored" when primary TTS recovers', () => {
    attachFallbackMonitor(adapter, deps, 0);

    const emitter = adapter as unknown as {
      emit(event: string, data: tts.AvailabilityChangedEvent): void;
    };
    emitter.emit('tts_availability_changed', { tts: primaryTts, available: true });

    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]).toEqual({
      type: 'system_event',
      severity: 'success',
      title: 'Voice Restored',
      message: 'High-quality voice is back.',
    });
  });

  it('ignores fallback TTS availability changes', () => {
    attachFallbackMonitor(adapter, deps, 0);

    const emitter = adapter as unknown as {
      emit(event: string, data: tts.AvailabilityChangedEvent): void;
    };
    // Emit for the fallback (Piper) TTS, not the primary
    emitter.emit('tts_availability_changed', { tts: fallbackTts, available: false });

    expect(publishedEvents).toHaveLength(0);
  });

  it('debounces artifacts within the debounce window', () => {
    // Use a large debounce so subsequent events are suppressed
    attachFallbackMonitor(adapter, deps, 60_000);

    const emitter = adapter as unknown as {
      emit(event: string, data: tts.AvailabilityChangedEvent): void;
    };

    // First event goes through
    emitter.emit('tts_availability_changed', { tts: primaryTts, available: false });
    expect(publishedEvents).toHaveLength(1);

    // Second event within debounce window is suppressed
    emitter.emit('tts_availability_changed', { tts: primaryTts, available: true });
    expect(publishedEvents).toHaveLength(1);
  });

  it('allows artifacts after debounce window expires', () => {
    attachFallbackMonitor(adapter, deps, 0);

    const emitter = adapter as unknown as {
      emit(event: string, data: tts.AvailabilityChangedEvent): void;
    };

    // Both events go through with 0ms debounce
    emitter.emit('tts_availability_changed', { tts: primaryTts, available: false });
    emitter.emit('tts_availability_changed', { tts: primaryTts, available: true });
    expect(publishedEvents).toHaveLength(2);
    expect(publishedEvents[0]!.title).toBe('Voice Degraded');
    expect(publishedEvents[1]!.title).toBe('Voice Restored');
  });

  it('returns a cleanup function that removes the listener', () => {
    const cleanup = attachFallbackMonitor(adapter, deps, 0);

    const emitter = adapter as unknown as {
      emit(event: string, data: tts.AvailabilityChangedEvent): void;
    };

    // Event before cleanup
    emitter.emit('tts_availability_changed', { tts: primaryTts, available: false });
    expect(publishedEvents).toHaveLength(1);

    // Clean up
    cleanup();

    // Event after cleanup — should not be received
    emitter.emit('tts_availability_changed', { tts: primaryTts, available: true });
    expect(publishedEvents).toHaveLength(1);
  });

  it('logs at warn level for degradation, info level for recovery', () => {
    attachFallbackMonitor(adapter, deps, 0);

    const emitter = adapter as unknown as {
      emit(event: string, data: tts.AvailabilityChangedEvent): void;
    };

    emitter.emit('tts_availability_changed', { tts: primaryTts, available: false });
    emitter.emit('tts_availability_changed', { tts: primaryTts, available: true });

    expect(logMessages).toHaveLength(2);
    expect(logMessages[0]!.level).toBe('warn');
    expect(logMessages[0]!.msg).toContain('fallback');
    expect(logMessages[1]!.level).toBe('info');
    expect(logMessages[1]!.msg).toContain('recovered');
  });
});
