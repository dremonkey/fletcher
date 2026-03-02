/**
 * Transcript stream management — extracted from agent.ts for testability.
 *
 * Manages per-stream transcript segments to avoid race conditions where
 * concurrent LLM streams (old HTTP connections still draining) corrupt
 * newer streams' transcript events.  See BUG-010.
 *
 * The key invariant: each LLM stream gets its own segment keyed by streamId.
 * Only the active stream may trigger UI side-effects (stopAck, publishStatus).
 * Stale streams silently finalize without touching shared UI state.
 */

export interface TranscriptManagerDeps {
  publishEvent: (event: Record<string, unknown>) => void;
  publishStatus: (action: string, detail?: string) => void;
  stopAck: () => void;
  logger: { info: (obj: Record<string, unknown> | string, msg?: string) => void };
}

interface StreamSegment {
  segId: number;
  text: string;
  contentStarted: boolean;
}

export class TranscriptManager {
  private streamSegments = new Map<string, StreamSegment>();
  private activeStreamId: string | null = null;
  private nextSegmentId = 0;

  constructor(private deps: TranscriptManagerDeps) {}

  /**
   * Called when the LLM stream enters or exits the "pondering" phase.
   *
   * - `phrase` truthy: New stream starting — finalize any previous active
   *   stream, allocate a new segment, publish "thinking" status.
   * - `phrase` null: Pondering cleared.  Fires TWICE per stream in llm.ts:
   *     1. When first content chunk arrives (BEFORE onContent)
   *     2. In the finally block (AFTER all content)
   *   We use `contentStarted` to distinguish: only finalize on the second call.
   */
  onPondering(phrase: string | null, streamId: string): void {
    if (phrase) {
      // New LLM stream starting — finalize previous active stream
      if (this.activeStreamId && this.streamSegments.has(this.activeStreamId)) {
        this.finalizeStream(this.activeStreamId);
      }
      const segId = ++this.nextSegmentId;
      this.streamSegments.set(streamId, { segId, text: '', contentStarted: false });
      this.activeStreamId = streamId;
      this.deps.logger.info({ phrase, segmentId: segId, streamId }, 'Pondering status published');
      this.deps.publishStatus('thinking', phrase);
    } else {
      // Pondering cleared (first content arrived OR stream ended).
      // Only touch UI if this is the current active stream — stale
      // streams must not clobber newer streams' pondering/ack state.
      if (streamId === this.activeStreamId) {
        this.deps.logger.info({ streamId }, 'Pondering cleared');
        this.deps.stopAck();
      }
      // Finalize only if content was already received (= stream done).
      // The first onPondering(null) fires BEFORE any onContent, so
      // contentStarted is still false — we correctly skip finalization.
      // The second call (from the finally block) sees contentStarted=true.
      const seg = this.streamSegments.get(streamId);
      if (seg?.contentStarted) {
        this.finalizeStream(streamId);
      }
    }
  }

  /**
   * Called for each content delta from the LLM stream.
   * Silently ignored if the streamId is unknown (already finalized/deleted).
   */
  onContent(delta: string, fullText: string, streamId: string): void {
    const seg = this.streamSegments.get(streamId);
    if (!seg) return;
    seg.contentStarted = true;
    seg.text = fullText;
    this.deps.publishEvent({
      type: 'agent_transcript',
      segmentId: `seg_${seg.segId}`,
      delta,
      text: fullText,
      final: false,
    });
  }

  private finalizeStream(streamId: string): void {
    const seg = this.streamSegments.get(streamId);
    if (!seg) return;
    if (seg.text) {
      this.deps.publishEvent({
        type: 'agent_transcript',
        segmentId: `seg_${seg.segId}`,
        delta: '',
        text: seg.text,
        final: true,
      });
    }
    this.streamSegments.delete(streamId);
  }

  // Expose internals for testing
  get _activeStreamId(): string | null { return this.activeStreamId; }
  get _segments(): ReadonlyMap<string, StreamSegment> { return this.streamSegments; }
}
