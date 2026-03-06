/**
 * Transcript stream management — extracted from agent.ts for testability.
 *
 * Manages per-stream transcript segments to avoid race conditions where
 * concurrent LLM streams (old HTTP connections still draining) corrupt
 * newer streams' transcript events.  See BUG-010, BUG-011.
 *
 * The key invariant: each LLM stream gets its own segment keyed by streamId.
 * Only the active stream may trigger UI side-effects (stopAck, publishStatus).
 * Stale streams silently finalize without touching shared UI state.
 *
 * BUG-011 fix: Track all known stream IDs to distinguish pondering rotation
 * (same stream, already seen) from a truly new stream starting (unseen streamId).
 * Zombie streams whose HTTP connections linger emit pondering rotations every
 * 3 seconds — these must NOT steal the active stream slot or create new segments,
 * even after their original segment has been finalized and deleted.
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
  private knownStreamIds = new Set<string>();
  private activeStreamId: string | null = null;
  private nextSegmentId = 0;

  constructor(private deps: TranscriptManagerDeps) {}

  /**
   * Called when the LLM stream enters or exits the "pondering" phase.
   *
   * - `phrase` truthy + unseen streamId: New stream starting — finalize any
   *   previous active stream, allocate a new segment, publish "thinking" status.
   * - `phrase` truthy + known streamId: Pondering rotation on an existing or
   *   previously-finalized stream.  Only publish status if this is the active
   *   stream; silently ignore if stale or zombie (BUG-011 fix).
   * - `phrase` null: Pondering cleared.  Fires TWICE per stream in llm.ts:
   *     1. When first content chunk arrives (BEFORE onContent)
   *     2. In the finally block (AFTER all content)
   *   We use `contentStarted` to distinguish: only finalize on the second call.
   */
  onPondering(phrase: string | null, streamId: string): void {
    if (phrase) {
      if (this.knownStreamIds.has(streamId)) {
        // Already-seen stream — pondering rotation or zombie.
        // Only publish status if this is the active stream with a live segment.
        const existingSeg = this.streamSegments.get(streamId);
        if (existingSeg && streamId === this.activeStreamId) {
          this.deps.logger.info({ phrase, segmentId: existingSeg.segId, streamId }, 'Pondering status published');
          this.deps.publishStatus('thinking', phrase);
        }
        // Stale/zombie streams silently ignored (BUG-011).
        return;
      }

      // Truly new stream (unseen streamId) — finalize previous active stream
      this.knownStreamIds.add(streamId);
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
      // Clean up knownStreamIds once the segment is gone.  This fires when:
      // 1. Natural completion: finalizeStream just deleted the segment above.
      // 2. Interrupted stream's finally block: segment was already deleted
      //    when the new stream started — the HTTP connection is now closing,
      //    so no more zombie rotations will follow.
      // We do NOT clean up on the first onPondering(null) (pre-content),
      // because the segment still exists at that point.
      if (!this.streamSegments.has(streamId)) {
        this.knownStreamIds.delete(streamId);
      }
    }
  }

  /**
   * Called for each content delta from the LLM stream.
   * Silently ignored if the streamId is unknown (already finalized/deleted)
   * or if the stream is not the active one (stale zombie stream — BUG-011).
   */
  onContent(delta: string, fullText: string, streamId: string): void {
    const seg = this.streamSegments.get(streamId);
    if (!seg) return;
    // Only accept content from the active stream — stale zombie streams
    // whose HTTP connections linger may deliver late content (BUG-011).
    if (streamId !== this.activeStreamId) return;
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
  get _knownStreamIds(): ReadonlySet<string> { return this.knownStreamIds; }
}
