import { describe, test, expect, mock } from 'bun:test';
import { TurnMetricsCollector } from './metrics';

function makeLogger() {
  const calls: { level: string; args: unknown[] }[] = [];
  return {
    logger: {
      info: (...args: unknown[]) => calls.push({ level: 'info', args }),
      debug: (...args: unknown[]) => calls.push({ level: 'debug', args }),
      warn: (...args: unknown[]) => calls.push({ level: 'warn', args }),
      error: (...args: unknown[]) => calls.push({ level: 'error', args }),
      fatal: (...args: unknown[]) => calls.push({ level: 'fatal', args }),
      child: () => makeLogger().logger,
    } as any,
    calls,
  };
}

describe('TurnMetricsCollector', () => {
  test('correlates EOU + LLM + TTS by speechId and emits summary', () => {
    const { logger, calls } = makeLogger();
    const collector = new TurnMetricsCollector(logger);

    collector.collect({
      type: 'eou_metrics',
      speechId: 'sp-1',
      endOfUtteranceDelayMs: 120,
      transcriptionDelayMs: 80,
    });

    collector.collect({
      type: 'llm_metrics',
      speechId: 'sp-1',
      ttftMs: 350,
      durationMs: 900,
      tokensPerSecond: 42.7,
    });

    // No summary emitted yet — waiting for TTS
    expect(calls.length).toBe(0);
    expect(collector.size).toBe(1);

    collector.collect({
      type: 'tts_metrics',
      speechId: 'sp-1',
      ttfbMs: 150,
      durationMs: 600,
    });

    // Summary should now be emitted
    expect(calls.length).toBe(1);
    expect(calls[0].level).toBe('info');

    const summary = calls[0].args[0] as Record<string, unknown>;
    expect(summary.speechId).toBe('sp-1');
    expect(summary.eouDelayMs).toBe(120);
    expect(summary.llmTtftMs).toBe(350);
    expect(summary.ttsTimeToFirstByteMs).toBe(150);
    expect(summary.estimatedTotalMs).toBe(620); // 120 + 350 + 150

    // Entry should be cleaned up
    expect(collector.size).toBe(0);
  });

  test('ignores metrics without speechId', () => {
    const { logger, calls } = makeLogger();
    const collector = new TurnMetricsCollector(logger);

    collector.collect({ type: 'stt_metrics', durationMs: 0 });
    collector.collect({ type: 'vad_metrics', idleTimeMs: 500 });

    expect(collector.size).toBe(0);
    expect(calls.length).toBe(0);
  });

  test('handles partial data (TTS arrives without LLM)', () => {
    const { logger, calls } = makeLogger();
    const collector = new TurnMetricsCollector(logger);

    collector.collect({
      type: 'tts_metrics',
      speechId: 'sp-2',
      ttfbMs: 200,
      durationMs: 400,
    });

    expect(calls.length).toBe(1);
    const summary = calls[0].args[0] as Record<string, unknown>;
    expect(summary.llmTtftMs).toBeNull();
    expect(summary.ttsTimeToFirstByteMs).toBe(200);
    expect(summary.estimatedTotalMs).toBe(200); // 0 + 0 + 200
  });

  test('tracks multiple concurrent turns independently', () => {
    const { logger, calls } = makeLogger();
    const collector = new TurnMetricsCollector(logger);

    collector.collect({ type: 'llm_metrics', speechId: 'sp-a', ttftMs: 100, durationMs: 500, tokensPerSecond: 30 });
    collector.collect({ type: 'llm_metrics', speechId: 'sp-b', ttftMs: 200, durationMs: 600, tokensPerSecond: 40 });

    expect(collector.size).toBe(2);

    collector.collect({ type: 'tts_metrics', speechId: 'sp-b', ttfbMs: 180, durationMs: 300 });
    expect(calls.length).toBe(1);
    expect((calls[0].args[0] as any).speechId).toBe('sp-b');

    collector.collect({ type: 'tts_metrics', speechId: 'sp-a', ttfbMs: 160, durationMs: 250 });
    expect(calls.length).toBe(2);
    expect((calls[1].args[0] as any).speechId).toBe('sp-a');
  });

  test('prunes stale entries older than 30s', () => {
    const { logger } = makeLogger();
    const collector = new TurnMetricsCollector(logger);

    // Insert an entry, then manually backdate it
    collector.collect({ type: 'llm_metrics', speechId: 'old', ttftMs: 100, durationMs: 200, tokensPerSecond: 10 });
    expect(collector.size).toBe(1);

    // Access internals to backdate the entry
    const turns = (collector as any).turns as Map<string, { createdAt: number }>;
    turns.get('old')!.createdAt = Date.now() - 31_000;

    // Inserting a new entry triggers pruning
    collector.collect({ type: 'llm_metrics', speechId: 'new', ttftMs: 200, durationMs: 300, tokensPerSecond: 20 });

    expect(collector.size).toBe(1);
    expect(turns.has('old')).toBe(false);
    expect(turns.has('new')).toBe(true);
  });
});
