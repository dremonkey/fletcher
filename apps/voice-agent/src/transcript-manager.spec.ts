import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { TranscriptManager, type TranscriptManagerDeps } from './transcript-manager';

function makeDeps(): TranscriptManagerDeps & {
  events: Record<string, unknown>[];
  statuses: { action: string; detail?: string }[];
  stopAckCalls: number;
  logs: unknown[];
} {
  const events: Record<string, unknown>[] = [];
  const statuses: { action: string; detail?: string }[] = [];
  let stopAckCalls = 0;
  const logs: unknown[] = [];
  return {
    events,
    statuses,
    stopAckCalls,
    logs,
    publishEvent: (event) => events.push(event),
    publishStatus: (action, detail) => statuses.push({ action, detail }),
    stopAck: () => { stopAckCalls++; /* update the mutable ref */ deps.stopAckCalls = stopAckCalls; },
    logger: { info: (...args: unknown[]) => logs.push(args) },
  };
  // Self-reference so stopAck can update the counter on the returned object
  var deps: ReturnType<typeof makeDeps>;
  // @ts-expect-error: assigned before first use
  deps = undefined as any;
}

// Wrapper that properly links the self-reference
function createDeps() {
  const d = makeDeps();
  // Patch stopAck to use a closure over d
  let count = 0;
  d.stopAck = () => { count++; d.stopAckCalls = count; };
  return d;
}

describe('TranscriptManager', () => {
  let deps: ReturnType<typeof createDeps>;
  let mgr: TranscriptManager;

  beforeEach(() => {
    deps = createDeps();
    mgr = new TranscriptManager(deps);
  });

  // -------------------------------------------------------------------------
  // 1. Normal flow: pondering → content → finalize
  // -------------------------------------------------------------------------
  describe('normal flow', () => {
    it('publishes transcript events and finalizes on stream end', () => {
      // Stream starts pondering
      mgr.onPondering('Thinking...', 'stream-1');
      expect(deps.statuses).toEqual([{ action: 'thinking', detail: 'Thinking...' }]);
      expect(mgr._activeStreamId).toBe('stream-1');
      expect(mgr._segments.size).toBe(1);

      // First onPondering(null) — content about to start
      mgr.onPondering(null, 'stream-1');
      expect(deps.stopAckCalls).toBe(1);
      // Segment still exists (contentStarted is false, no finalize)
      expect(mgr._segments.size).toBe(1);

      // Content arrives
      mgr.onContent('Hello', 'Hello', 'stream-1');
      mgr.onContent(' world', 'Hello world', 'stream-1');

      expect(deps.events).toEqual([
        { type: 'agent_transcript', segmentId: 'seg_1', delta: 'Hello', text: 'Hello', final: false },
        { type: 'agent_transcript', segmentId: 'seg_1', delta: ' world', text: 'Hello world', final: false },
      ]);

      // Second onPondering(null) — stream done, should finalize
      mgr.onPondering(null, 'stream-1');
      expect(deps.stopAckCalls).toBe(2);
      expect(deps.events).toHaveLength(3);
      expect(deps.events[2]).toEqual({
        type: 'agent_transcript',
        segmentId: 'seg_1',
        delta: '',
        text: 'Hello world',
        final: true,
      });
      // Segment cleaned up
      expect(mgr._segments.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Pondering(null) before content — first call does NOT finalize
  // -------------------------------------------------------------------------
  describe('pondering(null) before content', () => {
    it('does not delete segment on first pondering(null)', () => {
      mgr.onPondering('Hmm...', 'stream-1');
      mgr.onPondering(null, 'stream-1');

      // Segment still alive, no transcript events emitted
      expect(mgr._segments.size).toBe(1);
      expect(deps.events).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Pondering(null) after content — second call DOES finalize
  // -------------------------------------------------------------------------
  describe('pondering(null) after content', () => {
    it('finalizes segment when contentStarted is true', () => {
      mgr.onPondering('Processing...', 'stream-1');
      mgr.onPondering(null, 'stream-1'); // first: pre-content
      mgr.onContent('Hi', 'Hi', 'stream-1');
      mgr.onPondering(null, 'stream-1'); // second: post-content

      const finalEvent = deps.events.find((e) => e.final === true);
      expect(finalEvent).toEqual({
        type: 'agent_transcript',
        segmentId: 'seg_1',
        delta: '',
        text: 'Hi',
        final: true,
      });
      expect(mgr._segments.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Interruption mid-content — new stream finalizes old
  // -------------------------------------------------------------------------
  describe('interruption mid-content', () => {
    it('finalizes old stream when new stream starts pondering', () => {
      // Stream 1 starts and emits content
      mgr.onPondering('First thought', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('Part', 'Part', 'stream-1');

      // Stream 2 interrupts — stream 1 should be finalized
      mgr.onPondering('Second thought', 'stream-2');

      expect(mgr._activeStreamId).toBe('stream-2');
      expect(mgr._segments.has('stream-1')).toBe(false);

      // Verify finalization event for stream 1
      const finalEvent = deps.events.find(
        (e) => e.final === true && e.segmentId === 'seg_1',
      );
      expect(finalEvent).toEqual({
        type: 'agent_transcript',
        segmentId: 'seg_1',
        delta: '',
        text: 'Part',
        final: true,
      });

      // Stale callbacks from stream 1 are no-ops
      mgr.onContent('ial response', 'Partial response', 'stream-1');
      // No new events for stream 1 (segment deleted)
      const stream1ContentAfter = deps.events.filter(
        (e) => e.segmentId === 'seg_1' && e.final === false && e.delta === 'ial response',
      );
      expect(stream1ContentAfter).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Stale stream stopAck guard
  // -------------------------------------------------------------------------
  describe('stale stream stopAck guard', () => {
    it('does not call stopAck for non-active stream pondering(null)', () => {
      mgr.onPondering('First', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('A', 'A', 'stream-1');

      // New stream becomes active
      mgr.onPondering('Second', 'stream-2');
      deps.stopAckCalls = 0; // reset counter

      // Stale stream-1 emits pondering(null) from its finally block
      mgr.onPondering(null, 'stream-1');

      // stopAck should NOT have been called — stream-1 is not active
      expect(deps.stopAckCalls).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Rapid interruptions — multiple streams created/abandoned
  // -------------------------------------------------------------------------
  describe('rapid interruptions', () => {
    it('handles multiple streams created and abandoned before content', () => {
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering('B', 'stream-2'); // finalizes stream-1 (no text → no final event)
      mgr.onPondering('C', 'stream-3'); // finalizes stream-2 (no text → no final event)

      expect(mgr._activeStreamId).toBe('stream-3');
      // stream-1 and stream-2 had no text, so no final events
      expect(deps.events.filter((e) => e.final === true)).toHaveLength(0);
      // Only stream-3 segment remains
      expect(mgr._segments.size).toBe(1);
      expect(mgr._segments.has('stream-3')).toBe(true);

      // Stream 3 completes normally
      mgr.onPondering(null, 'stream-3');
      mgr.onContent('Final answer', 'Final answer', 'stream-3');
      mgr.onPondering(null, 'stream-3');

      const finalEvent = deps.events.find((e) => e.final === true);
      expect(finalEvent).toEqual({
        type: 'agent_transcript',
        segmentId: 'seg_3',
        delta: '',
        text: 'Final answer',
        final: true,
      });
    });

    it('handles rapid interruptions where each stream gets some content', () => {
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('X', 'X', 'stream-1');

      mgr.onPondering('B', 'stream-2'); // finalizes stream-1 with text "X"
      mgr.onPondering(null, 'stream-2');
      mgr.onContent('Y', 'Y', 'stream-2');

      mgr.onPondering('C', 'stream-3'); // finalizes stream-2 with text "Y"

      const finals = deps.events.filter((e) => e.final === true);
      expect(finals).toHaveLength(2);
      expect(finals[0]).toMatchObject({ segmentId: 'seg_1', text: 'X' });
      expect(finals[1]).toMatchObject({ segmentId: 'seg_2', text: 'Y' });
    });
  });

  // -------------------------------------------------------------------------
  // 7. Content from deleted/unknown stream — silently ignored
  // -------------------------------------------------------------------------
  describe('content from unknown stream', () => {
    it('ignores onContent for unknown streamId', () => {
      mgr.onContent('ghost', 'ghost data', 'nonexistent-stream');
      expect(deps.events).toHaveLength(0);
    });

    it('ignores onContent for already-finalized stream', () => {
      mgr.onPondering('Go', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('Data', 'Data', 'stream-1');
      mgr.onPondering(null, 'stream-1'); // finalize

      const eventCountAfterFinalize = deps.events.length;

      // Late content from finalized stream
      mgr.onContent('late', 'Data late', 'stream-1');
      expect(deps.events).toHaveLength(eventCountAfterFinalize);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Monster scenario — old stream continues after 3+ new streams
  // -------------------------------------------------------------------------
  describe('monster: old stream survives many new streams', () => {
    it('old stream content is ignored after being superseded by 3+ streams', () => {
      // Stream 1 starts and gets some content
      mgr.onPondering('Alpha', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('Old', 'Old', 'stream-1');

      // Streams 2, 3, 4 arrive in rapid succession
      mgr.onPondering('Beta', 'stream-2');   // finalizes stream-1
      mgr.onPondering('Gamma', 'stream-3');  // finalizes stream-2 (empty)
      mgr.onPondering('Delta', 'stream-4');  // finalizes stream-3 (empty)

      expect(mgr._activeStreamId).toBe('stream-4');
      expect(mgr._segments.size).toBe(1);

      // Old stream-1 HTTP connection finally sends more data — should be ignored
      mgr.onContent(' still alive', 'Old still alive', 'stream-1');
      // No event should reference seg_1 after its finalization
      const staleContentEvents = deps.events.filter(
        (e) => e.segmentId === 'seg_1' && e.final === false && e.text === 'Old still alive',
      );
      expect(staleContentEvents).toHaveLength(0);

      // Old stream-1 finally block fires — should not crash or call stopAck
      const ackBefore = deps.stopAckCalls;
      mgr.onPondering(null, 'stream-1');
      expect(deps.stopAckCalls).toBe(ackBefore); // no stopAck for stale stream

      // Stream 4 completes normally
      mgr.onPondering(null, 'stream-4');
      mgr.onContent('Final!', 'Final!', 'stream-4');
      mgr.onPondering(null, 'stream-4');

      const stream4Final = deps.events.find(
        (e) => e.final === true && e.segmentId === 'seg_4',
      );
      expect(stream4Final).toEqual({
        type: 'agent_transcript',
        segmentId: 'seg_4',
        delta: '',
        text: 'Final!',
        final: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Segment ID incrementing
  // -------------------------------------------------------------------------
  describe('segment ID incrementing', () => {
    it('assigns monotonically increasing segment IDs', () => {
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering('B', 'stream-2');
      mgr.onPondering('C', 'stream-3');

      expect(mgr._segments.get('stream-3')?.segId).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Empty text segment — no final event emitted
  // -------------------------------------------------------------------------
  describe('empty text finalization', () => {
    it('does not emit final event when stream had no content text', () => {
      mgr.onPondering('Start', 'stream-1');
      // Stream interrupted before any content
      mgr.onPondering('Next', 'stream-2');

      // stream-1 was finalized but had empty text — no final event
      const finals = deps.events.filter((e) => e.final === true);
      expect(finals).toHaveLength(0);
    });
  });
});
