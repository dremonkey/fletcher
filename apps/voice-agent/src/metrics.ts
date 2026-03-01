/**
 * Correlates per-component metrics (EOU, LLM, TTS) into per-turn summaries.
 *
 * The @livekit/agents SDK emits MetricsCollected events individually for each
 * pipeline stage. This collector groups them by speechId so we can log a
 * single summary line per conversational turn.
 */

import type { Logger } from 'pino';

/** Subset of AgentMetrics fields we care about, keyed by type. */
interface TurnEntry {
  speechId: string;
  createdAt: number;
  eouDelayMs?: number;
  transcriptionDelayMs?: number;
  llmTtftMs?: number;
  llmDurationMs?: number;
  llmTokensPerSecond?: number;
  ttsTimeToFirstByteMs?: number;
  ttsDurationMs?: number;
}

const STALE_THRESHOLD_MS = 30_000;

export class TurnMetricsCollector {
  private turns = new Map<string, TurnEntry>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Ingest a metrics event from the SDK. Call this from the MetricsCollected handler.
   */
  collect(metrics: { type: string; speechId?: string; [k: string]: unknown }): void {
    const speechId = metrics.speechId as string | undefined;
    if (!speechId) return; // STT/VAD metrics don't have speechId — skip

    const entry = this.getOrCreate(speechId);

    switch (metrics.type) {
      case 'eou_metrics':
        entry.eouDelayMs = metrics.endOfUtteranceDelayMs as number;
        entry.transcriptionDelayMs = metrics.transcriptionDelayMs as number;
        break;
      case 'llm_metrics':
        entry.llmTtftMs = metrics.ttftMs as number;
        entry.llmDurationMs = metrics.durationMs as number;
        entry.llmTokensPerSecond = metrics.tokensPerSecond as number;
        break;
      case 'tts_metrics':
        entry.ttsTimeToFirstByteMs = metrics.ttfbMs as number;
        entry.ttsDurationMs = metrics.durationMs as number;
        this.emitSummary(entry);
        break;
    }
  }

  private getOrCreate(speechId: string): TurnEntry {
    let entry = this.turns.get(speechId);
    if (!entry) {
      entry = { speechId, createdAt: Date.now() };
      this.turns.set(speechId, entry);
      this.pruneStale();
    }
    return entry;
  }

  /**
   * Emit a per-turn summary once TTS metrics arrive (the last stage).
   */
  private emitSummary(entry: TurnEntry): void {
    const estimatedTotalMs =
      (entry.eouDelayMs ?? 0) + (entry.llmTtftMs ?? 0) + (entry.ttsTimeToFirstByteMs ?? 0);

    this.logger.info(
      {
        speechId: entry.speechId,
        eouDelayMs: entry.eouDelayMs ?? null,
        transcriptionDelayMs: entry.transcriptionDelayMs ?? null,
        llmTtftMs: entry.llmTtftMs ?? null,
        llmDurationMs: entry.llmDurationMs ?? null,
        llmTokensPerSecond: entry.llmTokensPerSecond != null
          ? Math.round(entry.llmTokensPerSecond)
          : null,
        ttsTimeToFirstByteMs: entry.ttsTimeToFirstByteMs ?? null,
        ttsDurationMs: entry.ttsDurationMs ?? null,
        estimatedTotalMs,
      },
      'Turn metrics summary',
    );

    // Clean up after emitting
    this.turns.delete(entry.speechId);
  }

  /** Remove entries older than STALE_THRESHOLD_MS to prevent memory leaks. */
  private pruneStale(): void {
    const now = Date.now();
    for (const [id, entry] of this.turns) {
      if (now - entry.createdAt > STALE_THRESHOLD_MS) {
        this.turns.delete(id);
      }
    }
  }

  /** Visible for testing. */
  get size(): number {
    return this.turns.size;
  }
}
